# For self-hosting the sync API (e.g. Raspberry Pi behind a Cloudflare Tunnel).
# Railway can use the Procfile instead and skip this.
# Build from the `web/` directory:  docker build -f api/Dockerfile .
FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY api/ .

ENV PORT=8000
EXPOSE 8000
# Shell form so $PORT expands at runtime.
CMD uvicorn _app:app --host 0.0.0.0 --port ${PORT}
