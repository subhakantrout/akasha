import pytest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient

# Mock VaultManager completely to avoid ChromaDB/SQLite interactions during test setup
with patch('ingestion_engine.vault_manager.VaultManager') as MockVault:
    from ingestion_engine.bridge import app, vault

client = TestClient(app)


def test_get_status():
    response = client.get("/status")
    assert response.status_code == 200
    assert response.json() == {"status": "online", "engine": "ChromaDB Semantic Bridge"}

def test_ingest_success():
    doc = {
        "id": "doc_1",
        "content": "This is a test document.",
        "metadata": {"source": "test"}
    }

    # Ensure collection exists
    vault.collection = MagicMock()
    vault.collection.upsert = MagicMock()

    response = client.post("/ingest", json=doc)
    assert response.status_code == 200
    assert response.json() == {"status": "success", "id": "doc_1", "stored_length": 24}

    vault.collection.upsert.assert_called_once_with(
        ids=["doc_1"],
        documents=["This is a test document."],
        metadatas=[{"source": "test", "full_length": 24}]
    )

def test_ingest_long_content():
    long_content = "A" * 8500
    doc = {
        "id": "doc_2",
        "content": long_content,
        "metadata": {"source": "test"}
    }

    vault.collection = MagicMock()
    vault.collection.upsert = MagicMock()

    response = client.post("/ingest", json=doc)
    assert response.status_code == 200

    res_json = response.json()
    assert res_json["status"] == "success"
    assert res_json["id"] == "doc_2"
    assert res_json["stored_length"] == 8000

    vault.collection.upsert.assert_called_once_with(
        ids=["doc_2"],
        documents=[long_content[:8000]],
        metadatas=[{"source": "test", "full_length": 8500}]
    )

def test_ingest_no_collection():
    vault.collection = None

    doc = {
        "id": "doc_3",
        "content": "Content",
        "metadata": {}
    }

    response = client.post("/ingest", json=doc)
    assert response.status_code == 200
    assert response.json() == {"status": "error", "message": "ChromaDB not initialized"}

def test_ingest_exception():
    doc = {
        "id": "doc_4",
        "content": "Content",
        "metadata": {}
    }

    vault.collection = MagicMock()
    vault.collection.upsert.side_effect = Exception("Test Error")

    response = client.post("/ingest", json=doc)
    assert response.status_code == 200
    assert response.json() == {"status": "error", "message": "Test Error"}


def test_ingest_batch_success():
    batch = {
        "documents": [
            {"id": "b1", "content": "Content 1", "metadata": {"m": 1}},
            {"id": "b2", "content": "Content 2", "metadata": {"m": 2}}
        ]
    }

    vault.collection = MagicMock()
    vault.batch_ingest = MagicMock(return_value=2)

    response = client.post("/ingest_batch", json=batch)
    assert response.status_code == 200
    assert response.json() == {"status": "success", "count": 2}

    vault.batch_ingest.assert_called_once()

def test_ingest_batch_no_collection():
    vault.collection = None
    batch = {
        "documents": [{"id": "b1", "content": "Content", "metadata": {}}]
    }

    response = client.post("/ingest_batch", json=batch)
    assert response.status_code == 200
    assert response.json() == {"status": "error", "message": "ChromaDB not initialized"}

def test_search_success():
    query = {"query": "test query", "limit": 2}

    vault.search = MagicMock(return_value={
        "ids": [["id1", "id2"]],
        "documents": [["doc1", "doc2"]],
        "metadatas": [[{"m": 1}, {"m": 2}]]
    })

    response = client.post("/search", json=query)
    assert response.status_code == 200

    expected_output = {
        "results": [
            {"content": "doc1", "metadata": {"m": 1}, "id": "id1"},
            {"content": "doc2", "metadata": {"m": 2}, "id": "id2"}
        ]
    }
    assert response.json() == expected_output
    vault.search.assert_called_once_with("test query", n_results=2)

def test_search_empty():
    query = {"query": "empty query"}

    vault.search = MagicMock(return_value={
        "ids": [],
        "documents": [],
        "metadatas": []
    })

    response = client.post("/search", json=query)
    assert response.status_code == 200
    assert response.json() == {"results": []}
