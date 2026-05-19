import os
import sqlite3
import hashlib
import tempfile
import unittest

# Need to set up chroma sqlite3 issues or avoid importing chromadb during simple test
# Wait, VaultManager will create chromadb instance, we can just mock it or handle it.
# The issue is simple: VaultManager takes db_path and chroma_path in __init__. We can use temp directories.

from ingestion_engine.vault_manager import VaultManager

class TestVaultManager(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = os.path.join(self.temp_dir.name, "test_vault.db")
        self.chroma_path = os.path.join(self.temp_dir.name, "test_chroma_db")

        self.manager = VaultManager(db_path=self.db_path, chroma_path=self.chroma_path)

    def tearDown(self):
        self.manager.conn.close()
        self.temp_dir.cleanup()

    def test_add_scripture_sha256_hash(self):
        data_list = [
            {
                "describe": "Test description",
                "text": "Test text",
                "hymn": "TestHymn1"
            }
        ]
        source_url = "http://example.com/source"

        # Add scripture
        self.manager.add_scripture(data_list, source_url)

        # Calculate expected hash
        expected_hash = hashlib.sha256(f"TestHymn1{source_url}".encode()).hexdigest()

        # Check database
        cursor = self.manager.conn.cursor()
        cursor.execute("SELECT id FROM scriptures WHERE source_url = ?", (source_url,))
        result = cursor.fetchone()

        self.assertIsNotNone(result, "Scripture was not added to the database")
        self.assertEqual(result[0], expected_hash, "Generated ID does not match expected SHA-256 hash")

if __name__ == "__main__":
    unittest.main()
