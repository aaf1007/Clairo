import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from google import genai

from app.dependencies import get_gemini_client, get_groq_client
from app.models.schemas import FactCheckRequest, FactCheckResponse, TranscribeResponse
from app.services.transcriber import transcribe_audio


router = APIRouter(prefix="/api", tags=["transcription"])

# 25MB limit (Groq free tier)
MAX_FILE_SIZE = 25 * 1024 * 1024

ALLOWED_TYPES = {"audio/mpeg", "audio/mp4", "audio/wav", "audio/webm", "audio/x-m4a", "video/mp4", "video/webm"}

_MODEL_DESCRIPTION = (
    "Whisper model to use. Options: whisper-large-v3-turbo (default, fastest), "
    "whisper-large-v3 (most accurate), distil-whisper-large-v3-en (English only, ultra-fast)"
)


def _validate_upload(file: UploadFile, contents: bytes) -> None:
    if file.content_type and file.content_type not in ALLOWED_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {file.content_type}. Allowed: mp3, mp4, m4a, wav, webm",
        )
    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File too large. Max size: 25MB")


@router.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(
    file: UploadFile = File(..., description="Audio or video file to transcribe"),
    model: str = Query("whisper-large-v3-turbo", description=_MODEL_DESCRIPTION),
    groq: httpx.AsyncClient = Depends(get_groq_client),
):
    """Transcribe audio/video content using Groq-hosted Whisper."""
    contents = await file.read()
    _validate_upload(file, contents)

    try:
        return await transcribe_audio(groq, contents, file.filename or "audio.wav", model=model)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Transcription timed out")
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"Whisper API error: {e.response.status_code}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")


@router.post("/transcribe-and-check", response_model=FactCheckResponse)
async def transcribe_and_check(
    file: UploadFile = File(..., description="Audio or video file to transcribe and fact-check"),
    model: str = Query("whisper-large-v3-turbo", description=_MODEL_DESCRIPTION),
    gemini_model: str = Query(
        "gemini-2.5-flash-lite",
        description="Gemini model for fact-checking",
    ),
    url: str | None = Query(None, description="Source page URL to include in the response"),
    groq: httpx.AsyncClient = Depends(get_groq_client),
    gemini: genai.Client = Depends(get_gemini_client),
):
    """Transcribe audio/video, then run the full fact-check pipeline on the transcript."""
    contents = await file.read()
    _validate_upload(file, contents)

    try:
        transcript = await transcribe_audio(groq, contents, file.filename or "audio.wav", model=model)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Transcription timed out")
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"Whisper API error: {e.response.status_code}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")

    if not transcript.text.strip():
        raise HTTPException(status_code=400, detail="Transcription produced no text")

    from app.routers.fact_check import fact_check
    return await fact_check(
        request=FactCheckRequest(text=transcript.text, model=gemini_model, url=url),
        groq=groq,
        gemini=gemini,
    )
