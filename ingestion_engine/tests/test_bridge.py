import pytest
from fastapi.testclient import TestClient
from ingestion_engine.bridge import app, vault

client = TestClient(app)

def test_ingest_uninitialized_vault():
    """Test that ingesting a document returns an error when the vault collection is uninitialized."""
    # Ensure vault collection is uninitialized
    original_collection = vault.collection
    vault.collection = None

    try:
        response = client.post(
            "/ingest",
            json={
                "id": "test_doc_1",
                "content": "This is a test document",
                "metadata": {"source": "test"}
            }
        )

        assert response.status_code == 200
        assert response.json() == {
            "status": "error",
            "message": "ChromaDB not initialized"
        }
    finally:
        # Restore original vault state
        vault.collection = original_collection
