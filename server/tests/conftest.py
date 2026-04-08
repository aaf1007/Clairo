import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client():
    # Clear dependency overrides so each test starts with a clean app state.
    app.dependency_overrides.clear()
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
