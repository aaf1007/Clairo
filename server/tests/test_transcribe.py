from datetime import datetime
from unittest.mock import patch

from app.models.schemas import FactCheckResponse, TranscribeResponse, Verdict


async def fake_transcribe_audio(groq, contents, filename, model="whisper-large-v3-turbo"):
    return TranscribeResponse(
        text="Water boils at 100C.",
        language="en",
        duration_seconds=1.5,
        segments=[],
    )


def test_transcribe_returns_mocked_transcript(client):
    with patch("app.routers.transcribe.transcribe_audio", fake_transcribe_audio):
        response = client.post(
            "/api/transcribe",
            files={"file": ("clip.mp3", b"fake-audio", "audio/mpeg")},
        )

    body = response.json()

    assert response.status_code == 200
    assert body["text"] == "Water boils at 100C."
    assert body["language"] == "en"
    assert body["duration_seconds"] == 1.5


def test_transcribe_rejects_unsupported_file_type(client):
    response = client.post(
        "/api/transcribe",
        files={"file": ("notes.txt", b"not-audio", "text/plain")},
    )

    assert response.status_code == 400
    assert response.json()["detail"].startswith("Unsupported file type:")


def test_transcribe_and_check_chains_transcript_into_fact_check(client):
    captured = {}

    async def fake_fact_check(request, groq, gemini):
        captured["text"] = request.text
        captured["model"] = request.model
        captured["url"] = request.url
        return FactCheckResponse(
            overall_verdict=Verdict.TRUE,
            title="Water Boiling Point",
            summary="This text is about water. The key claim says it boils at 100C.",
            claims=[],
            checked_at=datetime.utcnow(),
            source_url=request.url,
        )

    with patch("app.routers.transcribe.transcribe_audio", fake_transcribe_audio):
        with patch("app.routers.fact_check.fact_check", fake_fact_check):
            response = client.post(
                "/api/transcribe-and-check",
                params={"gemini_model": "gemini-test", "url": "https://example.com/video"},
                files={"file": ("clip.mp3", b"fake-audio", "audio/mpeg")},
            )

    body = response.json()

    assert response.status_code == 200
    assert captured == {
        "text": "Water boils at 100C.",
        "model": "gemini-test",
        "url": "https://example.com/video",
    }
    assert body["overall_verdict"] == "TRUE"
    assert body["source_url"] == "https://example.com/video"
