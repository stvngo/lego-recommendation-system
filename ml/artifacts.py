"""Paths to pipeline outputs, plus a loader for the embeddings.

Kept separate from embed.py so the recommender and API can load embeddings
without importing torch / open_clip.
"""
import json

import numpy as np
import pandas as pd

from .catalog import ARTIFACTS_DIR, CATALOG_PATH

EMBEDDINGS_PATH = ARTIFACTS_DIR / "embeddings.npy"
IMAGE_EMBEDDINGS_PATH = ARTIFACTS_DIR / "image_embeddings.npy"
TEXT_EMBEDDINGS_PATH = ARTIFACTS_DIR / "text_embeddings.npy"
COORDS_PATH = ARTIFACTS_DIR / "coords_2d.npy"  # PCA
TSNE_COORDS_PATH = ARTIFACTS_DIR / "tsne_2d.npy"
IDS_PATH = ARTIFACTS_DIR / "ids.json"


def load_embeddings(path=EMBEDDINGS_PATH):
    """Load (catalog, embeddings), failing if the catalog changed since embedding."""
    catalog = pd.read_parquet(CATALOG_PATH)
    if json.loads(IDS_PATH.read_text()) != catalog["id"].tolist():
        raise RuntimeError("catalog.parquet changed since embeddings were built; rerun python -m ml.embed")
    return catalog, np.load(path)
