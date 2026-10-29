"""Phase 9, part A: does choosing the next card (active learning) beat a random deck?

Replays a user's real ratings as an oracle: a strategy picks which rated set to
"show" next, the user's actual like/pass is revealed, the production model
(recommender.score_sets) is refit, and P@5 is measured on a fixed held-out test
set every few ratings. Each run uses one train/test split and one random starting
seed shared by every strategy, so strategies are compared pairwise, run by run.

Strategies:
  random     any unshown set (today's deck: a fixed shuffle)
  exploit    the highest-scoring set (what a pure recommender would show)
  uncertain  the set with P(like) closest to 0.5; random until LR takes over,
             since the similarity baseline has no probabilities
  diverse    the set least similar to everything rated so far (coverage)
  mixed      each card drawn 60% exploit / 30% uncertain / 10% random

The pool is limited to sets the user rated (a label is needed for every set a
strategy may ask about), so it's a subset of what the live deck chooses from.

Run from the repo root:
  python -m ml.active                            # data/studio.db (read-only), user with most ratings
  python -m ml.active --ratings my_ratings.json
  python -m ml.active --synthetic                # the synthetic users from ml.evaluate

Writes artifacts/active_results.json and artifacts/images/active_learning_<user>.png.
"""
import argparse
import json
import os
import sqlite3
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import train_test_split

from .artifacts import load_embeddings
from .catalog import ARTIFACTS_DIR, ROOT
from .evaluate import SYNTHETIC_USERS, load_ratings, precision_at_k, synthetic_ratings
from .recommender import build_features, build_index, center, score_sets

STRATEGIES = ["random", "exploit", "uncertain", "diverse", "mixed"]
MIX = {"exploit": 0.6, "uncertain": 0.3, "random": 0.1}

RESULTS_PATH = ARTIFACTS_DIR / "active_results.json"
IMAGES_DIR = ARTIFACTS_DIR / "images"
DB_PATH = Path(os.environ.get("STUDIO_DB", ROOT / "data" / "studio.db"))  # same default as api/db.py

TARGET_P5 = 0.8  # "ratings needed to reach this P@5" in the summary
COMPARE_AT = (20, 40, 80)  # checkpoints where each strategy is compared with random

# Plot styling, matching ml/plot_embeddings.py. Random is the control, so it's
# gray; the others take the first four slots of the validated categorical palette.
SURFACE = "#fcfcfb"
INK = "#0b0b0b"
INK_SECONDARY = "#52514e"
INK_MUTED = "#898781"
GRID = "#e1e0d9"
COLORS = {"random": "#898781", "exploit": "#2a78d6", "uncertain": "#eb6834", "diverse": "#1baf7a", "mixed": "#eda100"}


# ---------- data ----------

def ratings_from_db(ids, user=None):
    """(name, rows, labels) for one user, read-only. Defaults to the user with the most ratings."""
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    try:
        if user is None:
            row = conn.execute("SELECT user_id FROM ratings GROUP BY user_id ORDER BY COUNT(*) DESC").fetchone()
            if row is None:
                raise SystemExit(f"{DB_PATH} has no ratings")
            user = row[0]
        ratings = dict(conn.execute(
            "SELECT set_id, value FROM ratings WHERE user_id = ? ORDER BY id", (user,)
        ).fetchall())
    finally:
        conn.close()
    rows, labels = build_features(ids, ratings)
    return f"db-{user[:8]}", rows, labels


# ---------- one simulated user session ----------

def choose(strategy, model, scores, candidates, rated, centered, rng):
    """Index (into the pool) of the next set to show."""
    if strategy == "mixed":
        strategy = rng.choice(list(MIX), p=list(MIX.values()))
    if strategy == "exploit" and scores is not None:
        return candidates[np.argmax(scores[candidates])]
    if strategy == "uncertain" and model == "lr":
        return candidates[np.argmin(np.abs(scores[candidates] - 0.5))]
    if strategy == "diverse":
        # Farthest-point sampling: the candidate whose most similar rated set is least similar.
        nearest = (centered[candidates] @ centered[rated].T).max(axis=1)
        return candidates[np.argmin(nearest)]
    return rng.choice(candidates)


def replay(strategy, pool, start, train, test, budget, rng, k=5, every=5):
    """Simulate one session. Returns {n_ratings: {p5, auc, like_rate}} every `every` ratings."""
    emb, centered, index, labels = pool
    available = np.zeros(len(labels), dtype=bool)
    available[train] = True
    rated = list(start)
    available[rated] = False

    curve = {}
    while True:
        rows = np.array(rated)
        model, scores = score_sets(emb, rows, labels[rows], index, centered)
        n = len(rated)
        if n % every == 0 or n == budget:
            if scores is None:  # no likes yet, so nothing to rank with
                p5 = auc = float("nan")
            else:
                p5 = precision_at_k(scores[test], labels[test], k)
                auc = roc_auc_score(labels[test], scores[test])
            curve[n] = {"p5": p5, "auc": auc, "like_rate": float(labels[rows].mean())}
        if n >= budget or not available.any():
            return curve
        nxt = choose(strategy, model, scores, np.flatnonzero(available), rows, centered, rng)
        rated.append(nxt)
        available[nxt] = False


def simulate(rows, labels, embeddings, runs=30, budget=150, start_size=5, seed=0):
    """Every strategy on the same `runs` splits and starting seeds. Returns per-run curves."""
    # Restrict everything to the rated pool; the baseline's FAISS index must match it.
    emb = embeddings[rows]
    centered = center(embeddings)[rows]
    pool = (emb, centered, build_index(centered), labels)

    curves = {s: [] for s in STRATEGIES}
    for run in range(runs):
        train, test = train_test_split(
            np.arange(len(rows)), test_size=0.3, stratify=labels, random_state=seed + run,
        )
        start = np.random.default_rng(seed + run).choice(train, start_size, replace=False)
        run_budget = min(budget, len(train))
        for i, strategy in enumerate(STRATEGIES):
            rng = np.random.default_rng([seed, run, i])
            curves[strategy].append(replay(strategy, pool, start, train, test, run_budget, rng))
    return curves


# ---------- summarizing ----------

def summarize(curves, labels):
    checkpoints = sorted(curves["random"][0])
    out = {"n_pool": int(len(labels)), "like_rate": float(labels.mean()), "checkpoints": checkpoints, "strategies": {}}
    random_p5 = np.array([[c[n]["p5"] for n in checkpoints] for c in curves["random"]])

    for strategy, runs in curves.items():
        p5 = np.array([[c[n]["p5"] for n in checkpoints] for c in runs])
        auc = np.array([[c[n]["auc"] for n in checkpoints] for c in runs])
        likes = np.array([[c[n]["like_rate"] for n in checkpoints] for c in runs])
        mean = np.nanmean(p5, axis=0)
        reach = next((n for n, v in zip(checkpoints, mean) if v >= TARGET_P5), None)

        # Paired difference vs random: same split and start in each run, so the
        # spread of the per-run differences is the honest noise level.
        vs_random = {}
        for n in COMPARE_AT:
            if n in checkpoints and strategy != "random":
                j = checkpoints.index(n)
                diff = p5[:, j] - random_p5[:, j]
                diff = diff[~np.isnan(diff)]
                half = 1.96 * diff.std(ddof=1) / np.sqrt(len(diff)) if len(diff) > 1 else float("nan")
                vs_random[n] = {"diff": float(diff.mean()), "ci95": float(half)}

        out["strategies"][strategy] = {
            "p5_mean": mean.tolist(),
            "p5_std": np.nanstd(p5, axis=0).tolist(),
            "auc_mean": np.nanmean(auc, axis=0).tolist(),
            "like_rate_mean": likes.mean(axis=0).tolist(),
            "avg_p5": float(np.nanmean(mean)),  # area under the learning curve, normalized
            "ratings_to_target": reach,
            "vs_random": vs_random,
        }
    return out


def print_report(name, s):
    print(f"\n== {name}: {s['n_pool']} rated sets in the pool, {s['like_rate']:.0%} likes "
          f"(random P@5 = {s['like_rate']:.2f})")
    cps = s["checkpoints"]
    shown = [n for n in cps if n % 20 == 0 or n in (cps[0], cps[-1])]
    print("ratings" + "".join(f"{st:>11}" for st in STRATEGIES))
    for n in shown:
        j = cps.index(n)
        print(f"{n:>7}" + "".join(f"{s['strategies'][st]['p5_mean'][j]:>11.2f}" for st in STRATEGIES))

    print(f"\n{'':>10}{'avg P@5':>9}{'to ' + str(TARGET_P5):>8}{'likes shown':>13}   P@5 minus random (95% CI)")
    for st in STRATEGIES:
        r = s["strategies"][st]
        to = str(r["ratings_to_target"]) if r["ratings_to_target"] else "—"
        vs = "  ".join(f"@{n}: {v['diff']:+.2f}±{v['ci95']:.2f}" for n, v in r["vs_random"].items())
        print(f"{st:>10}{r['avg_p5']:>9.2f}{to:>8}{r['like_rate_mean'][-1]:>13.0%}   {vs}")


def plot(name, s, path):
    cps = np.array(s["checkpoints"])
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(13, 5), facecolor=SURFACE)
    fig.suptitle(f"Active learning replay: {name}", x=0.02, ha="left", fontsize=14, fontweight="bold", color=INK)

    for ax, key, title, ylabel in (
        (ax1, "p5_mean", "Precision@5 on held-out ratings", "P@5"),
        (ax2, "like_rate_mean", "Share of shown sets the user liked", "liked / shown"),
    ):
        ax.set_facecolor(SURFACE)
        for st in STRATEGIES:
            r = s["strategies"][st]
            y = np.array(r[key])
            ax.plot(cps, y, color=COLORS[st], lw=2, solid_capstyle="round", label=st, zorder=3 if st != "random" else 2)
        if key == "p5_mean":
            ax.axhline(s["like_rate"], color=INK_MUTED, lw=1)
            ax.text(cps[-1], s["like_rate"] + 0.015, f"random ranking {s['like_rate']:.2f}",
                    ha="right", fontsize=8.5, color=INK_MUTED)
            ax.set_ylim(0, 1.02)
        ax.set_title(title, loc="left", fontsize=11, fontweight="bold", color=INK)
        ax.set_xlabel("ratings so far", fontsize=9, color=INK_MUTED)
        ax.set_ylabel(ylabel, fontsize=9, color=INK_MUTED)
        ax.grid(axis="y", color=GRID, lw=1)
        ax.tick_params(colors=INK_MUTED, labelsize=8.5)
        for side in ("top", "right"):
            ax.spines[side].set_visible(False)
        for side in ("left", "bottom"):
            ax.spines[side].set_color(GRID)

    handles, names = ax1.get_legend_handles_labels()
    fig.legend(handles, names, loc="upper left", bbox_to_anchor=(0.02, 0.93), ncol=len(STRATEGIES),
               frameon=False, fontsize=9.5, labelcolor=INK_SECONDARY, handlelength=1.6)
    fig.text(
        0.02, 0.01,
        f"Mean of {s['runs']} paired runs (same split and starting ratings per run). Per-run spread is large; "
        "compare strategies with the paired differences vs random in active_results.json.",
        fontsize=8.5, color=INK_SECONDARY,
    )
    fig.tight_layout(rect=(0, 0.04, 1, 0.87))
    fig.savefig(path, dpi=150, facecolor=SURFACE)
    plt.close(fig)


def main(ratings_path=None, user=None, synthetic=False, runs=30, budget=150, start_size=5, seed=0):
    catalog, embeddings = load_embeddings()
    ids = catalog["id"].tolist()

    if synthetic:
        rng = np.random.default_rng(seed)
        users = {f"synthetic-{n.replace(' ', '-')}": synthetic_ratings(catalog, rule, 300, 0.1, rng)
                 for n, rule in SYNTHETIC_USERS.items()}
    elif ratings_path:
        users = {Path(ratings_path).stem: load_ratings(ratings_path, ids)}
    else:
        name, rows, labels = ratings_from_db(ids, user)
        users = {name: (rows, labels)}

    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    results = json.loads(RESULTS_PATH.read_text()) if RESULTS_PATH.exists() else {}
    for name, (rows, labels) in users.items():
        summary = summarize(simulate(rows, labels, embeddings, runs, budget, start_size, seed), labels)
        summary.update(runs=runs, budget=budget, start_size=start_size)  # before plot(), which reads runs
        results[name] = summary
        print_report(name, summary)
        path = IMAGES_DIR / f"active_learning_{name}.png"
        plot(name, summary, path)
        print(f"wrote {path.relative_to(ROOT)}")

    RESULTS_PATH.write_text(json.dumps(results, indent=2))
    print(f"wrote {RESULTS_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--ratings", help="JSON of {set_id: 1|0} instead of the database")
    source.add_argument("--synthetic", action="store_true", help="use ml.evaluate's synthetic users")
    parser.add_argument("--user", help="database user id (default: the one with the most ratings)")
    parser.add_argument("--runs", type=int, default=30)
    parser.add_argument("--budget", type=int, default=150, help="ratings per simulated session")
    parser.add_argument("--start", type=int, default=5, help="random ratings before a strategy takes over")
    args = parser.parse_args()
    main(args.ratings, args.user, args.synthetic, args.runs, args.budget, args.start)
