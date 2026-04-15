import json
from pathlib import Path

import httpx

from app.models.schemas import Checkability, ExtractedClaim


class ClaimExtractionError(Exception):
    """Raised when Groq returns no usable claims (e.g. bad JSON shape or empty list)."""


# Load system prompt from file
_PROMPT_PATH = Path(__file__).parent.parent / "prompts" / "claim_extraction.md"
SYSTEM_PROMPT = _PROMPT_PATH.read_text()

# Model to use on Groq
MODEL = "llama-3.1-8b-instant"


async def extract_claims(client: httpx.AsyncClient, text: str, context: str | None = None) -> list[ExtractedClaim]:
    """
    Send highlighted text to Groq and get back a list of factual claims.

    Args:
        client: The Groq httpx client (injected via Depends)
        text: Cleaned highlighted text from the user
        context: Optional surrounding paragraph for additional context

    Returns:
        List of claim strings extracted from the text
    """
    user_content = text
    if context:
        user_content = f"Highlighted text: {text}\n\nSurrounding context: {context}"

    # This is where you make the actual API call
    response = await client.post(
            "/chat/completions",
            json = {
                "model": MODEL,
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_content}
                    ],
                "temperature": 0.1, # low temp for consistent extraction
                "max_tokens": 1024,
                },
            )

    response.raise_for_status()
    data = response.json()
    content = data["choices"][0]["message"]["content"]

    # Strip markdown code fences if the model wrapped the JSON
    first_bracket = content.find("[")
    last_bracket = content.rfind("]")
    if first_bracket != -1 and last_bracket != -1:
        content = content[first_bracket:last_bracket + 1]

    try:
        raw = json.loads(content)
    except json.JSONDecodeError:
        return []

    ret = [
        ExtractedClaim(
            claim=item["claim"],
            checkability=Checkability(item.get("checkability", "medium")),
        )
        for item in raw
        if "claim" in item
    ]

    if not ret:
        raise ClaimExtractionError(
            "No extractable claims from the Groq model response. Try different text or check the extraction prompt."
        )

    return ret

