from pydantic import BaseModel, Field
from enum import Enum
from datetime import datetime

# THIS FILE DEFINES THE SHAPE OF ALL DATA
#
# Every class here is either:
#   - An Enum: a fixed set of allowed string values (e.g. verdict options)
#   - A Pydantic BaseModel: a typed data structure that validates and serializes JSON
#
# Pydantic BaseModel does two things automatically:
#   1. Validates incoming data — wrong type or missing required field → 422 error
#      before your endpoint code even runs.
#   2. Serializes outgoing data — converts the Python object to JSON when FastAPI
#      returns a response.
#
# Field() attaches extra rules to a field: min/max length, numeric bounds,
# a default value, and a description that shows up in the Swagger UI at /docs.
#
# Inheriting from both `str` and `Enum` means enum values serialize to plain strings
# in JSON ("TRUE", "FALSE", etc.) rather than an object like {"value": "TRUE"}.


# ──────────────────────────────────────────────
# Enums
# ──────────────────────────────────────────────

class Verdict(str, Enum):
    """The possible fact-check outcomes for a claim.
    Used in both ClaimAnalysis (per-claim verdict) and FactCheckResponse
    (overall verdict aggregated across all claims).

    Values:
        TRUE: The claim is supported by evidence.
        FALSE: The claim is contradicted by evidence.
        MOSTLY_TRUE: The claim is largely accurate with minor caveats.
        MOSTLY_FALSE: The claim is largely inaccurate or misleading.
        UNVERIFIABLE: Insufficient evidence to confirm or deny the claim.
    """
    TRUE = "TRUE"
    FALSE = "FALSE"
    MOSTLY_TRUE = "MOSTLY_TRUE"
    MOSTLY_FALSE = "MOSTLY_FALSE"
    UNVERIFIABLE = "UNVERIFIABLE"


class Checkability(str, Enum):
    """How verifiable a claim is — assessed by Groq during claim extraction.

    Groq assigns this before fact-checking happens. It reflects whether the
    claim is the kind of statement that can be verified against real sources,
    or whether it is too subjective or vague to check reliably.

    Values:
        HIGH: Objective and concrete — can be verified against sources.
        MEDIUM: Partially verifiable — some nuance or context required.
        LOW: Subjective, opinion-based, or too vague to check reliably.
    """
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


# ──────────────────────────────────────────────
# Fact Check — Request & Response models
# ──────────────────────────────────────────────

class FactCheckRequest(BaseModel):
    """The JSON body sent by the Chrome extension to POST /api/fact-check.

    This is the entry point of the pipeline. FastAPI deserializes the request
    body into this model automatically. If a required field is missing or a
    constraint is violated (e.g. text too long), FastAPI returns 422
    Unprocessable Entity before the endpoint code runs.

    Flow: Chrome extension → POST /api/fact-check → FactCheckRequest

    Attributes:
        text: The highlighted text the user wants to fact-check. Required.
            Capped at 20,000 characters to prevent abuse.
        url: The URL of the page the user is on. Optional. Not used in the
            pipeline — echoed back in the response so the extension knows
            which page the result belongs to.
        context: The paragraph surrounding the highlighted text. Optional.
            Passed to Groq so it has more context when deciding whether
            something is a factual claim or an opinion.
        model: The Gemini model to call for fact verification. Defaults to
            gemini-2.5-flash. Can be overridden by the client if needed.
    """
    text: str = Field(..., min_length=1, max_length=20000, description="Highlighted text to fact-check")
    url: str | None = Field(None, description="Source page URL for context")
    context: str | None = Field(None, max_length=5000, description="Surrounding paragraph text")
    model: str = Field("gemini-2.5-flash-lite", description="Gemini model to use")


class ExtractedClaim(BaseModel):
    """A single claim extracted from the input text by Groq.

    This is an internal pipeline model — it is never sent to the client.
    It exists purely to carry structured data from claim_extractor.py into
    fact_checker.py. Think of it as a typed hand-off between two pipeline stages.

    Flow: claim_extractor.py produces list[ExtractedClaim] → fact_checker.py consumes it

    Attributes:
        claim: The extracted claim sentence, ready to be fact-checked.
        checkability: Groq's assessment of how verifiable this claim is.
            Defaults to MEDIUM if Groq doesn't specify.
    """
    claim: str
    checkability: Checkability = Checkability.MEDIUM


class ClaimAnalysis(BaseModel):
    """The fact-check result for a single extracted claim.

    Produced by fact_checker.py for each ExtractedClaim. A list of these
    is collected and embedded in the final FactCheckResponse.

    Flow: fact_checker.py produces ClaimAnalysis → collected into FactCheckResponse.claims

    Attributes:
        statement: The original claim text that was checked.
        verdict: Gemini's verdict on the claim (TRUE, FALSE, etc.).
        confidence: How confident Gemini is in the verdict, from 0.0 to 1.0.
            Pydantic enforces this range — values outside it are rejected.
        explanation: Gemini's evidence-based reasoning for the verdict.
        sources: URLs of the Google Search results Gemini used to ground its
            response. These come from grounding metadata, not the model's text.
        domain: The topic category of the claim (health, science, politics, etc.).
            Returned by Gemini as part of the verdict JSON.
        checkability: Carried over from ExtractedClaim — Groq's original
            assessment of how verifiable this claim was.
    """
    statement: str
    verdict: Verdict
    confidence: float = Field(..., ge=0.0, le=1.0)
    explanation: str
    sources: list[str] = []
    domain: str = "other"
    checkability: Checkability = Checkability.MEDIUM


class FactCheckResponse(BaseModel):
    """The complete JSON response returned by POST /api/fact-check.

    This is what the Chrome extension receives after the full pipeline runs.
    The extension uses this to render the popup bubble — verdict badges,
    confidence bars, explanations, and source links.

    FastAPI validates the return value of the endpoint against this model
    before sending it. If a field is missing or the wrong type, it raises a 500.

    Flow: fact_check.py router builds this → FastAPI serializes to JSON → Chrome extension

    Attributes:
        overall_verdict: A single verdict aggregated from all individual claim
            verdicts. Computed by _aggregate_verdict() in the router.
        summary: A human-readable sentence summarizing the results, e.g.
            "Analyzed 3 claims. 2 verified as true. 1 found to be false."
        claims: One ClaimAnalysis per extracted claim.
        checked_at: UTC timestamp of when the check was performed. Set
            automatically at response creation time using default_factory.
        source_url: The URL from the original request, echoed back so the
            extension knows which page this result belongs to.
    """
    overall_verdict: Verdict
    title: str
    summary: str
    claims: list[ClaimAnalysis]
    # default_factory calls datetime.utcnow() at object creation time.
    # Using `default=datetime.utcnow()` would freeze the timestamp to import time — always wrong.
    checked_at: datetime = Field(default_factory=datetime.utcnow)
    source_url: str | None = None


class TranscriptionSegment(BaseModel):
    """A single timestamped segment from Whisper's verbose_json output."""
    start: float
    end: float
    text: str


class TranscribeResponse(BaseModel):
    """The JSON response returned by POST /api/transcribe.

    After Groq Whisper transcribes the uploaded audio file, this model
    carries the result back to the client. The `text` field can then be
    passed into the main fact-check pipeline as the input text.

    Flow: transcriber.py produces TranscribeResponse → client receives it →
          client may POST `text` to /api/fact-check to fact-check the transcript

    Attributes:
        text: The full transcribed text from the audio file.
        language: The detected language code, e.g. "en". None if not detected.
        duration_seconds: The length of the audio clip in seconds. None if
            not returned by the Whisper API.
        segments: Timestamped segments from Whisper verbose_json output.
    """
    text: str
    language: str | None = None
    duration_seconds: float | None = None
    segments: list[TranscriptionSegment] = Field(default_factory=list)


# ──────────────────────────────────────────────
# Chat
# ──────────────────────────────────────────────

class ChatRole(str, Enum):
    """The sender of a chat message."""
    USER = "user"
    ASSISTANT = "assistant"


class ChatMessage(BaseModel):
    """A single message in the chat conversation history."""
    role: ChatRole
    content: str


class ChatRequest(BaseModel):
    """The JSON body sent by the extension to POST /api/chatbot.

    Attributes:
        messages: Full conversation history. Must have at least 1 message.
            Capped at 20 messages server-side to prevent context overflow.
            The last message is always the new user message.
        context: Optional serialized JSON of the selected FactCheckResponse.
            When provided, the bot answers questions about that specific result.
            Omit for free-form chat without fact-check context.
    """
    messages: list[ChatMessage] = Field(..., min_length=1, max_length=20)
    context: str | None = Field(None, max_length=50000)
