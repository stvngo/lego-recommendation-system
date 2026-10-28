"""Phase 1: build the set catalog from the raw Rebrickable CSVs.

Writes artifacts/catalog.parquet. Its row order is the contract for the rest of
the pipeline: row i of the catalog is row i of embeddings.npy.

Run from the repo root:  python -m ml.catalog
"""
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data" / "all_downloads"
ARTIFACTS_DIR = ROOT / "artifacts"
CATALOG_PATH = ARTIFACTS_DIR / "catalog.parquet"

# Root themes that read as "display builds" (adult / shelf pieces).
DISPLAY_ROOTS = {
    'Icons', 'Architecture', 'LEGO Art', 'Botanicals', 'LEGO Ideas and CUUSOO',
    'Modular Buildings', 'Editions',
}

# Subthemes that are display builds even though their root isn't (e.g. UCS under Star Wars).
DISPLAY_SUBTHEMES = {
    'Creator Expert', 'Ultimate Collector Series', 'UCS',
}

# Root themes that aren't buildable sets someone would browse for.
EXCLUDED_ROOTS = {
    'Seasonal', 'Promotional', 'Other', 'Educational and Dacta', 'FIRST LEGO League',
    'LEGO Brand Store', 'Legoland Parks', 'Gear', 'Books', 'Bulk Bricks', 'Service Packs',
    'LEGO Exclusive', 'Brickheadz', 'DOTS', 'Classic', 'BrickLink Designer Program',
}

SHORT_NAMES = {
    'LEGO Ideas and CUUSOO': 'Ideas',
    'Super Heroes Marvel': 'Marvel',
    'Super Heroes DC': 'DC',
    'The Hobbit and Lord of the Rings': 'Lord of the Rings',
}

# style -> (min_year, max_year, min_parts)
THRESHOLDS = {
    'display': (2018, 2026, 300),
    'play': (2020, 2026, 250),
}


def load_themes(raw_dir=RAW_DIR):
    """themes.csv plus each theme's root (its top-level ancestor)."""
    themes = pd.read_csv(raw_dir / "themes.csv", dtype={"parent_id": "Int64"})
    parent = dict(zip(themes["id"], themes["parent_id"]))

    def root_of(theme_id):
        # Walk up the parent chain until a theme has no parent.
        while pd.notna(parent[theme_id]):
            theme_id = parent[theme_id]
        return theme_id

    themes["root_id"] = themes["id"].map(root_of)
    themes["root_name"] = themes["root_id"].map(dict(zip(themes["id"], themes["name"])))
    return themes


def build_catalog(raw_dir=RAW_DIR):
    sets = pd.read_csv(raw_dir / "sets.csv")
    themes = load_themes(raw_dir).rename(columns={"id": "theme_id", "name": "theme_name"})

    df = sets.merge(
        themes[["theme_id", "theme_name", "root_id", "root_name"]],
        on="theme_id",
        how="left",
        validate="many_to_one",  # each set has exactly one theme; fail loudly otherwise
    )

    # Base versions only (10316-1, not 10316-2), with an image, from real set themes.
    df = df[df["set_num"].str.endswith("-1") & df["img_url"].notna()]
    df = df[~df["root_name"].isin(EXCLUDED_ROOTS)]

    is_display = df["root_name"].isin(DISPLAY_ROOTS) | df["theme_name"].isin(DISPLAY_SUBTHEMES)
    df = df.assign(style=np.where(is_display, "display", "play"))

    # Build mask to keep rows matching thresholds
    keep = pd.Series(False, index=df.index)
    for style, (min_year, max_year, min_parts) in THRESHOLDS.items():
        keep |= (
            (df["style"] == style)
            & df["year"].between(min_year, max_year)
            & (df["num_parts"] >= min_parts)
        )
    df = df[keep] # apply the mask

    # Same fields as web/public/catalog.json so the API can serve this directly.
    catalog = pd.DataFrame({
        "id": df["set_num"],
        "num": df["set_num"].str.removesuffix("-1"),
        "name": df["name"],
        "year": df["year"],
        "parts": df["num_parts"],
        "theme": df["root_name"].replace(SHORT_NAMES), # use short names for display
        "subtheme": df["theme_name"].where(df["theme_id"] != df["root_id"]),
        "style": df["style"],
        "img": df["img_url"],
        "url": "https://rebrickable.com/sets/" + df["set_num"] + "/",
    })

    # Sorting by id makes row order deterministic, which embeddings.npy will rely on.
    return catalog.sort_values("id").reset_index(drop=True)


def validate(catalog):
    assert catalog["id"].is_unique, "duplicate set ids"
    assert catalog[["id", "name", "theme", "img"]].notna().all().all(), "missing required fields"
    assert set(catalog["style"]) <= set(THRESHOLDS), "unknown style"


def main():
    catalog = build_catalog()
    validate(catalog)

    ARTIFACTS_DIR.mkdir(exist_ok=True)
    catalog.to_parquet(CATALOG_PATH, index=False)

    counts = catalog["style"].value_counts()
    print(
        f"{CATALOG_PATH.relative_to(ROOT)}: {len(catalog)} sets "
        f"({counts.get('display', 0)} display, {counts.get('play', 0)} play)"
    )


if __name__ == "__main__":
    main()
