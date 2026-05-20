from fastapi import FastAPI
from pydantic import BaseModel
import uvicorn
import os
import sys

# Ensure imports work when spawned from project root
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from vault_manager import VaultManager

app = FastAPI()
vault = VaultManager()

class SearchQuery(BaseModel):
    query: str
    limit: int = 5

class IngestDocument(BaseModel):
    id: str
    content: str
    metadata: dict

@app.post("/ingest")
async def ingest_doc(doc: IngestDocument):
    if not vault.collection:
        return {"status": "error", "message": "ChromaDB not initialized"}
    try:
        # Store full content but limit for ChromaDB's embedding limit (smaller chunk for embedding, store rest as metadata)
        content = doc.content[:8000] if len(doc.content) > 8000 else doc.content
        vault.collection.upsert(
            ids=[doc.id],
            documents=[content],
            metadatas=[{**doc.metadata, "full_length": len(doc.content)}]
        )
        return {"status": "success", "id": doc.id, "stored_length": len(content)}
    except Exception as e:
        return {"status": "error", "message": str(e)}

class BatchIngest(BaseModel):
    documents: list[IngestDocument]

@app.post("/ingest_batch")
async def ingest_batch(batch: BatchIngest):
    if not vault.collection:
        return {"status": "error", "message": "ChromaDB not initialized"}
    count = vault.batch_ingest([d.model_dump() for d in batch.documents])
    return {"status": "success", "count": count}

@app.post("/search")
async def search_vault(q: SearchQuery):
    results = vault.search(q.query, n_results=q.limit)
    # Reformat for easy consumption
    output = []
    if results['documents']:
        for i in range(len(results['documents'][0])):
            output.append({
                "content": results['documents'][0][i],
                "metadata": results['metadatas'][0][i],
                "id": results['ids'][0][i]
            })
    return {"results": output}

@app.get("/status")
async def get_status():
    return {"status": "online", "engine": "ChromaDB Semantic Bridge"}

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
