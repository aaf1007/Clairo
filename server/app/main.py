import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.dependencies import close_clients
from app.routers import fact_check, transcribe


# Load environment variables from the .env file into os.getenv().
# This must happen before anything else so API keys are available at import time.
load_dotenv()


# ──────────────────────────────────────────────
# Lifespan: startup + shutdown events
# ──────────────────────────────────────────────

# FastAPI's lifespan replaces the old @app.on_event("startup") / @app.on_event("shutdown")
# pattern. Everything before `yield` runs on startup; everything after runs on shutdown.
# The @asynccontextmanager decorator turns this generator function into a context manager
# that FastAPI knows how to call automatically.
@asynccontextmanager
async def lifespan(app: FastAPI):
    # STARTUP — runs once when the server process starts
    print("VerifAI API starting up...")

    # Warn early if keys are missing so the error is obvious in logs,
    # rather than appearing as a cryptic 500 error on the first request.
    if not os.getenv("GROQ_API_KEY"):
        print("WARNING: GROQ_API_KEY not set — claim extraction will fail")
    if not os.getenv("GEMINI_API_KEY"):
        print("WARNING: GEMINI_API_KEY not set — fact verification will fail")

    yield  # The server runs here, handling requests until it is stopped.

    # SHUTDOWN — runs once when the server process stops (Ctrl+C, deploy restart, etc.)
    print("Shutting down, closing HTTP clients...")
    await close_clients()


# ──────────────────────────────────────────────
# Create the app
# ──────────────────────────────────────────────

# FastAPI() creates the ASGI application. The title and description appear in the
# auto-generated docs at http://localhost:8000/docs (Swagger UI).
# Passing `lifespan=lifespan` wires up our startup/shutdown handler above.
app = FastAPI(
    title="VerifAI API",
    description="AI-powered fact-checking backend for the VerifAI Chrome extension",
    version="0.1.0",
    lifespan=lifespan,
)


# ──────────────────────────────────────────────
# CORS — allow the Chrome extension to call this API
# ──────────────────────────────────────────────

# Browsers (and Chrome extensions) block cross-origin requests by default.
# CORSMiddleware adds the Access-Control-Allow-Origin headers that tell the browser
# it's safe to send requests from the extension to this backend.
#
# In development, ALLOWED_ORIGINS=* permits any origin.
# In production, set ALLOWED_ORIGINS to your extension's chrome-extension://<id> URL
# so no other site can call your API.
allowed_origins = os.getenv("ALLOWED_ORIGINS", "*")
origins = [o.strip() for o in allowed_origins.split(",")] if allowed_origins != "*" else ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)


# ──────────────────────────────────────────────
# Register routers
# ──────────────────────────────────────────────

# Routers are mini-apps that group related endpoints.
# include_router() mounts them onto the main app so their routes become active.
# Each router file defines its own prefix (e.g. /api), so you don't set it here.
app.include_router(fact_check.router)
app.include_router(transcribe.router)


# ──────────────────────────────────────────────
# Health check
# ──────────────────────────────────────────────

# A simple endpoint that returns 200 OK. Useful for Railway/Render to confirm
# the server is running, and for you to quickly verify the API is reachable.
@app.get("/health", tags=["system"])
async def health():
    """Simple health check endpoint."""
    return {"status": "ok", "service": "verifai"}
