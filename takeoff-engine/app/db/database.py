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

from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from app.config import get_settings
from app.db.orm import Base

_engine = None
_SessionLocal = None


def _normalize_database_url(db_url: str) -> str:
    """Use the psycopg 3 driver declared by this project for Postgres URLs."""
    if db_url.startswith("postgresql://"):
        return f"postgresql+psycopg://{db_url.removeprefix('postgresql://')}"
    if db_url.startswith("postgres://"):
        return f"postgresql+psycopg://{db_url.removeprefix('postgres://')}"
    return db_url


def _engine_kwargs(db_url: str, settings) -> dict:
    if db_url.startswith("sqlite"):
        from sqlalchemy.pool import StaticPool

        return {
            "connect_args": {"check_same_thread": False},
            "poolclass": StaticPool,
        }
    return {
        # Neon/PgBouncer can close an idle TCP connection while it remains in
        # SQLAlchemy's local pool. Validate it before handing it to a request.
        "pool_pre_ping": True,
        "pool_recycle": settings.database_pool_recycle_seconds,
        "pool_timeout": settings.database_pool_timeout_seconds,
        "pool_use_lifo": True,
        "connect_args": {"connect_timeout": settings.database_connect_timeout_seconds},
    }


def get_engine(url: str | None = None):
    global _engine, _SessionLocal
    if _engine is None or url is not None:
        settings = get_settings()
        db_url = _normalize_database_url(url or settings.database_url)
        kwargs = _engine_kwargs(db_url, settings)
        _engine = create_engine(db_url, **kwargs)
        if db_url.startswith("sqlite"):
            # SQLite ships with FK enforcement OFF; without this, tests pass
            # insert orderings that Postgres rejects in production.
            @event.listens_for(_engine, "connect")
            def _enable_sqlite_fks(dbapi_connection, _record):
                dbapi_connection.execute("PRAGMA foreign_keys=ON")

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
    if _engine is not None:
        _engine.dispose()
    _engine = None
    _SessionLocal = None
