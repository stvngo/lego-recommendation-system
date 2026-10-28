"""Phase 5: offline evaluation of logistic regression vs the FAISS baseline.

For each user (your real ratings, or synthetic users), repeated n_splits times:
  1. split the rated sets into train / test, stratified so both sides have likes and passes
  2. for each training size n on the learning curve, fit on the first n training ratings
  3. score every set, then rank ONLY the held-out rated sets (unrated sets have no
     label, so they can't count as hits or misses) and compute P@k and AUC

Reports mean ± std across splits next to the base rate: the P@k of a random
ranking, which is just the like rate of the test set. Results also go to
artifacts/eval_results.json for the Insights page.

Run from the repo root:
  python -m ml.evaluate --ratings my_ratings.json   # your ratings
  python -m ml.evaluate                             # synthetic users

To export ratings from the frontend, run this in the browser console on the app
and paste the result into a .json file:
  copy(JSON.stringify(JSON.parse(localStorage.getItem("studio:v1")).ratings))
"""
import argparse
import json
from pathlib import Path

import numpy as np
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import train_test_split

from .artifacts import load_embeddings
from .catalog import ARTIFACTS_DIR
from .recommender import baseline_scores, build_features, build_index, center, lr_scores

RESULTS_PATH = ARTIFACTS_DIR / "eval_results.json"
CURVE_POINTS = 20  # about how many evenly spaced training sizes each learning curve gets
COLD_START = 5  # always measured too: how each model does from its first few ratings
MIN_PER_CLASS = 5

# Synthetic users: a rule over catalog rows saying which sets they like.
# Theme rules are "easy mode": the theme name is in the CLIP text prompt, so the
# embedding nearly spells out the label. "big builds" isn't in the prompt at all.
SYNTHETIC_USERS = {
    "display fan": lambda c: c["theme"].isin({"Architecture", "Botanicals", "LEGO Art", "Icons"}),
    "star wars fan": lambda c: c["theme"] == "Star Wars",
    "racer": lambda c: c["theme"].isin({"Technic", "Speed Champions"}),
    "big builds": lambda c: c["parts"] >= 2000,
}


def curve_sizes(n_train, points=CURVE_POINTS):
    """Training sizes for the learning curve: a cold-start point, then evenly spaced
    multiples of a round step (1/2/5 × 10^k), ending at the full training set.

    e.g. 396 -> [5, 50, 100, ..., 350, 396];  196 -> [5, 20, 40, ..., 180, 196]
    """
    raw = n_train / points
    magnitude = 10 ** int(np.floor(np.log10(raw))) if raw >= 1 else 1
    step = next(m * magnitude for m in (1, 2, 5, 10) if m * magnitude >= raw)
    # Stop half a step early so the last regular point doesn't crowd the final one.
    sizes = {COLD_START, *range(step, n_train - step // 2, step), n_train}
    return sorted(n for n in sizes if n <= n_train)


def precision_at_k(scores, labels, k):
    """Fraction of the k highest-scoring items that are likes."""
    top = np.argsort(-scores, kind="stable")[:k]
    return float(labels[top].mean())


def make_models(embeddings, index, Cs):
    """name -> fn(train_rows, train_labels) -> scores for every set, or None if it can't fit."""
    # Centering uses only the unlabeled embeddings, so it leaks nothing about test
    # labels. (It's a no-op for LR: the unregularized intercept absorbs the shift,
    # so LR isn't compared with and without it.)
    centered = center(embeddings)
    centered_index = build_index(centered)

    def has_both(y):
        return 0 < y.sum() < len(y)

    models = {
        "baseline": lambda r, y: baseline_scores(index, embeddings, r, y) if y.any() else None,
        "baseline centered": lambda r, y: baseline_scores(centered_index, centered, r, y) if y.any() else None,
    }
    for C in Cs:
        # C=C binds the current value; a plain closure would see only the last C.
        models[f"lr C={C:g}"] = lambda r, y, C=C: lr_scores(embeddings, r, y, C) if has_both(y) else None
    return models


def evaluate_user(rows, labels, models, n_splits=30, test_size=0.3, k=5, seed=0):
    runs = {name: {} for name in models}  # name -> train size -> {"p": [], "auc": [], "spread": []}
    base_rates = []

    for split in range(n_splits):
        train, test = train_test_split( # create idx splits
            np.arange(len(rows)), test_size=test_size, stratify=labels, random_state=seed + split,
        )
        test_rows, test_labels = rows[test], labels[test]
        base_rates.append(test_labels.mean())

        # Growing prefixes of one shuffled order, so each curve point adds ratings
        # to the previous one, like a user rating more sets over time.
        order = np.random.default_rng(seed + split).permutation(train)
        sizes = curve_sizes(len(train))

        for n in sizes:
            train_rows, train_labels = rows[order[:n]], labels[order[:n]]
            for name, score in models.items():
                scores = score(train_rows, train_labels)
                if scores is None:  # e.g. LR with only likes so far
                    continue
                held_out = scores[test_rows]
                record = runs[name].setdefault(n, {"p": [], "auc": [], "spread": []})
                record["p"].append(precision_at_k(held_out, test_labels, min(k, len(test))))
                record["auc"].append(roc_auc_score(test_labels, held_out))
                record["spread"].append(float(held_out.std()))

    return {
        "n_ratings": int(len(rows)),
        "like_rate": float(labels.mean()),
        "base_rate": float(np.mean(base_rates)),
        "k": k,
        "models": {
            name: {
                n: {
                    "p_mean": float(np.mean(r["p"])),
                    "p_std": float(np.std(r["p"])),
                    "auc_mean": float(np.mean(r["auc"])),
                    "spread": float(np.mean(r["spread"])),
                    "runs": len(r["p"]),  # can be < n_splits at small n when a class is missing
                }
                for n, r in sorted(by_size.items())
            }
            for name, by_size in runs.items()
        },
    }


def synthetic_ratings(catalog, rule, n_ratings, noise, rng):
    """Half likes, half passes, with a fraction of labels flipped to mimic an inconsistent human."""
    positive = rule(catalog).to_numpy()
    likes = rng.choice(np.flatnonzero(positive), n_ratings // 2, replace=False)
    passes = rng.choice(np.flatnonzero(~positive), n_ratings - n_ratings // 2, replace=False)
    rows = np.concatenate([likes, passes])
    labels = positive[rows].astype(int)
    labels[rng.random(len(rows)) < noise] ^= 1
    return rows, labels


def load_ratings(path, ids):
    data = json.loads(Path(path).read_text())
    ratings = data.get("ratings", data)  # accept the whole localStorage state or just the ratings
    rows, labels = build_features(ids, ratings)
    n_likes = int(labels.sum())
    if min(n_likes, len(labels) - n_likes) < MIN_PER_CLASS:
        raise SystemExit(
            f"{path}: {n_likes} likes / {len(labels) - n_likes} passes; "
            f"need at least {MIN_PER_CLASS} of each to evaluate"
        )
    return rows, labels


def print_report(user, result):
    names = list(result["models"])
    width = max(len(name) for name in names) + 2
    print(
        f"\n== {user}: {result['n_ratings']} ratings, {result['like_rate']:.0%} likes, "
        f"base rate P@{result['k']} = {result['base_rate']:.2f}"
    )
    print("n".rjust(4) + "".join(name.rjust(width) for name in names))
    sizes = sorted({n for by_size in result["models"].values() for n in by_size})
    for n in sizes:
        cells = []
        for name in names:
            r = result["models"][name].get(n)
            cells.append((f"{r['p_mean']:.2f}±{r['p_std']:.2f}" if r else "-").rjust(width))
        print(f"{n:>4}" + "".join(cells))

    full = sizes[-1]
    print(f"at n={full}:")
    for name in names:
        r = result["models"][name][full]
        print(f"  {name:<{width}} AUC {r['auc_mean']:.2f}   score spread {r['spread']:.3f}")


def main(ratings_path=None, n_splits=30, k=5, Cs=(0.1, 1.0, 10.0), n_synthetic=80, noise=0.1, seed=0):
    catalog, embeddings = load_embeddings()
    ids = catalog["id"].tolist()
    models = make_models(embeddings, build_index(embeddings), Cs)

    if ratings_path:
        users = {Path(ratings_path).stem: load_ratings(ratings_path, ids)}
    else:
        rng = np.random.default_rng(seed)
        users = {
            name: synthetic_ratings(catalog, rule, n_synthetic, noise, rng)
            for name, rule in SYNTHETIC_USERS.items()
        }

    results = {}
    for user, (rows, labels) in users.items():
        results[user] = evaluate_user(rows, labels, models, n_splits=n_splits, k=k, seed=seed)
        print_report(user, results[user])

    RESULTS_PATH.write_text(json.dumps(results, indent=2))
    print(f"\nwrote {RESULTS_PATH.relative_to(ARTIFACTS_DIR.parent)}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--ratings", help="JSON of {set_id: 1|0}; omit to use synthetic users")
    parser.add_argument("--splits", type=int, default=30)
    parser.add_argument("--k", type=int, default=5)
    parser.add_argument("--C", type=float, nargs="+", default=[0.1, 1.0, 10.0], help="LR regularization values to compare")
    parser.add_argument("--noise", type=float, default=0.1, help="label flip rate for synthetic users")
    args = parser.parse_args()
    main(args.ratings, args.splits, args.k, tuple(args.C), noise=args.noise)
