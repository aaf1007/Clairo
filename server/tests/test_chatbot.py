from app.dependencies import get_gemini_client
from app.main import app


class FakeChunk:
    def __init__(self, text):
        self.text = text


class FakeStream:
    def __init__(self, texts):
        self._texts = texts

    def __aiter__(self):
        self._iterator = iter(self._texts)
        return self

    async def __anext__(self):
        try:
            return FakeChunk(next(self._iterator))
        except StopIteration:
            raise StopAsyncIteration


class FakeModels:
    async def generate_content_stream(self, *args, **kwargs):
        return FakeStream(["Hello", " world"])


class FakeAio:
    def __init__(self):
        self.models = FakeModels()


class FakeGemini:
    def __init__(self):
        self.aio = FakeAio()


def test_chatbot_streams_tokens_and_done_event(client):
    app.dependency_overrides[get_gemini_client] = lambda: FakeGemini()

    response = client.post(
        "/api/chatbot",
        json={"messages": [{"role": "user", "content": "Hi there"}]},
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert 'data: {"token": "Hello"}' in response.text
    assert 'data: {"token": " world"}' in response.text
    assert 'data: {"done": true}' in response.text
