"""Storage backend interface. Local FS now; S3/MinIO later by implementing
the same four methods (paths stay storage-relative keys everywhere)."""

from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path


class StorageBackend(ABC):
    @abstractmethod
    def save(self, key: str, data: bytes) -> str:
        """Store bytes under a key; return the key."""

    @abstractmethod
    def open_path(self, key: str) -> Path:
        """Local filesystem path for a key (S3 impls download to a temp file)."""

    @abstractmethod
    def exists(self, key: str) -> bool: ...

    @abstractmethod
    def url(self, key: str) -> str:
        """A URL/path the API can serve or redirect to."""
