"""Engine/session setup.

Production: PostgreSQL — its own `takeoff` database inside the same cluster
the main app uses (see README "Database"). Tests: in-memory SQLite; the ORM
sticks to dialect-portable types (JSON, not JSONB) to keep both working.

Migrations: MVP uses create_all(). Introduce Alembic before the first schema
change that must preserve data.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import get_settings
from app.db.orm import Base

_engine = None
_SessionLocal = None


def get_engine(url: str | None = None):
    global _engine, _SessionLocal
    if _engine is None or url is not None:
        settings = get_settings()
        db_url = url or settings.database_url
        kwargs = {}
        if db_url.startswith("sqlite"):
            kwargs["connect_args"] = {"check_same_thread": False}
            from sqlalchemy.pool import StaticPool

            kwargs["poolclass"] = StaticPool
        _engine = create_engine(db_url, **kwargs)
        _SessionLocal = sessionmaker(bind=_engine, expire_on_commit=False)
    return _engine


def init_db(url: str | None = None) -> None:
    Base.metadata.create_all(get_engine(url))


@contextmanager
def session_scope() -> Iterator[Session]:
    get_engine()
    session = _SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_session() -> Iterator[Session]:
    """FastAPI dependency."""
    with session_scope() as s:
        yield s


def reset_engine_for_tests() -> None:
    global _engine, _SessionLocal
    _engine = None
    _SessionLocal = None
