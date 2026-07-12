from sqlalchemy.pool import StaticPool

from app.config import Settings
from app.db.database import _engine_kwargs, _normalize_database_url


def test_plain_postgres_url_uses_declared_psycopg_driver():
    url = "postgresql://user:password@example.neon.tech/takeoff?sslmode=require"

    assert _normalize_database_url(url) == (
        "postgresql+psycopg://user:password@example.neon.tech/takeoff?sslmode=require"
    )


def test_postgres_engine_checks_and_recycles_pooled_connections():
    settings = Settings(
        database_url="postgresql+psycopg://user:password@example.test/takeoff",
        database_pool_recycle_seconds=240,
        database_pool_timeout_seconds=12,
        database_connect_timeout_seconds=7,
    )

    options = _engine_kwargs(settings.database_url, settings)

    assert options == {
        "pool_pre_ping": True,
        "pool_recycle": 240,
        "pool_timeout": 12,
        "pool_use_lifo": True,
        "connect_args": {"connect_timeout": 7},
    }


def test_sqlite_keeps_single_connection_test_pool():
    options = _engine_kwargs("sqlite:///:memory:", Settings(database_url="sqlite:///:memory:"))

    assert options["connect_args"] == {"check_same_thread": False}
    assert options["poolclass"] is StaticPool
    assert "pool_pre_ping" not in options
