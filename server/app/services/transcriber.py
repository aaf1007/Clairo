import io

import httpx
from pydub import AudioSegment

from app.models.schemas import TranscribeResponse, TranscriptionSegment

MAX_WHISPER_SIZE = 25 * 1024 * 1024  # 25 MB (Groq free tier limit)

_FORMAT_MAP = {
    "mp3": "mp3",
    "mp4": "mp4",
    "m4a": "m4a",
    "wav": "wav",
    "webm": "webm",
    "ogg": "ogg",
    "mpeg": "mp3",
}


def _extract_and_compress(file_bytes: bytes, filename: str) -> bytes:
    """Extract audio from video/audio bytes and downsample to 16kHz mono WAV.

    Uses pydub (backed by ffmpeg) to handle any input format — mp4, webm,
    and audio-only files alike. The resulting WAV at 16kHz mono 16-bit PCM
    is approximately 1.9 MB per minute of audio.
    """
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    fmt = _FORMAT_MAP.get(ext)

    input_buf = io.BytesIO(file_bytes)
    try:
        audio = AudioSegment.from_file(input_buf, format=fmt) if fmt else AudioSegment.from_file(input_buf)
    except Exception as e:
        raise ValueError(f"Could not decode audio/video file: {e}")

    # Mono 16kHz — sufficient quality for speech recognition, minimal size
    audio = audio.set_channels(1).set_frame_rate(16000)

    output_buf = io.BytesIO()
    audio.export(output_buf, format="wav")
    return output_buf.getvalue()


async def transcribe_audio(
    client: httpx.AsyncClient,
    file_bytes: bytes,
    filename: str,
    model: str = "whisper-large-v3-turbo",
) -> TranscribeResponse:
    """Transcribe audio/video using Groq-hosted Whisper.

    Args:
        client: The Groq httpx client
        file_bytes: Raw audio or video file bytes
        filename: Original filename (used for format detection)
        model: Whisper model to use. Options:
               whisper-large-v3-turbo (default), whisper-large-v3,
               distil-whisper-large-v3-en

    Returns:
        TranscribeResponse with transcription text, language, duration, and segments
    """
    audio_bytes = _extract_and_compress(file_bytes, filename)

    if len(audio_bytes) > MAX_WHISPER_SIZE:
        mb = len(audio_bytes) / 1024 / 1024
        raise ValueError(
            f"Compressed audio is {mb:.1f}MB, exceeds the 25MB limit. "
            "Try a shorter recording."
        )

    response = await client.post(
        "/audio/transcriptions",
        data={"model": model, "response_format": "verbose_json"},
        files={"file": ("audio.wav", audio_bytes, "audio/wav")},
        headers={"Content-Type": None},  # Let httpx set multipart boundary
        timeout=httpx.Timeout(120.0),
    )
    response.raise_for_status()
    data = response.json()

    segments = [
        TranscriptionSegment(start=s["start"], end=s["end"], text=s["text"])
        for s in data.get("segments", [])
    ]

    return TranscribeResponse(
        text=data["text"],
        language=data.get("language"),
        duration_seconds=data.get("duration"),
        segments=segments,
    )
