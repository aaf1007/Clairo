import asyncio
import json
import re
from pathlib import Path

import httpx
from google import genai
from google.genai import types

from app.models.schemas import ClaimAnalysis, Verdict


# Load the system prompt once at module import time (not on every request).
# Path(__file__) is the path to this file. We navigate up two levels to reach
# the app/ directory, then into prompts/. read_text() returns the file contents as a string.
_PROMPT_PATH = Path(__file__).parent.parent / "prompts" / "fact_verification.md"
SYSTEM_PROMPT = _PROMPT_PATH.read_text()
GEMINI_MODEL = "gemini-2.5-flash"

_VERDICT_SCHEMA = types.Schema(
    type=types.Type.OBJECT,
    properties={
        "verdict": types.Schema(type=types.Type.STRING, enum=["TRUE", "FALSE", "MOSTLY_TRUE", "MOSTLY_FALSE", "UNVERIFIABLE"]),
        "confidence": types.Schema(type=types.Type.NUMBER),
        "explanation": types.Schema(type=types.Type.STRING),
        "sources": types.Schema(type=types.Type.ARRAY, items=types.Schema(type=types.Type.STRING)),
        "domain": types.Schema(type=types.Type.STRING, enum=["health", "science", "politics", "history", "finance", "technology", "sports", "geography", "other"]),
    },
    required=["verdict", "confidence", "explanation", "domain"],
)


def _unverifiable_analysis(claim: str, explanation: str, *, sources: list[str] | None = None) -> ClaimAnalysis:
    """Build a consistent degraded response when Gemini returns unusable data."""
    return ClaimAnalysis(
        statement=claim,
        verdict=Verdict.UNVERIFIABLE,
        confidence=0.0,
        explanation=explanation,
        sources=sources or [],
        domain="other",
    )


def _extract_json_from_response(content: str) -> dict | None:
    """Try multiple strategies to extract a JSON dict from a Gemini response.

    When Search Grounding is active Gemini may wrap the JSON in prose or
    markdown fences. This function tries progressively looser strategies so
    we only fall back to a second API call as a last resort.
    """
    # Strategy 1: direct parse (response is pure JSON)
    try:
        return json.loads(content.strip())
    except (json.JSONDecodeError, ValueError):
        pass

    # Strategy 2: markdown code fence  ```json ... ``` or ``` ... ```
    fence_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", content, re.DOTALL)
    if fence_match:
        try:
            return json.loads(fence_match.group(1))
        except (json.JSONDecodeError, ValueError):
            pass

    # Strategy 3: brace slicing — grab everything between first { and last }
    first_brace = content.find("{")
    last_brace = content.rfind("}")
    if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
        try:
            return json.loads(content[first_brace:last_brace + 1])
        except (json.JSONDecodeError, ValueError):
            pass

    # Strategy 4: regex field extraction from natural language
    verdict_match = re.search(
        r'(?:verdict|ruling|assessment)["\s:*]+\**\s*(TRUE|FALSE|MOSTLY_TRUE|MOSTLY_FALSE|UNVERIFIABLE)\**',
        content, re.IGNORECASE,
    )
    confidence_match = re.search(r'(?:confidence)["\s:]+(\d+\.?\d*)', content, re.IGNORECASE)
    domain_match = re.search(
        r'(?:domain)["\s:*]+\**\s*(health|science|politics|history|finance|technology|sports|geography|other)\**',
        content, re.IGNORECASE,
    )
    if verdict_match:
        # Best-effort explanation: grab first substantive paragraph
        paragraphs = [p.strip() for p in content.split("\n") if len(p.strip()) > 60]
        explanation = paragraphs[0] if paragraphs else content[:200].strip()
        return {
            "verdict": verdict_match.group(1).upper(),
            "confidence": float(confidence_match.group(1)) if confidence_match else 0.5,
            "explanation": explanation,
            "sources": [],
            "domain": domain_match.group(1).lower() if domain_match else "other",
        }

    return None


def _extract_response_text(response) -> str:
    """Return Gemini text from either response.text or candidate content parts."""
    text = getattr(response, "text", None)
    if isinstance(text, str) and text.strip():
        return text.strip()

    candidates = getattr(response, "candidates", None) or []
    if not candidates:
        return ""

    content = getattr(candidates[0], "content", None)
    parts = getattr(content, "parts", None) or []
    texts = []
    for part in parts:
        part_text = getattr(part, "text", None)
        if isinstance(part_text, str) and part_text.strip():
            texts.append(part_text.strip())
    return "\n".join(texts)


def _extract_grounding_urls(response) -> list[str]:
    """Safely extract grounded source URLs from the first Gemini candidate."""
    candidates = getattr(response, "candidates", None) or []
    if not candidates:
        return []

    grounding = getattr(candidates[0], "grounding_metadata", None)
    grounding_chunks = getattr(grounding, "grounding_chunks", None) or []

    urls = []
    for chunk in grounding_chunks:
        web = getattr(chunk, "web", None)
        uri = getattr(web, "uri", None)
        if isinstance(uri, str) and uri:
            urls.append(uri)
    return urls


async def _reformat_with_gemini(client: genai.Client, raw_text: str, claim: str) -> dict | None:
    """Last-resort: ask Gemini (no grounding, forced JSON) to reformat raw_text.

    Only called when all local extraction strategies fail. Uses
    response_mime_type + response_schema for guaranteed JSON output.
    """
    prompt = (
        f"A fact-check was performed for this claim: {claim}\n\n"
        f"The raw research response was:\n{raw_text}\n\n"
        "Extract and return the fact-check verdict as structured JSON."
    )
    try:
        response = await client.aio.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=_VERDICT_SCHEMA,
                temperature=0.0,
            ),
        )
        response_text = _extract_response_text(response)
        if not response_text:
            return None
        return json.loads(response_text)
    except Exception as e:
        print(f"Reformat fallback failed: {e}")
        return None


async def _resolve_source_url(url: str) -> str:
    """Follow redirects on Vertex AI Search proxy URLs to get the real source URL."""
    if "vertexaisearch.cloud.google" not in url:
        return url
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=5) as client:
            resp = await client.head(url)
            return str(resp.url)
    except Exception:
        return url


async def verify_claim(client: genai.Client, claim: str) -> ClaimAnalysis:
    """Send a single claim to Gemini and return a structured ClaimAnalysis.

    This is the core of the fact-checking pipeline. Gemini is called with
    Google Search Grounding enabled, meaning it queries Google in real-time
    before composing its response. The verdict JSON comes from the model's
    text output; the source URLs come from the grounding metadata (actual
    Google Search results), not from the model's text — this is more reliable
    than asking the LLM to cite sources itself.

    If the model returns unparseable output, the function degrades gracefully
    to UNVERIFIABLE rather than raising an exception and crashing the request.

    Flow: called by verify_claims() for each ExtractedClaim → returns ClaimAnalysis

    Args:
        client: The shared Gemini SDK client injected from dependencies.py.
            Uses client.aio (the async interface) so the server can handle
            other requests while waiting for Gemini to respond.
        claim: A single extracted claim string, e.g.
            "The Eiffel Tower is 330 metres tall."

    Returns:
        A ClaimAnalysis containing the verdict, confidence score, explanation,
        source URLs from Google Search grounding, and topic domain.

    Raises:
        This function does not raise. JSON parse failures are caught internally
        and returned as a ClaimAnalysis with verdict=UNVERIFIABLE.
    """
    # Retry once on 429 rate-limit errors using the suggested retry delay.
    # This handles per-minute quota hits gracefully without crashing the request.
    
    response = None # response assigned with initial value

    for attempt in range(2):
        try:
            response = await client.aio.models.generate_content(
                model=GEMINI_MODEL,
                contents=f"Fact-check this claim: {claim}",
                config=types.GenerateContentConfig(
                    system_instruction=SYSTEM_PROMPT,
                    tools=[types.Tool(google_search=types.GoogleSearch())],
                    temperature=0.1,
                ),
            )
            break  # success — exit retry loop
        except Exception as e:
            if "429" in str(e) and attempt == 0:
                # Extract suggested retry delay from the error, default to 10s
                match = re.search(r"retry[^\d]*(\d+(?:\.\d+)?)", str(e), re.IGNORECASE)
                delay = float(match.group(1)) + 1 if match else 10
                print(f"Gemini rate limited, retrying in {delay}s...")
                await asyncio.sleep(delay)
            else:
                # Daily quota exhausted or non-retryable error — degrade gracefully
                print(f"Gemini failed for claim '{claim[:50]}': {e}")
                return _unverifiable_analysis(
                    claim,
                    "Verification unavailable (API quota exceeded).",
                )

    print(f"response before _extract_response_text: {response}")

    # Gemini occasionally returns partial responses with missing text or
    # candidates (for example blocked or empty outputs). Treat those as a
    # degraded verification result instead of crashing the whole request.
    content = _extract_response_text(response)

    sources = []
    raw_urls = _extract_grounding_urls(response)
    if raw_urls:
        sources = list(await asyncio.gather(*[_resolve_source_url(url) for url in raw_urls]))

    if not content:
        return _unverifiable_analysis(
            claim,
            "Gemini returned no usable verification result.",
            sources=sources,
        )

    # Try multi-strategy JSON extraction from the model's text response.
    # When Search Grounding is active Gemini often wraps JSON in prose or
    # markdown — _extract_json_from_response handles that gracefully.
    print(f"Raw Gemini response for '{claim[:50]}': {content[:300]}")
    result = _extract_json_from_response(content)

    if result is None:
        # All local strategies failed — make a second (non-grounded) call to
        # reformat the raw text into guaranteed JSON.
        print(f"Local JSON extraction failed for '{claim[:50]}', attempting reformat...")
        result = await _reformat_with_gemini(client, content, claim)

    if result is None:
        return _unverifiable_analysis(
            claim,
            "Failed to parse verification response.",
            sources=sources,
        )

    # Validate the verdict string. The model might return something unexpected
    # (e.g. "UNCERTAIN"), so we check against our known enum values and fall
    # back to UNVERIFIABLE if it doesn't match.
    valid_verdicts = {v.value for v in Verdict}
    raw_verdict = str(result.get("verdict", "UNVERIFIABLE")).upper()
    verdict = Verdict(raw_verdict) if raw_verdict in valid_verdicts else Verdict.UNVERIFIABLE

    # If grounding metadata had no sources, fall back to the model's cited sources.
    if not sources:
        result_sources = result.get("sources", [])
        if isinstance(result_sources, list):
            sources = [source for source in result_sources if isinstance(source, str)]

    print(f"Sources count: {len(sources)}")
    for i, source in enumerate(sources):
        print(f"Claim analysis source[{i}]: {source}")

    try:
        confidence = float(result.get("confidence", 0.5))
    except (TypeError, ValueError):
        confidence = 0.5

    return ClaimAnalysis(
        statement=claim,
        verdict=verdict,
        # .get() with a default prevents KeyError if the model omits a field.
        confidence=confidence,
        explanation=str(result.get("explanation") or ""),
        sources=sources[:3],
        domain=str(result.get("domain") or "other"),
    )


async def verify_claims(client: genai.Client, claims: list) -> list[ClaimAnalysis]:
    """Verify all extracted claims and return the full list of results.

    Iterates over the claims produced by claim_extractor.py, calls verify_claim()
    for each one, and carries the checkability rating forward into the result.

    Claims are processed sequentially (one at a time) for simplicity in v1.
    When you're ready to optimize, replace this loop with asyncio.gather() to
    verify all claims concurrently — the async design here already supports it.

    Flow: receives list[ExtractedClaim] from fact_check.py router →
          calls verify_claim() for each → returns list[ClaimAnalysis] to router

    Args:
        client: The shared Gemini SDK client injected from dependencies.py.
        claims: The list of ExtractedClaim objects produced by claim_extractor.py.
            Each has a .claim string and a .checkability rating.

    Returns:
        A list of ClaimAnalysis objects in the same order as the input claims.
    """
    # Verify all claims concurrently instead of sequentially.
    # With N claims each taking ~3s, sequential = N*3s; concurrent = ~3s regardless of N.
    analyses = await asyncio.gather(*[verify_claim(client, extracted.claim) for extracted in claims])

    for analysis, extracted in zip(analyses, claims):
        analysis.checkability = extracted.checkability

    return list(analyses)
