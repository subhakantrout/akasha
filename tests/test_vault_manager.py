import pytest
import os
import sqlite3
import json
from unittest.mock import patch, MagicMock, call

from ingestion_engine.vault_manager import VaultManager

@patch('ingestion_engine.vault_manager.os.makedirs')
@patch('ingestion_engine.vault_manager.sqlite3.connect')
@patch('ingestion_engine.vault_manager.chromadb.PersistentClient')
@patch('ingestion_engine.vault_manager.embedding_functions.OllamaEmbeddingFunction')
def test_vault_manager_init_success(mock_embed_func, mock_chroma_client, mock_sqlite_connect, mock_makedirs):
    mock_conn = MagicMock()
    mock_sqlite_connect.return_value = mock_conn
    mock_client_instance = MagicMock()
    mock_chroma_client.return_value = mock_client_instance

    manager = VaultManager(db_path="test_db_path/vault.db", chroma_path="test_chroma_path/chroma.db")

    mock_makedirs.assert_any_call("test_db_path", exist_ok=True)
    mock_makedirs.assert_any_call("test_chroma_path", exist_ok=True)

    mock_sqlite_connect.assert_called_once_with(
        "test_db_path/vault.db",
        check_same_thread=False,
        isolation_level=None
    )
    mock_conn.execute.assert_any_call("PRAGMA journal_mode=WAL")
    mock_chroma_client.assert_called_once_with(path="test_chroma_path/chroma.db")
    mock_client_instance.get_or_create_collection.assert_called_once()
    assert manager.chroma_client == mock_client_instance

@patch('ingestion_engine.vault_manager.os.makedirs')
@patch('ingestion_engine.vault_manager.sqlite3.connect')
@patch('ingestion_engine.vault_manager.chromadb.PersistentClient')
def test_vault_manager_init_chroma_failure(mock_chroma_client, mock_sqlite_connect, mock_makedirs):
    mock_sqlite_connect.return_value = MagicMock()
    mock_chroma_client.side_effect = Exception("ChromaDB init error")

    manager = VaultManager()

    assert manager.chroma_client is None
    assert manager.collection is None

@patch('ingestion_engine.vault_manager.os.makedirs')
@patch('ingestion_engine.vault_manager.sqlite3.connect')
@patch('ingestion_engine.vault_manager.chromadb.PersistentClient')
@patch('ingestion_engine.vault_manager.embedding_functions.OllamaEmbeddingFunction')
def test_vault_manager_create_tables(mock_embed_func, mock_chroma_client, mock_sqlite_connect, mock_makedirs):
    mock_conn = MagicMock()
    mock_cursor = MagicMock()
    mock_conn.cursor.return_value = mock_cursor
    mock_sqlite_connect.return_value = mock_conn

    manager = VaultManager()

    mock_cursor.execute.assert_any_call("""
                CREATE TABLE IF NOT EXISTS scriptures (
                    id TEXT PRIMARY KEY,
                    hymn TEXT,
                    content TEXT,
                    metadata TEXT,
                    source_url TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
    mock_cursor.execute.assert_any_call("CREATE INDEX IF NOT EXISTS idx_source_url ON scriptures(source_url)")
    mock_cursor.execute.assert_any_call("CREATE INDEX IF NOT EXISTS idx_created_at ON scriptures(created_at)")
    mock_conn.commit.assert_called()

@patch('ingestion_engine.vault_manager.os.makedirs')
@patch('ingestion_engine.vault_manager.sqlite3.connect')
@patch('ingestion_engine.vault_manager.chromadb.PersistentClient')
@patch('ingestion_engine.vault_manager.embedding_functions.OllamaEmbeddingFunction')
def test_vault_manager_batch_ingest(mock_embed_func, mock_chroma_client, mock_sqlite_connect, mock_makedirs):
    mock_conn = MagicMock()
    mock_sqlite_connect.return_value = mock_conn
    mock_client_instance = MagicMock()
    mock_chroma_client.return_value = mock_client_instance
    mock_collection = MagicMock()
    mock_client_instance.get_or_create_collection.return_value = mock_collection

    manager = VaultManager()

    docs = [
        {"id": "1", "content": "This is a valid long content that should be ingested.", "metadata": {"source": "test"}},
        {"id": "2", "content": "Short", "metadata": {"source": "test"}},
        {"id": "3", "content": "Another valid content.", "metadata": {"source": "test"}}
    ]

    result = manager.batch_ingest(docs)

    assert result == 2
    mock_collection.upsert.assert_called_once()

    call_args = mock_collection.upsert.call_args[1]
    assert call_args["ids"] == ["1", "3"]
    assert call_args["documents"] == ["This is a valid long content that should be ingested.", "Another valid content."]
    assert call_args["metadatas"] == [{"source": "test"}, {"source": "test"}]

@patch('ingestion_engine.vault_manager.os.makedirs')
@patch('ingestion_engine.vault_manager.sqlite3.connect')
@patch('ingestion_engine.vault_manager.chromadb.PersistentClient')
def test_vault_manager_batch_ingest_no_collection(mock_chroma_client, mock_sqlite_connect, mock_makedirs):
    mock_sqlite_connect.return_value = MagicMock()
    mock_chroma_client.side_effect = Exception("ChromaDB init error")

    manager = VaultManager()
    docs = [{"id": "1", "content": "Valid long content.", "metadata": {}}]

    result = manager.batch_ingest(docs)

    assert result == 0

@patch('ingestion_engine.vault_manager.os.makedirs')
@patch('ingestion_engine.vault_manager.sqlite3.connect')
@patch('ingestion_engine.vault_manager.chromadb.PersistentClient')
@patch('ingestion_engine.vault_manager.embedding_functions.OllamaEmbeddingFunction')
def test_vault_manager_add_scripture(mock_embed_func, mock_chroma_client, mock_sqlite_connect, mock_makedirs):
    mock_conn = MagicMock()
    mock_cursor = MagicMock()
    mock_conn.cursor.return_value = mock_cursor
    mock_sqlite_connect.return_value = mock_conn

    mock_client_instance = MagicMock()
    mock_chroma_client.return_value = mock_client_instance
    mock_collection = MagicMock()
    mock_client_instance.get_or_create_collection.return_value = mock_collection

    manager = VaultManager()

    data_list = [
        {"describe": "Desc 1", "text": "Text 1", "hymn": "Hymn 1"},
        {"describe": "Desc 2", "text": "Text 2", "hymn": "Hymn 2"}
    ]
    source_url = "http://test.url"

    manager.add_scripture(data_list, source_url)

    # 2 for create_tables + 2 for add_scripture = 4.
    assert mock_cursor.execute.call_count == 5
    assert mock_conn.commit.call_count == 2
    assert mock_collection.upsert.call_count == 2

    with pytest.raises(ValueError, match="data_list must be a list"):
        manager.add_scripture("not a list", source_url)

@patch('ingestion_engine.vault_manager.os.makedirs')
@patch('ingestion_engine.vault_manager.sqlite3.connect')
@patch('ingestion_engine.vault_manager.chromadb.PersistentClient')
@patch('ingestion_engine.vault_manager.embedding_functions.OllamaEmbeddingFunction')
def test_vault_manager_search(mock_embed_func, mock_chroma_client, mock_sqlite_connect, mock_makedirs):
    mock_conn = MagicMock()
    mock_sqlite_connect.return_value = mock_conn
    mock_client_instance = MagicMock()
    mock_chroma_client.return_value = mock_client_instance
    mock_collection = MagicMock()
    mock_client_instance.get_or_create_collection.return_value = mock_collection

    manager = VaultManager()

    expected_results = {"ids": [["1"]], "documents": [["Test doc"]], "metadatas": [[{"source": "test"}]]}
    mock_collection.query.return_value = expected_results

    results = manager.search("test query", n_results=2)

    assert results == expected_results
    mock_collection.query.assert_called_once_with(
        query_texts=["test query"],
        n_results=2,
        include=["documents", "metadatas", "distances"]
    )


    empty_result = manager.search("   ")
    assert empty_result == {"ids": [[]], "documents": [[]], "metadatas": [[]]}

    not_str_result = manager.search(123)
    assert not_str_result == {"ids": [[]], "documents": [[]], "metadatas": [[]]}

@patch('ingestion_engine.vault_manager.os.makedirs')
@patch('ingestion_engine.vault_manager.sqlite3.connect')
@patch('ingestion_engine.vault_manager.chromadb.PersistentClient')
def test_vault_manager_search_no_collection(mock_chroma_client, mock_sqlite_connect, mock_makedirs):
    mock_sqlite_connect.return_value = MagicMock()
    mock_chroma_client.side_effect = Exception("ChromaDB init error")

    manager = VaultManager()

    results = manager.search("test query")
    assert results == {"ids": [[]], "documents": [[]], "metadatas": [[]]}

@patch('ingestion_engine.vault_manager.os.makedirs')
@patch('ingestion_engine.vault_manager.sqlite3.connect')
@patch('ingestion_engine.vault_manager.chromadb.PersistentClient')
@patch('ingestion_engine.vault_manager.embedding_functions.OllamaEmbeddingFunction')
def test_vault_manager_get_stats(mock_embed_func, mock_chroma_client, mock_sqlite_connect, mock_makedirs):
    mock_conn = MagicMock()
    mock_cursor = MagicMock()
    mock_conn.cursor.return_value = mock_cursor
    mock_sqlite_connect.return_value = mock_conn
    mock_cursor.fetchone.return_value = [42]

    mock_client_instance = MagicMock()
    mock_chroma_client.return_value = mock_client_instance
    mock_collection = MagicMock()
    mock_client_instance.get_or_create_collection.return_value = mock_collection
    mock_collection.count.return_value = 100

    manager = VaultManager()

    stats = manager.get_stats()

    assert stats == {"sqlite_count": 42, "chromadb_count": 100}
    mock_cursor.execute.assert_called_with("SELECT COUNT(*) FROM scriptures")
    mock_collection.count.assert_called_once()

@patch('ingestion_engine.vault_manager.os.makedirs')
@patch('ingestion_engine.vault_manager.sqlite3.connect')
@patch('ingestion_engine.vault_manager.chromadb.PersistentClient')
@patch('ingestion_engine.vault_manager.embedding_functions.OllamaEmbeddingFunction')
def test_vault_manager_health_check(mock_embed_func, mock_chroma_client, mock_sqlite_connect, mock_makedirs):
    mock_conn = MagicMock()
    mock_cursor = MagicMock()
    mock_conn.cursor.return_value = mock_cursor
    mock_sqlite_connect.return_value = mock_conn
    mock_cursor.fetchone.return_value = [42]

    mock_client_instance = MagicMock()
    mock_chroma_client.return_value = mock_client_instance
    mock_collection = MagicMock()
    mock_client_instance.get_or_create_collection.return_value = mock_collection

    manager = VaultManager()

    health = manager.health_check()

    assert health == {
        "sqlite_ok": True,
        "chromadb_ok": True,
        "scriptures_count": 42
    }

    mock_cursor.execute.side_effect = Exception("DB error")
    health_error = manager.health_check()

    assert health_error == {
        "sqlite_ok": False,
        "chromadb_ok": False,
        "error": "DB error"
    }
