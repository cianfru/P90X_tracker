# For self-hosting the sync API (e.g. Raspberry Pi behind a Cloudflare Tunnel).
# Railway can use the Procfile instead and skip this.
FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

ENV PORT=8000
EXPOSE 8000
# Shell form so $PORT expands at runtime.
CMD uvicorn main:app --host 0.0.0.0 --port ${PORT}
