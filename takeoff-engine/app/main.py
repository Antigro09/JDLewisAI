"""Takeoff engine — FastAPI app factory."""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse

from app.api import calibration, exports, pipeline, projects, quantities, review, sheets
from app.db.database import init_db

UI_DIR = Path(__file__).resolve().parent.parent / "ui" / "review"


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


def create_app() -> FastAPI:
    app = FastAPI(
        title="Takeoff Engine",
        description=(
            "Open-source-model construction material takeoff. Measurements come from "
            "vector extraction, coordinate OCR, segmentation masks, and deterministic "
            "geometry — never from a language model."
        ),
        version="0.1.0",
        lifespan=lifespan,
    )
    app.include_router(projects.router)
    app.include_router(pipeline.router)
    app.include_router(sheets.router)
    app.include_router(quantities.router)
    app.include_router(review.router)
    app.include_router(calibration.router)
    app.include_router(exports.router)

    @app.get("/health")
    def health():
        return {"status": "ok"}

    @app.get("/review")
    def review_ui():
        return FileResponse(UI_DIR / "index.html", media_type="text/html")

    return app


app = create_app()
