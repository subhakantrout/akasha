import chromadb
from chromadb.utils import embedding_functions
import sqlite3
import json
import os
import hashlib
import logging

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class VaultManager:
    def __init__(self, db_path="data/vault.db", chroma_path="data/chroma_db"):
        try:
            os.makedirs(os.path.dirname(db_path) if os.path.dirname(db_path) else '.', exist_ok=True)
            os.makedirs(os.path.dirname(chroma_path) if os.path.dirname(chroma_path) else '.', exist_ok=True)

            self.db_path = db_path
            self.chroma_path = chroma_path

            # Connect with optimizations
            self.conn = sqlite3.connect(
                db_path,
                check_same_thread=False,
                isolation_level=None  # Autocommit mode
            )

            # PERFORMANCE: Enable WAL mode for concurrent writes
            self.conn.execute("PRAGMA journal_mode=WAL")
            self.conn.execute("PRAGMA synchronous=NORMAL")  # Faster than FULL
            self.conn.execute("PRAGMA cache_size=-64000")  # 64MB cache
            self.conn.execute("PRAGMA temp_store=MEMORY")

            self.create_tables()

            # Initialize ChromaDB
            try:
                self.chroma_client = chromadb.PersistentClient(path=chroma_path)

                # Use Ollama for embeddings
                self.embedding_func = embedding_functions.OllamaEmbeddingFunction(
                    model_name="nomic-embed-text",
                    url="http://localhost:11434/api/embeddings"
                )

                self.collection = self.chroma_client.get_or_create_collection(
                    name="vedic_vault",
                    embedding_function=self.embedding_func,
                    metadata={"hnsw:space": "cosine"}  # Use cosine similarity
                )

                # PERFORMANCE: Configure for better batch performance
                logger.info("ChromaDB initialized successfully")
            except Exception as e:
                logger.error(f"Failed to initialize ChromaDB: {e}")
                self.chroma_client = None
                self.collection = None

        except Exception as e:
            logger.error(f"Failed to initialize VaultManager: {e}")
            raise

    def create_tables(self):
        try:
            cursor = self.conn.cursor()
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS scriptures (
                    id TEXT PRIMARY KEY,
                    hymn TEXT,
                    content TEXT,
                    metadata TEXT,
                    source_url TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            # Add index for faster lookups
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_source_url ON scriptures(source_url)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_created_at ON scriptures(created_at)")
            self.conn.commit()
            logger.info("Database tables created/verified with indexes")
        except Exception as e:
            logger.error(f"Failed to create tables: {e}")
            raise

    def batch_ingest(self, docs):
        """Optimized batch ingestion with larger chunks."""
        if not self.collection:
            return 0

        try:
            # Filter out empty content
            valid_docs = [d for d in docs if d.get('content') and len(d.get('content', '')) > 10]

            if not valid_docs:
                return 0

            ids = [d['id'] for d in valid_docs]

            # PERFORMANCE: Increased limit but still truncate for embedding efficiency
            contents = [d['content'][:4000] for d in valid_docs]
            metadatas = [d['metadata'] for d in valid_docs]

            self.collection.upsert(
                ids=ids,
                documents=contents,
                metadatas=metadatas
            )

            return len(valid_docs)
        except Exception as e:
            logger.error(f"Batch ingestion failed: {e}")
            return 0

    def add_scripture(self, data_list, source_url):
        try:
            if not isinstance(data_list, list):
                raise ValueError("data_list must be a list")

            cursor = self.conn.cursor()
            added = 0

            for item in data_list:
                try:
                    content = item.get('describe', '') + " " + item.get('text', '')
                    hymn = item.get('hymn', 'unknown')
                    unique_id = hashlib.md5(f"{hymn}{source_url}".encode()).hexdigest()

                    cursor.execute(
                        "INSERT OR REPLACE INTO scriptures (id, hymn, content, metadata, source_url) VALUES (?, ?, ?, ?, ?)",
                        (unique_id, hymn, content, json.dumps(item), source_url)
                    )

                    if self.collection:
                        try:
                            self.collection.upsert(
                                ids=[unique_id],
                                documents=[content[:4000]],
                                metadatas=[{"hymn": hymn, "source": source_url, "type": "verse"}]
                            )
                        except Exception as e:
                            logger.warning(f"Failed to upsert to ChromaDB: {e}")

                    added += 1
                except Exception as e:
                    logger.warning(f"Failed to add scripture: {e}")
                    continue

            self.conn.commit()
            logger.info(f"Added {added}/{len(data_list)} verses to vault")
        except Exception as e:
            logger.error(f"Failed to add scriptures: {e}")
            raise

    def search(self, query, n_results=5):
        try:
            if not self.collection:
                logger.warning("ChromaDB not initialized, returning empty results")
                return {"ids": [[]], "documents": [[]], "metadatas": [[]]}

            if not isinstance(query, str):
                raise ValueError("Query must be a string")

            if len(query.strip()) == 0:
                raise ValueError("Query cannot be empty")

            # Cap results
            n = min(n_results, 50)

            results = self.collection.query(
                query_texts=[query],
                n_results=n,
                include=["documents", "metadatas", "distances"]
            )

            logger.info(f"Search returned {len(results.get('documents', [[]])[0] or [])} results")
            return results
        except Exception as e:
            logger.error(f"Search failed: {e}")
            return {"ids": [[]], "documents": [[]], "metadatas": [[]]}

    def _get_scriptures_count(self):
        """Helper method to get the count of scriptures."""
        cursor = self.conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM scriptures")
        return cursor.fetchone()[0]

    def get_stats(self):
        """Get database statistics."""
        try:
            count = self._get_scriptures_count()

            chroma_count = 0
            if self.collection:
                try:
                    chroma_count = self.collection.count()
                except:
                    pass

            return {
                "sqlite_count": count,
                "chromadb_count": chroma_count
            }
        except Exception as e:
            logger.error(f"Failed to get stats: {e}")
            return {"error": str(e)}

    def health_check(self):
        try:
            count = self._get_scriptures_count()

            chroma_ok = self.collection is not None

            return {
                "sqlite_ok": True,
                "chromadb_ok": chroma_ok,
                "scriptures_count": count
            }
        except Exception as e:
            logger.error(f"Health check failed: {e}")
            return {
                "sqlite_ok": False,
                "chromadb_ok": False,
                "error": str(e)
            }

if __name__ == "__main__":
    try:
        manager = VaultManager()

        # Health check
        health = manager.health_check()
        logger.info(f"Vault Manager Health: {health}")

        # Get stats
        stats = manager.get_stats()
        logger.info(f"Stats: {stats}")

    except Exception as e:
        logger.error(f"Fatal error: {e}")