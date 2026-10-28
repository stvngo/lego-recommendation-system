"""SQLite storage for ratings.

One connection per call: sqlite3 connections can't be shared across threads,
and FastAPI runs plain `def` endpoints in a thread pool. Opening a local
SQLite file takes microseconds, so there's no need for a pool.

Set STUDIO_DB to use a different database file (e.g. for tests).
"""
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from ml.catalog import ROOT

DB_PATH = Path(os.environ.get("STUDIO_DB", ROOT / "data" / "studio.db"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,  -- insertion order, which is what undo pops
    user_id TEXT NOT NULL,
    set_id TEXT NOT NULL,
    value INTEGER NOT NULL CHECK (value IN (0, 1)),
    created_at TEXT NOT NULL,
    UNIQUE (user_id, set_id)
)
"""

# INSERT OR REPLACE deletes the old row and inserts a new one with a fresh id,
# so re-rating a set moves it to the end of the history (an upsert with
# ON CONFLICT DO UPDATE would keep the old id and undo would skip it).
UPSERT = "INSERT OR REPLACE INTO ratings (user_id, set_id, value, created_at) VALUES (?, ?, ?, ?)"


@contextmanager
def connect():
    conn = sqlite3.connect(DB_PATH)
    try:
        with conn:  # commits on success, rolls back if the block raises
            yield conn
    finally:
        conn.close()


def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with connect() as conn:
        conn.execute(SCHEMA)


def _now():
    return datetime.now(timezone.utc).isoformat()


def add_rating(user_id, set_id, value):
    with connect() as conn:
        conn.execute(UPSERT, (user_id, set_id, value, _now()))


def add_ratings(user_id, items):
    """items: iterable of (set_id, value), oldest first."""
    now = _now()
    with connect() as conn:
        conn.executemany(UPSERT, [(user_id, set_id, value, now) for set_id, value in items])


def undo_last(user_id):
    """Delete the user's most recent rating; returns its set_id, or None if there are none."""
    with connect() as conn:
        row = conn.execute(
            "SELECT id, set_id FROM ratings WHERE user_id = ? ORDER BY id DESC LIMIT 1", (user_id,)
        ).fetchone()
        if row is None:
            return None
        conn.execute("DELETE FROM ratings WHERE id = ?", (row[0],))
        return row[1]


def get_ratings(user_id):
    """(ratings {set_id: value}, history [set_id, ...] oldest first)."""
    with connect() as conn:
        rows = conn.execute(
            "SELECT set_id, value FROM ratings WHERE user_id = ? ORDER BY id", (user_id,)
        ).fetchall()
    return dict(rows), [set_id for set_id, _ in rows]
