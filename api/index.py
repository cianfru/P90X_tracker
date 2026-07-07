"""
Vercel Python serverless entrypoint.

Vercel's @vercel/python runtime serves the ASGI `app` exported here. All routes
are rewritten to this file by vercel.json, so /health, /sync/push and /sync/pull
are handled by the same FastAPI app used for local/long-running runs.
"""

from main import app  # noqa: F401  (re-exported for the Vercel runtime)
