.PHONY: install dev test lint run fixture

install:
	pip install -e .

dev:
	pip install -e ".[dev]"

test:
	python -m pytest tests/ -q

lint:
	python -m ruff check app tests

run:
	uvicorn app.main:app --reload --port 8000

fixture:
	python tests/fixtures/make_fixture.py fixture_plan.pdf
