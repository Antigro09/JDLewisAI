FROM python:3.11-slim

# OpenCV runtime needs libgl/glib even in headless builds' transitive paths.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*

WORKDIR /srv/takeoff-engine
COPY pyproject.toml README.md ./
COPY app ./app
COPY ui ./ui
RUN pip install --no-cache-dir -e .

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
