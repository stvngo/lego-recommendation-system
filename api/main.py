"""stud.io API: serves the catalog, stores ratings, and returns recommendations.

Run from the repo root:  uvicorn api.main:app --reload --port 8000
Interactive docs:        http://localhost:8000/docs

Every endpoint that touches ratings needs an X-User-Id header: an anonymous id
the browser generates once and keeps in localStorage.
"""
import json
from contextlib import asynccontextmanager
from typing import Literal

import numpy as np
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request

from ml.artifacts import COORDS_PATH, TSNE_COORDS_PATH, load_embeddings
from ml.evaluate import MIN_PER_CLASS, RESULTS_PATH, evaluate_user, make_models
from ml.recommender import build_features, build_index, center, recommend, score_sets

from . import db
from .schemas.rating import RatingIn, RatingsImport

Style = Literal["display", "play", "all"]

ONLINE_SPLITS = 20  # ~0.85s for 281 ratings; 10 halves that but the baselines get noticeably noisier
EVAL_CACHE_SIZE = 64


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Load everything once; requests only read from app.state.
    catalog, embeddings = load_embeddings()
    centered = center(embeddings)

    state = app.state
    # astype(object) + where turns NaN subthemes into None, so they serialize as null.
    state.sets = catalog.astype(object).where(catalog.notna(), None).to_dict("records")
    state.ids = catalog["id"].tolist()
    state.row_of = {set_id: row for row, set_id in enumerate(state.ids)}
    state.parts = catalog["parts"].to_numpy()
    state.embeddings = embeddings
    state.centered = centered
    state.index = build_index(centered)  # the baseline compares centered embeddings
    state.style_masks = {
        "display": (catalog["style"] == "display").to_numpy(),
        "play": (catalog["style"] == "play").to_numpy(),
        "all": np.ones(len(catalog), dtype=bool),
    }
    state.coords = np.load(COORDS_PATH)
    # Written by ml.embed; older artifact folders may not have it yet.
    state.tsne = np.load(TSNE_COORDS_PATH) if TSNE_COORDS_PATH.exists() else None
    # Same three models the offline ml.evaluate run compares: raw baseline, centered baseline, LR.
    state.eval_models = make_models(embeddings, build_index(embeddings), (1.0,))
    state.eval_cache = {}  # (user, ratings) -> result; a rerun with identical ratings is free
    db.init_db()

    print(f"loaded {len(state.ids)} sets; ratings db at {db.DB_PATH}")
    yield


app = FastAPI(title="stud.io", lifespan=lifespan)


def get_state(request: Request):
    return request.app.state


def user_id(x_user_id: str = Header(..., min_length=8, max_length=64)) -> str:
    return x_user_id


def counts(ratings):
    likes = sum(ratings.values())
    return {"likes": likes, "passes": len(ratings) - likes}


# ---------- catalog ----------

@app.get("/api/health")
def health(state=Depends(get_state)):
    return {"status": "ok", "sets": len(state.ids)}


@app.get("/api/sets")
def sets(style: Style = "display", state=Depends(get_state)):
    mask = state.style_masks[style]
    return [s for s, keep in zip(state.sets, mask) if keep]


# ---------- ratings ----------

@app.get("/api/ratings")
def get_ratings(uid: str = Depends(user_id)):
    ratings, history = db.get_ratings(uid)
    return {"ratings": ratings, "history": history, **counts(ratings)}


@app.post("/api/ratings")
def add_rating(rating: RatingIn, uid: str = Depends(user_id), state=Depends(get_state)):
    if rating.set_id not in state.row_of:
        raise HTTPException(404, f"unknown set {rating.set_id}")
    db.add_rating(uid, rating.set_id, rating.value)
    ratings, _ = db.get_ratings(uid)
    return counts(ratings)


@app.post("/api/ratings/import")
def import_ratings(body: RatingsImport, uid: str = Depends(user_id), state=Depends(get_state)):
    """Store many ratings at once, e.g. the ones already in a browser's localStorage."""
    known = {s: v for s, v in body.ratings.items() if s in state.row_of}
    ordered = [s for s in dict.fromkeys(body.history) if s in known]  # dedupe, keep order
    seen = set(ordered)
    ordered += [s for s in known if s not in seen]
    db.add_ratings(uid, [(s, known[s]) for s in ordered])
    ratings, _ = db.get_ratings(uid)
    return {"imported": len(ordered), "skipped": len(body.ratings) - len(known), **counts(ratings)}


@app.delete("/api/ratings/last")
def undo_last(uid: str = Depends(user_id)):
    set_id = db.undo_last(uid)
    if set_id is None:
        raise HTTPException(404, "nothing to undo")
    ratings, _ = db.get_ratings(uid)
    return {"set_id": set_id, **counts(ratings)}


# ---------- recommendations ----------

# Plain `def`, not `async def`: sklearn and FAISS block while they compute.
# FastAPI runs `def` endpoints in a thread pool; blocking inside `async def`
# would stall every other request.
@app.get("/api/recommendations")
def recommendations(
    style: Style = "display",
    k: int = Query(5, ge=1, le=50),
    uid: str = Depends(user_id),
    state=Depends(get_state),
):
    ratings, _ = db.get_ratings(uid)
    mask = state.style_masks[style]
    result = recommend(
        state.embeddings, state.ids, ratings, state.index,
        k=k, candidates=mask, baseline_embeddings=state.centered,
    )

    picks = list(zip(result["ids"], result["scores"]))
    if len(picks) < k:
        # No likes yet (or too few candidates): pad with the largest unrated sets.
        chosen = set(result["ids"])
        rated = {state.row_of[s] for s in ratings}
        filler = [
            row for row in np.argsort(-state.parts, kind="stable")
            if mask[row] and row not in rated and state.ids[row] not in chosen
        ]
        picks += [(state.ids[row], None) for row in filler[: k - len(picks)]]

    return {
        "items": [{**state.sets[state.row_of[s]], "score": score} for s, score in picks],
        "personalized": result["model"] != "none",
        "model": result["model"],
        "n_ratings": len(ratings),
    }


@app.get("/api/insights")
def insights(style: Style = "display", uid: str = Depends(user_id), state=Depends(get_state)):
    ratings, history = db.get_ratings(uid)
    mask = state.style_masks[style]

    rows, labels = build_features(state.ids, ratings)
    model, scores = score_sets(state.embeddings, rows, labels, state.index, state.centered)

    unrated = mask.copy()
    unrated[rows] = False
    picks = set()
    histogram = None
    if scores is not None and unrated.any():
        top = np.argsort(-np.where(unrated, scores, -np.inf), kind="stable")[:5]
        picks = {state.ids[i] for i in top if unrated[i]}
        hist_counts, edges = np.histogram(scores[unrated], bins=20)
        histogram = {"counts": hist_counts.tolist(), "edges": edges.tolist()}

    def status(set_id):
        if set_id in ratings:
            return "liked" if ratings[set_id] else "passed"
        return "pick" if set_id in picks else "unrated"

    # Both layouts per point, so the map can switch PCA <-> t-SNE without a refetch.
    points = [
        {
            "id": state.ids[row],
            "status": status(state.ids[row]),
            "pca": state.coords[row].tolist(),
            "tsne": None if state.tsne is None else state.tsne[row].tolist(),
        }
        for row in np.flatnonzero(mask)
    ]

    return {
        "model": model,
        **counts(ratings),
        "timeline": [ratings[s] for s in history],  # 1/0 per rating, oldest first
        "points": points,
        "score_histogram": histogram,  # scores of unrated sets; P(like) for lr, cosine for baseline
    }


@app.get("/api/evaluation")
def evaluation(uid: str = Depends(user_id), state=Depends(get_state)):
    """Precision@k learning curves.

    online:  ml.evaluate's procedure run live on this user's ratings (all styles),
             with fewer splits than the offline run so it stays under a second.
    offline: the first result in artifacts/eval_results.json, if `python -m ml.evaluate`
             has been run locally (e.g. with --ratings my_ratings.json).
    """
    ratings, _ = db.get_ratings(uid)
    rows, labels = build_features(state.ids, ratings)
    n_likes = int(labels.sum())
    n_passes = len(labels) - n_likes

    online, online_note = None, None
    if min(n_likes, n_passes) < MIN_PER_CLASS:
        online_note = (
            f"needs {MIN_PER_CLASS} likes and {MIN_PER_CLASS} passes "
            f"(you have {n_likes} and {n_passes})"
        )
    else:
        key = (uid, tuple(sorted(ratings.items())))
        online = state.eval_cache.get(key)
        if online is None:
            online = {
                **evaluate_user(rows, labels, state.eval_models, n_splits=ONLINE_SPLITS),
                "n_splits": ONLINE_SPLITS,
            }
            if len(state.eval_cache) >= EVAL_CACHE_SIZE:
                state.eval_cache.pop(next(iter(state.eval_cache)))  # drop the oldest entry
            state.eval_cache[key] = online

    offline = None
    if RESULTS_PATH.exists():
        name, result = next(iter(json.loads(RESULTS_PATH.read_text()).items()), (None, None))
        if result:
            offline = {"name": name, **result}

    return {"online": online, "online_note": online_note, "offline": offline}
