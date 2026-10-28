from typing import Literal

from pydantic import BaseModel, Field

SetId = str
Value = Literal[0, 1]  # 1 = like, 0 = pass


class RatingIn(BaseModel):
    set_id: SetId
    value: Value


class RatingsImport(BaseModel):
    """Bulk upload, e.g. ratings already in a browser's localStorage.

    history gives the order to store them in (oldest first) so undo still
    works; ratings missing from history are appended after it.
    """
    ratings: dict[SetId, Value]
    history: list[SetId] = Field(default_factory=list)
