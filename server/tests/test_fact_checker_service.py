import asyncio
from types import SimpleNamespace

from app.models.schemas import Verdict
from app.services.fact_checker import verify_claim


class FakeModels:
    def __init__(self, response):
        self.response = response

    async def generate_content(self, **kwargs):
        return self.response


class FakeGemini:
    def __init__(self, response):
        self.aio = SimpleNamespace(models=FakeModels(response))


def test_verify_claim_returns_unverifiable_when_gemini_response_is_empty():
    response = SimpleNamespace(text=None, candidates=None)

    analysis = asyncio.run(verify_claim(FakeGemini(response), "The moon is made of cheese."))

    assert analysis.verdict == Verdict.UNVERIFIABLE
    assert analysis.confidence == 0.0
    assert analysis.explanation == "Gemini returned no usable verification result."
    assert analysis.sources == []


def test_verify_claim_reads_candidate_parts_when_response_text_is_missing():
    response = SimpleNamespace(
        text=None,
        candidates=[
            SimpleNamespace(
                content=SimpleNamespace(
                    parts=[
                        SimpleNamespace(
                            text=(
                                '{"verdict":"TRUE","confidence":0.91,'
                                '"explanation":"Water boils at 100C at sea level.",'
                                '"domain":"science"}'
                            )
                        )
                    ]
                ),
                grounding_metadata=None,
            )
        ],
    )

    analysis = asyncio.run(verify_claim(FakeGemini(response), "Water boils at 100C at sea level."))

    assert analysis.verdict == Verdict.TRUE
    assert analysis.confidence == 0.91
    assert analysis.explanation == "Water boils at 100C at sea level."
    assert analysis.domain == "science"
