"""Job queue interface — local threads for MVP, RQ/Redis for scale-out."""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Callable


class JobQueue(ABC):
    @abstractmethod
    def enqueue(self, job_id: str, fn: Callable[[], None]) -> None:
        """Run fn in the background; the fn owns job-status bookkeeping."""


class InlineJobQueue(JobQueue):
    def enqueue(self, job_id: str, fn: Callable[[], None]) -> None:
        fn()


def build_queue(kind: str, redis_url: str = ""):
    if kind == "inline":
        return InlineJobQueue()
    if kind == "rq":
        from app.workers.rq_worker import RQJobQueue

        return RQJobQueue(redis_url)
    from app.workers.local_worker import LocalJobQueue

    return LocalJobQueue()
