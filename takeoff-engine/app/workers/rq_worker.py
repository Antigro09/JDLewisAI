"""RQ + Redis job queue (optional; pip install -e '.[worker]').

Enable with TAKEOFF_JOB_QUEUE=rq and TAKEOFF_REDIS_URL. Run workers with:
    rq worker takeoff --url $TAKEOFF_REDIS_URL
Jobs must be module-level callables for RQ pickling — the pipeline entrypoint
app.pipeline.orchestrator.process_project_job satisfies this.
"""

from __future__ import annotations

from collections.abc import Callable

from app.adapters.transport import AdapterNotConfigured
from app.workers.base import JobQueue


class RQJobQueue(JobQueue):
    def __init__(self, redis_url: str):
        try:
            from redis import Redis
            from rq import Queue
        except ImportError as e:
            raise AdapterNotConfigured("RQ worker", "pip install -e '.[worker]'") from e
        self.queue = Queue("takeoff", connection=Redis.from_url(redis_url))

    def enqueue(self, job_id: str, fn: Callable[[], None]) -> None:
        # fn is expected to be a functools.partial over a module-level function.
        self.queue.enqueue(fn.func, *fn.args, **fn.keywords, job_timeout=3600)
