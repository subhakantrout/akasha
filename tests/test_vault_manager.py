import pytest
from unittest.mock import MagicMock, patch
from ingestion_engine.vault_manager import VaultManager

@pytest.fixture
def mock_vault_manager(mocker):
    # Mock os.makedirs, sqlite3.connect, chromadb.PersistentClient
    mocker.patch('os.makedirs')
    mock_connect = mocker.patch('sqlite3.connect')
    mocker.patch('chromadb.PersistentClient')
    mocker.patch('chromadb.utils.embedding_functions.OllamaEmbeddingFunction')

    mock_conn = MagicMock()
    mock_connect.return_value = mock_conn

    manager = VaultManager()
    manager.conn = mock_conn
    # Reset mock calls after initialization (which calls create_tables)
    mock_conn.reset_mock()
    return manager

def test_health_check_success(mock_vault_manager):
    # Setup the mock
    mock_cursor = MagicMock()
    mock_vault_manager.conn.cursor.return_value = mock_cursor
    mock_cursor.fetchone.return_value = [42]  # Mock the scripture count

    # ChromaDB collection should be non-None for chromadb_ok to be True
    mock_vault_manager.collection = MagicMock()

    # Call the health check
    result = mock_vault_manager.health_check()

    # Assertions
    assert result == {
        "sqlite_ok": True,
        "chromadb_ok": True,
        "scriptures_count": 42
    }
    mock_vault_manager.conn.cursor.assert_called_once()
    mock_cursor.execute.assert_called_once_with("SELECT COUNT(*) FROM scriptures")
    mock_cursor.fetchone.assert_called_once()

def test_health_check_chroma_not_ok(mock_vault_manager):
    # Setup the mock
    mock_cursor = MagicMock()
    mock_vault_manager.conn.cursor.return_value = mock_cursor
    mock_cursor.fetchone.return_value = [10]

    # ChromaDB collection should be None
    mock_vault_manager.collection = None

    # Call the health check
    result = mock_vault_manager.health_check()

    # Assertions
    assert result == {
        "sqlite_ok": True,
        "chromadb_ok": False,
        "scriptures_count": 10
    }

def test_health_check_sqlite_error(mock_vault_manager):
    # Setup the mock to raise an exception when creating the cursor
    mock_vault_manager.conn.cursor.side_effect = Exception("Database connection failed")

    # Call the health check
    result = mock_vault_manager.health_check()

    # Assertions
    assert result == {
        "sqlite_ok": False,
        "chromadb_ok": False,
        "error": "Database connection failed"
    }

def test_health_check_execute_error(mock_vault_manager):
    # Setup the mock to raise an exception when executing the query
    mock_cursor = MagicMock()
    mock_vault_manager.conn.cursor.return_value = mock_cursor
    mock_cursor.execute.side_effect = Exception("Query failed")

    # Call the health check
    result = mock_vault_manager.health_check()

    # Assertions
    assert result == {
        "sqlite_ok": False,
        "chromadb_ok": False,
        "error": "Query failed"
    }
