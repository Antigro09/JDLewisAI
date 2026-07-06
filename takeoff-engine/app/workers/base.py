"""Job queue interface — local threads for MVP, RQ/Redis for scale-out."""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Callable


class JobQueue(ABC):
    @abstractmethod
    def enqueue(self, job_id: str, fn: Callable[[], None]) -> None:
        """Run fn in the background; the fn owns job-status bookkeeping."""


def build_queue(kind: str, redis_url: str = ""):
    if kind == "rq":
        from app.workers.rq_worker import RQJobQueue

        return RQJobQueue(redis_url)
    from app.workers.local_worker import LocalJobQueue

    return LocalJobQueue()
