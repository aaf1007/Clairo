import json
from datetime import datetime

import httpx
from fastapi import APIRouter, Depends, HTTPException
from google import genai

from app.dependencies import get_gemini_client, get_groq_client
from app.models.schemas import FactCheckRequest, FactCheckResponse, Verdict
from app.services.claim_extractor import extract_claims
from app.services.fact_checker import verify_claims
from app.services.text_cleaner import clean_text


# APIRouter groups related endpoints under a shared URL prefix and tag.
# prefix="/api" means every route defined here will start with /api.
# tags=["fact-check"] groups them together in the Swagger UI at /docs.
router = APIRouter(prefix="/api", tags=["fact-check"])

SUMMARY_SYSTEM_PROMPT = (
    "You summarize fact-check results for a browser extension popup card. "
    "Respond with ONLY a JSON object with two fields — no markdown fences, no preamble:\n"
    '{"title": "...", "summary": "..."}\n'
    "title: a short 3-7 word noun phrase naming the topic (e.g. \"Climate Change and Sea Levels\"). No verdict words.\n"
    "summary: exactly 2 sentences. Sentence 1: what the selected text is about. "
    "Sentence 2: a comma-separated list of the key claims checked. Under 220 chars total."
)


# @router.post("/fact-check") registers this function as the handler for
# POST /api/fact-check. The `response_model` tells FastAPI which Pydantic
# model to use for the response — it validates the return value and generates
# the correct schema in the docs automatically.
@router.post("/fact-check", response_model=FactCheckResponse)
async def fact_check(
    # FastAPI reads the JSON request body and deserializes it into a
    # FactCheckRequest Pydantic model automatically. If the body is missing
    # required fields or has wrong types, FastAPI returns a 422 error
    # before your code even runs.
    request: FactCheckRequest,
    # Depends() tells FastAPI to call get_groq_client() and inject the result
    # here. The client is shared across all requests (singleton pattern).
    groq: httpx.AsyncClient = Depends(get_groq_client),
    # Same pattern for the Gemini client.
    gemini: genai.Client = Depends(get_gemini_client),
):
    """
    Main fact-checking endpoint.

    Pipeline:
    1. Clean the highlighted text
    2. Extract individual claims via Groq
    3. Verify each claim via Gemini with Google Search Grounding
    4. Aggregate and return results
    """
    # Step 1: Clean the input text.
    # Strips invisible Unicode characters and collapses whitespace.
    # If the text is entirely whitespace/invisible chars, we return 400 (bad request).
    # HTTPException is FastAPI's way of returning an error response — raising it
    # immediately stops the function and sends the error to the client.
    cleaned = clean_text(request.text)
    if not cleaned:
        raise HTTPException(status_code=400, detail="Text is empty after cleaning")

    # Step 2: Extract individual claims from the cleaned text via Groq.
    # We wrap this in try/except to convert low-level network errors into
    # clean HTTP error responses. The client only sees a 502 or 504, not a
    # Python traceback.
    try:
        claims = await extract_claims(groq, cleaned, request.context)
    except httpx.TimeoutException:
        # The Groq API didn't respond within 15 seconds.
        raise HTTPException(status_code=504, detail="Claim extraction timed out")
    except httpx.HTTPStatusError as e:
        # Groq responded with a 4xx or 5xx error (e.g. invalid API key → 401).
        raise HTTPException(status_code=502, detail=f"Groq API error: {e.response.status_code}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Claim extraction failed: {str(e)}")

    # If no checkable claims were found (e.g. the text is pure opinion),
    # return a valid response rather than an error — it's not the user's fault.
    if not claims:
        return FactCheckResponse(
            overall_verdict=Verdict.UNVERIFIABLE,
            summary="No verifiable factual claims were found in the selected text.",
            claims=[],
            checked_at=datetime.utcnow(),
            source_url=request.url,
        )

    # Step 3: Verify each claim via Gemini with Google Search Grounding.
    # The Gemini SDK raises its own exception types (not httpx), so we use a
    # broad `except Exception` here and surface the message to the client.
    try:
        results = await verify_claims(gemini, claims)
    except Exception as e:
        print(f"Gemini error: {type(e).__name__}: {e}")
        raise HTTPException(status_code=502, detail=f"Gemini API error: {str(e)}")

    # Step 4: Aggregate the individual verdicts into a single overall verdict
    # and build a human-readable summary string.
    overall = _aggregate_verdict(results)
    title, summary = await _build_summary(groq, cleaned, results)

    # FastAPI automatically serializes this Pydantic model to JSON.
    return FactCheckResponse(
        overall_verdict=overall,
        title=title,
        summary=summary,
        claims=results,
        checked_at=datetime.utcnow(),
        source_url=request.url,
    )


def _aggregate_verdict(claims) -> Verdict:
    """Determine one overall verdict from the list of individual claim verdicts.

    The logic is intentionally simple for v1: any FALSE claim drags the whole
    response to MOSTLY_FALSE. You can make this weighted or confidence-based later.
    """
    verdicts = [c.verdict for c in claims]

    if Verdict.FALSE in verdicts:
        return Verdict.MOSTLY_FALSE
    if Verdict.MOSTLY_FALSE in verdicts:
        return Verdict.MOSTLY_FALSE
    if all(v == Verdict.TRUE for v in verdicts):
        return Verdict.TRUE
    if all(v == Verdict.UNVERIFIABLE for v in verdicts):
        return Verdict.UNVERIFIABLE
    return Verdict.MOSTLY_TRUE


async def _build_summary(groq: httpx.AsyncClient, selected_text: str, claims) -> tuple[str, str]:
    """Build a title and 2-sentence summary using Groq.

    Returns (title, summary). Falls back to generated values if the Groq call fails.
    """
    try:
        claim_list = "; ".join(c.statement for c in claims)
        prompt = (
            f"Selected text (may be long): {selected_text[:500]}\n\n"
            f"Claims checked: {claim_list}"
        )
        response = await groq.post(
            "/chat/completions",
            json={
                "model": "llama-3.3-70b-versatile",
                "messages": [
                    {"role": "system", "content": SUMMARY_SYSTEM_PROMPT},
                    {"role": "user", "content": prompt},
                ],
                "temperature": 0.2,
                "max_tokens": 120,
            },
        )
        response.raise_for_status()
        raw = response.json()["choices"][0]["message"]["content"].strip()
        parsed = json.loads(raw)
        return parsed["title"], parsed["summary"]
    except Exception:
        total = len(claims)
        true_count = sum(1 for c in claims if c.verdict in (Verdict.TRUE, Verdict.MOSTLY_TRUE))
        false_count = sum(1 for c in claims if c.verdict in (Verdict.FALSE, Verdict.MOSTLY_FALSE))
        unverified = sum(1 for c in claims if c.verdict == Verdict.UNVERIFIABLE)
        parts = [f"Analyzed {total} claim{'s' if total != 1 else ''}."]
        if true_count:
            parts.append(f"{true_count} verified as true or mostly true.")
        if false_count:
            parts.append(f"{false_count} found to be false or misleading.")
        if unverified:
            parts.append(f"{unverified} could not be verified.")
        return "Fact Check Result", " ".join(parts)
