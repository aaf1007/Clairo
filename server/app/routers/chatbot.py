import json
from pathlib import Path

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from google import genai
from google.genai import types

from app.dependencies import get_gemini_client
from app.models.schemas import ChatRequest, ChatRole

_PROMPT_PATH = Path(__file__).parent.parent / "prompts" / "chat_system.md"
SYSTEM_PROMPT = _PROMPT_PATH.read_text()
GEMINI_MODEL = "gemini-2.5-flash-lite"

router = APIRouter(prefix="/api", tags=["chatbot"])


@router.post("/chatbot")
async def chat_bot(request: ChatRequest, gemini: genai.Client = Depends(get_gemini_client)):
    # Append fact-check context to the system prompt if provided.
    system_instruction = SYSTEM_PROMPT
    if request.context:
        system_instruction += f"\n\n## Fact-Check Context\n\n```json\n{request.context}\n```"

    # Map ChatMessage history to Gemini's Content format.
    # Gemini uses "model" for assistant messages, not "assistant".
    contents = [
        types.Content(
            role="user" if msg.role == ChatRole.USER else "model",
            parts=[types.Part(text=msg.content)],
        )
        for msg in request.messages
    ]

    async def event_stream():
        try:
            response = await gemini.aio.models.generate_content_stream(
                model=GEMINI_MODEL,
                contents=contents,
                config=types.GenerateContentConfig(
                    system_instruction=system_instruction,
                    tools=[types.Tool(google_search=types.GoogleSearch())],
                    temperature=0.3,
                ),
            )
            async for chunk in response:
                if chunk.text:
                    yield f"data: {json.dumps({'token': chunk.text})}\n\n"
            yield f"data: {json.dumps({'done': True})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
