"""Phase 2: download set images into a local cache for CLIP.

Saves data/images/{set id}.jpg, shrunk so the longest side is MAX_SIDE px
(CLIP only sees 224px, and the originals can be several MB each). Safe to
rerun: images already on disk are skipped, so an interrupted run resumes.

Run from the repo root:  python -m ml.images [--limit N]
"""
import argparse
import time
from io import BytesIO

import pandas as pd
import requests
from PIL import Image

from .catalog import CATALOG_PATH, ROOT

IMAGES_DIR = ROOT / "data" / "images"
FAILURES_PATH = IMAGES_DIR / "failures.txt"
MAX_SIDE = 512
DELAY_S = 0.1  # be polite to Rebrickable's CDN


def image_path(set_id):
    return IMAGES_DIR / f"{set_id}.jpg"


def download_image(session, url, dest):
    response = session.get(url, timeout=10)
    response.raise_for_status()

    image = Image.open(BytesIO(response.content))
    image = image.convert("RGB")  # JPEG can't store transparency or palette images
    image.thumbnail((MAX_SIDE, MAX_SIDE))  # in place; keeps aspect ratio, never upscales

    # Write to a temp file and rename, so an interrupted run never leaves a
    # half-written .jpg that the skip check would treat as done.
    tmp = dest.with_suffix(".tmp")
    image.save(tmp, "JPEG", quality=90) # highest quality possible
    tmp.replace(dest)


def main(limit=None):
    catalog = pd.read_parquet(CATALOG_PATH)
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)

    # skip if already downloaded
    todo = catalog[~catalog["id"].map(lambda set_id: image_path(set_id).exists())]
    print(f"{len(catalog) - len(todo)} already cached, {len(todo)} to download")
    if limit:
        todo = todo.head(limit)

    failures = []
    with requests.Session() as session:  # reuses one connection instead of reconnecting per image
        session.headers["User-Agent"] = "stud.io-recommender (personal ML project)"
        for n, (set_id, url) in enumerate(zip(todo["id"], todo["img"]), start=1):
            try:
                download_image(session, url, image_path(set_id))
            except (requests.RequestException, OSError) as e:  # OSError covers unreadable images
                failures.append(f"{set_id}\t{url}\t{e}")
            if n % 100 == 0:
                print(f"  {n}/{len(todo)}", flush=True)
            time.sleep(DELAY_S)

    FAILURES_PATH.write_text("".join(line + "\n" for line in failures))
    print(f"done: {len(todo) - len(failures)} downloaded, {len(failures)} failed")
    if failures:
        print(f"see {FAILURES_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, help="only download this many (for testing)")
    main(parser.parse_args().limit)
