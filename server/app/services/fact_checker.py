import json
from pathlib import Path

from google import genai
from google.genai import types

from app.models.schemas import ClaimAnalysis, Verdict


# Load the system prompt once at module import time (not on every request).
# Path(__file__) is the path to this file. We navigate up two levels to reach
# the app/ directory, then into prompts/. read_text() returns the file contents as a string.
_PROMPT_PATH = Path(__file__).parent.parent / "prompts" / "fact_verification.md"
SYSTEM_PROMPT = _PROMPT_PATH.read_text()


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
    # client.aio is the async namespace of the Gemini SDK.
    # Using `await` here means this coroutine suspends while waiting for Gemini
    # to respond, allowing other async work (e.g. other requests) to run in the meantime.
    response = await client.aio.models.generate_content(
        model="gemini-2.5-flash",
        contents=f"Fact-check this claim: {claim}",
        config=types.GenerateContentConfig(
            # The system instruction primes Gemini's behavior — it tells the model
            # to respond with a specific JSON format and to reason like a fact-checker.
            system_instruction=SYSTEM_PROMPT,
            # Passing a GoogleSearch tool enables Google Search Grounding.
            # Gemini will query Google before answering, and the results are
            # reflected in both the text response and the grounding_metadata.
            tools=[types.Tool(google_search=types.GoogleSearch())],
            # Low temperature = more deterministic, less creative. Good for
            # structured fact-checking where we want consistent JSON output.
            temperature=0.1,
        ),
    )

    # response.text is the raw text the model generated (our verdict JSON).
    content = response.text

    # Extract source URLs from grounding metadata.
    # grounding_metadata.grounding_chunks is a list of search result objects.
    # Each chunk has a .web attribute with a .uri (the URL) and .title.
    # We only keep chunks that have a .web attribute (some may be other types).
    grounding = response.candidates[0].grounding_metadata
    sources = []
    if grounding and grounding.grounding_chunks:
        sources = [chunk.web.uri for chunk in grounding.grounding_chunks if chunk.web]

    # LLMs sometimes wrap JSON in markdown code fences like ```json ... ```.
    # We detect this and slice out just the JSON object between { and }.
    first_brace = content.find("{")
    last_brace = content.rfind("}")
    if first_brace != -1 and last_brace != -1:
        cleaned = content[first_brace:last_brace + 1]
    else:
        cleaned = content.strip()

    # Parse the JSON. If the model returned something unparseable, we degrade
    # gracefully to UNVERIFIABLE rather than crashing the whole request.
    try:
        result = json.loads(cleaned)
    except json.JSONDecodeError:
        return ClaimAnalysis(
            statement=claim,
            verdict=Verdict.UNVERIFIABLE,
            confidence=0.0,
            explanation="Failed to parse verification response.",
            sources=sources,
            domain="other",
        )

    # Validate the verdict string. The model might return something unexpected
    # (e.g. "UNCERTAIN"), so we check against our known enum values and fall
    # back to UNVERIFIABLE if it doesn't match.
    valid_verdicts = {v.value for v in Verdict}
    raw_verdict = result.get("verdict", "UNVERIFIABLE").upper()
    verdict = Verdict(raw_verdict) if raw_verdict in valid_verdicts else Verdict.UNVERIFIABLE

    return ClaimAnalysis(
        statement=claim,
        verdict=verdict,
        # .get() with a default prevents KeyError if the model omits a field.
        confidence=float(result.get("confidence", 0.5)),
        explanation=result.get("explanation", ""),
        sources=sources,  # From grounding metadata, not the model's text.
        domain=result.get("domain", "other"),
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
    results = []
    for extracted in claims:
        analysis = await verify_claim(client, extracted.claim)
        # Carry the checkability rating (high/medium/low) from the extraction
        # stage into the final result — the claim extractor assessed this, not Gemini.
        analysis.checkability = extracted.checkability
        results.append(analysis)
    return results
