import os
import sys
import json
import logging


sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ingestion_engine.vault_manager import VaultManager

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def sync_vault():
    vault_dir = "data/vault"
    analysis_file = "data/analysis.json"
    
    if not os.path.exists(analysis_file):
        logger.error("analysis.json not found")
        return
        
    with open(analysis_file, 'r', encoding='utf-8') as f:
        data = json.load(f)
        
    nodes = data.get("nodes", [])
    logger.info(f"Loaded {len(nodes)} nodes from analysis.json")
    
    manager = VaultManager()
    if not manager.collection:
        logger.error("ChromaDB not initialized")
        return
        
    # Get existing IDs from ChromaDB to avoid re-embedding everything
    try:
        existing = manager.collection.get(include=[])
        existing_ids = set(existing.get("ids", []))
        logger.info(f"Found {len(existing_ids)} existing documents in ChromaDB")
    except Exception as e:
        existing_ids = set()
        logger.warning(f"Could not get existing IDs: {e}")

    batch_ids = []
    batch_docs = []
    batch_metadatas = []
    
    added = 0
    skipped = 0
    
    # We only care about text/verse nodes that have content or a vaultFile
    valid_nodes = [n for n in nodes if n.get("type") in ["text", "verse", "sukta", "mandala"] and (n.get("content") or n.get("vaultFile"))]
    
    for node in valid_nodes:
        node_id = node.get("id")
        if node_id in existing_ids:
            skipped += 1
            continue
            
        content = node.get("content")
        
        if not content and node.get("vaultFile"):
            vault_path = os.path.join(vault_dir, node.get("vaultFile"))
            if os.path.exists(vault_path):
                with open(vault_path, 'r', encoding='utf-8', errors='ignore') as f:
                    content = f.read()
                    
        if not content:
            continue
            
        # Truncate content if too large (Ollama max tokens)
        content = content[:2000]
            
        batch_ids.append(node_id)
        batch_docs.append(content)
        
        metadata = {
            "label": str(node.get("label", ""))[:100],
            "type": str(node.get("type", "")),
            "category": str(node.get("category", "")),
            "source": str(node.get("source", ""))[:100]
        }
        batch_metadatas.append(metadata)
        
        # Batch upsert every 5 docs to avoid Ollama timeout
        if len(batch_ids) >= 5:
            try:
                manager.collection.upsert(
                    ids=batch_ids,
                    documents=batch_docs,
                    metadatas=batch_metadatas
                )
                added += len(batch_ids)
            except Exception as e:
                logger.error(f"Failed to upsert batch: {e}")
            batch_ids, batch_docs, batch_metadatas = [], [], []

    # Final batch
    if len(batch_ids) > 0:
        try:
            manager.collection.upsert(
                ids=batch_ids,
                documents=batch_docs,
                metadatas=batch_metadatas
            )
            added += len(batch_ids)
        except Exception as e:
            logger.error(f"Failed to upsert final batch: {e}")

    logger.info(f"Sync complete. Added {added} new documents, skipped {skipped} existing.")

if __name__ == "__main__":
    sync_vault()
