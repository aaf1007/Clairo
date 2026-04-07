import os
import httpx
from google import genai

# These module-level variables hold the single shared client instances.
# They start as None and are created on first use (lazy initialization).
# Reusing one client across all requests is more efficient than creating a
# new connection for every request — it keeps the TCP connection alive (keep-alive).
_groq_client: httpx.AsyncClient | None = None
_gemini_client: genai.Client | None = None


# ──────────────────────────────────────────────
# Dependency injection in FastAPI
# ──────────────────────────────────────────────
# These functions are "dependencies". You don't call them directly.
# Instead, you declare them in an endpoint signature with `Depends()`:
#
#   async def my_endpoint(groq: httpx.AsyncClient = Depends(get_groq_client)):
#
# FastAPI calls the dependency function automatically before your endpoint
# runs, and passes the return value in as the argument. This is FastAPI's
# Dependency Injection (DI) system — it keeps shared resources out of
# your endpoint logic and makes them easy to swap for testing.


async def get_groq_client() -> httpx.AsyncClient:
    """Returns the shared async HTTP client for the Groq API.

    httpx.AsyncClient is an async-native HTTP client (like requests, but async).
    We configure it once with the base URL and auth headers so every service
    that uses Groq just does client.post("/chat/completions", ...) without
    repeating the URL or auth header every time.
    """
    global _groq_client
    if _groq_client is None:
        _groq_client = httpx.AsyncClient(
            base_url="https://api.groq.com/openai/v1",
            headers={
                # Bearer token auth — Groq expects this on every request.
                "Authorization": f"Bearer {os.getenv('GROQ_API_KEY')}",
            },
            timeout=15.0,  # Raise httpx.TimeoutException if no response in 15s.
        )
    return _groq_client


def get_gemini_client() -> genai.Client:
    """Returns the shared Gemini SDK client.

    genai.Client is a synchronous object — it just holds your API key config.
    No network call happens here. The actual API call happens later when you
    call client.models.generate_content() or client.aio.models.generate_content().

    Note: this is a regular (sync) function, not async, because creating the
    client object doesn't do any I/O. FastAPI supports both sync and async
    dependencies.
    """
    global _gemini_client
    if _gemini_client is None:
        _gemini_client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
    return _gemini_client


async def close_clients():
    """Gracefully close HTTP clients when the server shuts down.

    httpx.AsyncClient holds an open connection pool. Calling aclose() drains
    in-flight requests and closes those connections cleanly. Without this,
    you'd see 'Unclosed client session' warnings in the logs.

    The Gemini client doesn't need explicit cleanup — it holds no open connections.
    """
    global _groq_client
    if _groq_client:
        await _groq_client.aclose()
        _groq_client = None
