"""SQLAlchemy tables.

Pattern: indexed key columns for filtering + the full Pydantic payload in a
JSON `data` column. The Pydantic schemas remain the single source of truth
for shape; the DB stores them losslessly and stays migration-light while the
schemas iterate. Artifacts (OCR spans, vectors, masks, geometries, scales,
detections, viewports) share one polymorphic table keyed by `kind`.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def utcnow() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    pass


# NOTE on the relationship() declarations below: they exist so the unit of
# work knows the FK dependencies between mappers. Without them, SQLAlchemy
# may emit child INSERTs (artifacts, quantities...) before the parent sheet/
# project row — SQLite tolerates that unless FKs are enabled; Postgres does
# not. None of them are used for attribute access.


class ProjectRow(Base):
    __tablename__ = "projects"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(32), default="created")
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class FileRow(Base):
    __tablename__ = "files"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    filename: Mapped[str] = mapped_column(String(512))
    storage_path: Mapped[str] = mapped_column(String(1024))
    media_type: Mapped[str] = mapped_column(String(64), default="application/pdf")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    _project = relationship("ProjectRow")


class SheetRow(Base):
    __tablename__ = "sheets"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    page_number: Mapped[int] = mapped_column(Integer)
    sheet_number: Mapped[str] = mapped_column(String(32), default="")
    sheet_type: Mapped[str] = mapped_column(String(32), default="unknown")
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    _project = relationship("ProjectRow")


class ArtifactRow(Base):
    """Polymorphic pipeline artifacts: ocr_span, ocr_table, vector_path,
    raster_page, viewport, scale, detection, mask, geometry."""

    __tablename__ = "artifacts"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    sheet_id: Mapped[str] = mapped_column(ForeignKey("sheets.id"), index=True)
    kind: Mapped[str] = mapped_column(String(32), index=True)
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    _sheet = relationship("SheetRow")


class QuantityRow(Base):
    __tablename__ = "quantities"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    sheet_id: Mapped[str] = mapped_column(ForeignKey("sheets.id"), index=True)
    item_type: Mapped[str] = mapped_column(String(64), index=True)
    unit: Mapped[str] = mapped_column(String(16))
    quantity: Mapped[float] = mapped_column(Float)
    needs_review: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    review_status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    _project = relationship("ProjectRow")
    _sheet = relationship("SheetRow")


class ReviewDecisionRow(Base):
    __tablename__ = "review_decisions"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    quantity_item_id: Mapped[str] = mapped_column(ForeignKey("quantities.id"), index=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    action: Mapped[str] = mapped_column(String(16))
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    _quantity = relationship("QuantityRow")
    _project = relationship("ProjectRow")


class ExportJobRow(Base):
    __tablename__ = "export_jobs"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    format: Mapped[str] = mapped_column(String(8))
    status: Mapped[str] = mapped_column(String(16), default="pending")
    file_path: Mapped[str] = mapped_column(String(1024), default="")
    error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    _project = relationship("ProjectRow")


class JobRow(Base):
    """Background pipeline jobs (processing runs)."""

    __tablename__ = "jobs"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    kind: Mapped[str] = mapped_column(String(32), default="process")
    status: Mapped[str] = mapped_column(String(16), default="queued", index=True)
    progress: Mapped[str] = mapped_column(String(255), default="")
    error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    _project = relationship("ProjectRow")
