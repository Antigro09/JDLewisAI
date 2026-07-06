"""Thread-pool job queue — the MVP default. One process, no broker.
Jobs survive only as long as the process; the jobs table records state so a
restart shows 'running' jobs that died (surfaced, not hidden)."""

from __future__ import annotations

import logging
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor

from app.workers.base import JobQueue

log = logging.getLogger(__name__)


class LocalJobQueue(JobQueue):
    def __init__(self, max_workers: int = 2):
        self.pool = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="takeoff-job")

    def enqueue(self, job_id: str, fn: Callable[[], None]) -> None:
        def _run():
            try:
                fn()
            except Exception:
                log.exception("job %s crashed", job_id)

        self.pool.submit(_run)
