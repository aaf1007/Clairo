from unittest.mock import patch

import httpx

from app.models.schemas import ClaimAnalysis, ExtractedClaim, Verdict


async def fake_extract_claims(groq, text, context):
    return [ExtractedClaim(claim="Water boils at 100C at sea level.")]


async def fake_verify_claims(gemini, claims):
    return [
        ClaimAnalysis(
            statement="Water boils at 100C at sea level.",
            verdict=Verdict.TRUE,
            confidence=0.98,
            explanation="This is the standard boiling point of water at sea level.",
            sources=["https://example.com/boiling-point"],
            domain="science",
        )
    ]


async def fake_build_summary(groq, selected_text, claims):
    return ("Water Boiling Point", "This text is about the boiling point of water. The key claim says it boils at 100C at sea level.")


async def fake_no_claims(groq, text, context):
    return []


async def fake_timeout(groq, text, context):
    raise httpx.TimeoutException("Groq took too long to respond")


def test_fact_check_returns_mocked_result(client):
    with patch("app.routers.fact_check.extract_claims", fake_extract_claims):
        with patch("app.routers.fact_check.verify_claims", fake_verify_claims):
            with patch("app.routers.fact_check._build_summary", fake_build_summary):
                response = client.post("/api/fact-check", json={"text": "Water boils at 100C at sea level."})

    body = response.json()

    assert response.status_code == 200
    assert body["overall_verdict"] == "TRUE"
    assert body["title"] == "Water Boiling Point"
    assert body["summary"].startswith("This text is about")
    assert body["claims"][0]["statement"] == "Water boils at 100C at sea level."
    assert body["claims"][0]["verdict"] == "TRUE"
    assert body["claims"][0]["domain"] == "science"


def test_fact_check_rejects_text_that_is_empty_after_cleaning(client):
    response = client.post("/api/fact-check", json={"text": " \n\t\u200b "})

    assert response.status_code == 400
    assert response.json() == {"detail": "Text is empty after cleaning"}


def test_fact_check_returns_unverifiable_when_no_claims_are_found(client):
    with patch("app.routers.fact_check.extract_claims", fake_no_claims):
        response = client.post("/api/fact-check", json={"text": "I think this movie feels hopeful."})

    body = response.json()

    assert response.status_code == 200
    assert body["overall_verdict"] == "UNVERIFIABLE"
    assert body["title"] == "No Verifiable Claims"
    assert body["claims"] == []


def test_fact_check_maps_claim_extraction_timeout_to_504(client):
    with patch("app.routers.fact_check.extract_claims", fake_timeout):
        response = client.post("/api/fact-check", json={"text": "Some factual sentence."})

    assert response.status_code == 504
    assert response.json() == {"detail": "Claim extraction timed out"}
