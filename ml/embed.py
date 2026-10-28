"""Phase 3: embed every catalog set with CLIP (open_clip).

Writes, aligned row-for-row with artifacts/catalog.parquet:
  embeddings.npy        (N, D) float32: image + text averaged, L2-normalized
  image_embeddings.npy  (N, D) image only (zero rows where the image is missing)
  text_embeddings.npy   (N, D) text only
  coords_2d.npy         (N, 2) PCA of embeddings.npy, for the Insights map
  tsne_2d.npy           (N, 2) t-SNE of embeddings.npy, the map's alternative layout
  ids.json              set ids in row order, so loaders can check alignment

Keeping the image and text arrays separate lets evaluation compare
image-only vs text-only vs combined without re-running CLIP.

Run from the repo root:  python -m ml.embed [--model ViT-B-32-quickgelu] [--pretrained openai]
"""
import argparse
import json

import numpy as np
import open_clip
import pandas as pd
import torch
from PIL import Image
from sklearn.decomposition import PCA
from sklearn.manifold import TSNE

from .artifacts import (
    COORDS_PATH, EMBEDDINGS_PATH, IDS_PATH, IMAGE_EMBEDDINGS_PATH, TEXT_EMBEDDINGS_PATH, TSNE_COORDS_PATH,
)
from .catalog import CATALOG_PATH
from .images import image_path

# OpenAI's weights were trained with QuickGELU; the plain "ViT-B-32" config uses
# standard GELU, which loads fine but quietly degrades the embeddings.
MODEL = "ViT-B-32-quickgelu"
PRETRAINED = "openai"
BATCH_SIZE = 64


def pick_device():
    if torch.backends.mps.is_available():  # Apple Silicon GPU
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def load_model(name=MODEL, pretrained=PRETRAINED, device="cpu"):
    model, _, preprocess = open_clip.create_model_and_transforms(name, pretrained=pretrained, device=device)
    model.eval()  # open_clip returns the model in train mode; eval turns off dropout etc.
    tokenizer = open_clip.get_tokenizer(name)
    return model, preprocess, tokenizer


def prompt(row):
    return f"a LEGO {row.theme} set called {row.name}"


def normalize(x):
    norms = np.linalg.norm(x, axis=1, keepdims=True)
    return x / np.maximum(norms, 1e-12)  # zero rows stay zero instead of becoming NaN


@torch.no_grad()
def embed_texts(model, tokenizer, texts, device):
    out = []
    for start in range(0, len(texts), BATCH_SIZE):
        tokens = tokenizer(texts[start:start + BATCH_SIZE]).to(device)
        out.append(model.encode_text(tokens).float().cpu().numpy())
    return normalize(np.concatenate(out))


@torch.no_grad()
def embed_images(model, preprocess, paths, dim, device):
    """Returns (embeddings, found). Rows for missing images are zero and found[i] is False."""
    embeddings = np.zeros((len(paths), dim), dtype=np.float32)
    found = np.array([p.exists() for p in paths])
    rows = np.flatnonzero(found)

    for start in range(0, len(rows), BATCH_SIZE):
        batch = rows[start:start + BATCH_SIZE]
        pixels = []
        for i in batch:
            with Image.open(paths[i]) as image:
                pixels.append(preprocess(image.convert("RGB")))  # resize, center-crop to 224, normalize
        embeddings[batch] = model.encode_image(torch.stack(pixels).to(device)).float().cpu().numpy()
        print(f"  images {min(start + BATCH_SIZE, len(rows))}/{len(rows)}", flush=True)

    return normalize(embeddings), found


def combine(image_emb, text_emb, found):
    # Average the two views where the set has an image; fall back to text alone otherwise.
    # Both inputs are unit vectors, so neither view dominates the average.
    combined = np.where(found[:, None], (image_emb + text_emb) / 2, text_emb)
    return normalize(combined).astype(np.float32)


def project_2d(embeddings):
    """(PCA, t-SNE) layouts for the Insights embedding map."""
    pca = PCA(n_components=2, random_state=0).fit_transform(embeddings)
    # Cosine matches how the recommender compares sets; PCA init + a fixed seed keep reruns stable.
    tsne = TSNE(n_components=2, metric="cosine", init="pca", perplexity=30, random_state=0).fit_transform(embeddings)
    return pca.astype(np.float32), tsne.astype(np.float32)


def main(model_name=MODEL, pretrained=PRETRAINED):
    catalog = pd.read_parquet(CATALOG_PATH)
    device = pick_device()
    print(f"loading {model_name} ({pretrained}) on {device}")
    model, preprocess, tokenizer = load_model(model_name, pretrained, device)

    texts = [prompt(row) for row in catalog.itertuples()]
    text_emb = embed_texts(model, tokenizer, texts, device)

    paths = [image_path(set_id) for set_id in catalog["id"]]
    image_emb, found = embed_images(model, preprocess, paths, text_emb.shape[1], device)

    combined = combine(image_emb, text_emb, found)
    coords, tsne_coords = project_2d(combined)

    np.save(EMBEDDINGS_PATH, combined)
    np.save(IMAGE_EMBEDDINGS_PATH, image_emb.astype(np.float32))
    np.save(TEXT_EMBEDDINGS_PATH, text_emb.astype(np.float32))
    np.save(COORDS_PATH, coords)
    np.save(TSNE_COORDS_PATH, tsne_coords)
    IDS_PATH.write_text(json.dumps(catalog["id"].tolist()))

    print(
        f"embedded {len(catalog)} sets ({found.sum()} with images, {(~found).sum()} text only), "
        f"dim {combined.shape[1]} -> {EMBEDDINGS_PATH.name}"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default=MODEL, help="open_clip architecture, e.g. ViT-B-32-quickgelu, ViT-L-14")
    parser.add_argument("--pretrained", default=PRETRAINED, help="weights tag, e.g. openai, laion2b_s34b_b79k")
    args = parser.parse_args()
    main(args.model, args.pretrained)
