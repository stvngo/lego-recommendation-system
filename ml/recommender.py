"""Phase 4: score sets for one user from their like/pass ratings.

Pure functions: arrays and dicts in, arrays and dicts out, no file I/O.
Evaluation (phase 5) calls these thousands of times on train/test splits,
and the API calls them after every rating.

Run the fake-user sanity check from the repo root:  python -m ml.recommender
"""
import faiss
import numpy as np
from sklearn.linear_model import LogisticRegression


def build_features(ids, ratings):
    """Turn {set_id: 1|0} ratings into (rows, labels) that index the embedding matrix."""
    row_of = {set_id: row for row, set_id in enumerate(ids)}
    # Ids missing from the catalog (e.g. after a catalog rebuild) are skipped.
    rated = [(row_of[set_id], value) for set_id, value in ratings.items() if set_id in row_of]
    rows = np.array([row for row, _ in rated], dtype=int)
    labels = np.array([value for _, value in rated], dtype=int)
    return rows, labels


def center(embeddings):
    """Subtract the mean embedding and re-normalize.

    All sets sit in one tight cluster, so raw cosine similarity mostly measures
    "how typical does this set look". Centering removes that shared direction;
    phase 5 showed it's what makes the baseline competitive. It uses no labels.
    """
    centered = embeddings - embeddings.mean(axis=0)
    return (centered / np.linalg.norm(centered, axis=1, keepdims=True)).astype(np.float32)


def build_index(embeddings):
    """Exact inner-product index. On unit vectors, inner product == cosine similarity."""
    index = faiss.IndexFlatIP(embeddings.shape[1])
    index.add(np.ascontiguousarray(embeddings, dtype=np.float32))
    return index


def baseline_scores(index, embeddings, rows, labels):
    """Cosine similarity of every set to the mean of the liked sets."""
    liked = embeddings[rows[labels == 1]]
    if not len(liked):
        return np.zeros(index.ntotal, dtype=np.float32)

    query = np.ascontiguousarray(liked.mean(axis=0, keepdims=True), dtype=np.float32)
    faiss.normalize_L2(query)  # the mean of unit vectors is shorter than 1

    # Search all sets rather than top-k: recommend() still has to mask rated and
    # filtered-out sets, and evaluation needs a score for every held-out set.
    sims, positions = index.search(query, index.ntotal)
    scores = np.empty(index.ntotal, dtype=np.float32)
    scores[positions[0]] = sims[0]
    return scores


def fit_model(x, y, C=1.0):
    if len(np.unique(y)) < 2:
        raise ValueError("logistic regression needs at least one like and one pass")
    return LogisticRegression(
        C=C,  # small C = strong L2 regularization; we have far fewer ratings than dimensions
        max_iter=1000,
        class_weight="balanced",  # prevent class imbalance
    ).fit(x, y)


def predict(model, x):
    return model.predict_proba(x)[:, 1]  # probability of positive class


def lr_scores(embeddings, rows, labels, C=1.0):
    """P(like) for every set from a logistic regression fit on the rated sets only."""
    return predict(fit_model(embeddings[rows], labels, C), embeddings)


def score_sets(embeddings, rows, labels, index, baseline_embeddings=None, min_per_class=5, C=1.0):
    """(model_name, scores for every set), or ("none", None) when there are no likes yet.

    Uses the baseline until there are min_per_class likes *and* passes, then LR.
    index must be built over baseline_embeddings (which defaults to embeddings).
    """
    n_likes = int(labels.sum())
    n_passes = len(labels) - n_likes

    if n_likes >= min_per_class and n_passes >= min_per_class:
        return "lr", lr_scores(embeddings, rows, labels, C)
    if n_likes:
        base = embeddings if baseline_embeddings is None else baseline_embeddings
        return "baseline", baseline_scores(index, base, rows, labels)
    return "none", None


def recommend(embeddings, ids, ratings, index, k=5, candidates=None, baseline_embeddings=None,
              min_per_class=5, C=1.0):
    """Top-k unrated sets for one user.

    candidates: optional boolean mask (N,), e.g. catalog["style"] == "display".
    baseline_embeddings: what the baseline compares (e.g. center(embeddings));
    index must be built over them. With no likes at all there's nothing to go
    on, so ids comes back empty and the caller decides what to show.
    """
    rows, labels = build_features(ids, ratings)
    model_name, scores = score_sets(embeddings, rows, labels, index, baseline_embeddings, min_per_class, C)
    if scores is None:
        return {"ids": [], "scores": [], "model": model_name}

    # vector of booleans, get only dropdown candidates
    eligible = np.ones(len(ids), dtype=bool) if candidates is None else np.array(candidates, dtype=bool)
    eligible[rows] = False  # never recommend something already rated (remove seen rows)
    masked = np.where(eligible, scores, -np.inf) 

    top = np.argsort(-masked, kind="stable")[:k]
    top = top[np.isfinite(masked[top])]  # fewer than k eligible sets left
    return {
        "ids": [ids[i] for i in top],
        "scores": scores[top].tolist(),
        "model": model_name,
    }


def main():
    """Fake-user check: like Architecture, pass Star Wars, and see what comes back."""
    from .artifacts import load_embeddings

    catalog, embeddings = load_embeddings()
    ids = catalog["id"].tolist()
    index = build_index(embeddings)
    rng = np.random.default_rng(0)

    def sample(theme, n):
        return rng.choice(catalog.loc[catalog["theme"] == theme, "id"], n, replace=False)

    architecture, star_wars = sample("Architecture", 10), sample("Star Wars", 10)

    def show(title, ratings):
        result = recommend(embeddings, ids, ratings, index)
        rated = set(ratings) & set(result["ids"])
        print(f"\n{title}  [model={result['model']}, overlap with rated={len(rated)}]")
        by_id = catalog.set_index("id")
        for set_id, score in zip(result["ids"], result["scores"]):
            print(f"  {score:.3f}  {by_id.at[set_id, 'name']} ({by_id.at[set_id, 'theme']})")

    show("3 Architecture likes only", {s: 1 for s in architecture[:3]})
    show("10 Architecture likes, 10 Star Wars passes",
         {**{s: 1 for s in architecture}, **{s: 0 for s in star_wars}})
    show("Flipped: 10 Star Wars likes, 10 Architecture passes",
         {**{s: 0 for s in architecture}, **{s: 1 for s in star_wars}})
    show("No likes", {s: 0 for s in star_wars})


if __name__ == "__main__":
    main()
