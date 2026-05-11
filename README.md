# 🕉️ Akasha: Sovereign Vedic Intelligence Portal

**Akasha** is a state-of-the-art, local-first intelligence portal designed to aggregate, organize, and surface sacred Vedic and Dharmic knowledge. It combines a high-performance knowledge graph, an autonomous ingestion engine, and a private AI "Guru" to make deep spiritual wisdom accessible and interactive.

---

## 🚀 Core Features

### 🕸️ Interactive Knowledge Graph
Visualize the interconnected nature of Vedic scriptures. Navigate through verses, commentaries, and philosophical links using a dynamic 3D-inspired knowledge graph.

### 🏛️ Sovereign Vault
A secure, local-first archive for sacred texts. Akasha supports multi-modal ingestion, allowing you to build a personal library from:
- **PDFs** (OCR-ready via Tesseract.js)
- **EPUB & DOCX**
- **Web Archives** (WisdomLib, GRETIL, etc.)
- **Images** (OCR)

### 🧘‍♂️ Guru AI (Ollama Integration)
Chat directly with the scriptures. Integrated with local LLMs via **Ollama**, the Guru provides contextual answers, translations, and philosophical explanations based on your vaulted texts.

### 🚜 Autonomous Harvester
An automated engine that crawls authoritative Dharmic archives, scrapes text, and systematically stores them in the Sovereign Vault while updating the knowledge graph in real-time.

### 🔍 Semantic Vector Search
Beyond simple keyword search—Akasha uses a Python-powered **Semantic Bridge** with vector embeddings (ChromaDB) to find concepts based on meaning and philosophical context.

---

## 🛠️ Tech Stack

### Backend & Ingestion
- **Node.js & Express**: Core application server and API.
- **Python (FastAPI)**: Semantic search engine and vector bridge.
- **ChromaDB**: High-performance vector database.
- **Cheerio**: Robust web scraping.
- **Tesseract.js**: Client-side OCR for scanned manuscripts.

### Frontend
- **Modern Vanilla JS/CSS**: Premium, high-performance UI without the overhead of heavy frameworks.
- **Dynamic 3D Visualization**: Custom implementation for the knowledge graph.

---

## 📦 Installation & Setup

### Prerequisites
- **Node.js** (v18+)
- **Python 3.10+**
- **Ollama** (for local AI features)

### 1. Clone the Repository
```bash
git clone https://github.com/subhakantrout/akasha.git
cd akasha
```

### 2. Install Dependencies
**Node.js Dependencies:**
```bash
npm install
```

**Python Dependencies:**
```bash
pip install -r requirements.txt
```

### 3. Configure Environment
Create a `.env` file in the root directory (refer to `.env.example`):
```env
PORT=3000
PYTHON_ENGINE_PORT=8000
AUTH_ENABLED=false
API_KEY=your_secret_key
```

### 4. Run the Application
Start the unified server (it will automatically spawn the Python bridge):
```bash
npm start
```
The portal will be available at `http://localhost:3000`.

---

## 📂 Project Structure

```text
akasha/
├── ingestion_engine/   # Python Semantic Bridge & Vector DB logic
├── src/                # Core Node.js application modules
│   ├── harvester.js    # Autonomous scraping logic
│   ├── ollama.js       # AI Guru integration
│   ├── ontology.js     # Knowledge graph management
│   └── parser.js       # Multi-modal file processing
├── public/             # Premium Frontend assets
├── data/               # Local storage (Vault, ChromaDB, Analysis)
├── server.js           # Main application entry point
└── sync_vault.py       # Utility for manual vault synchronization
```

---

## 🤝 Contributing
Contributions to preserve and propagate Vedic knowledge are welcome! Please feel free to open issues or submit pull requests.

## 📜 License
This project is licensed under the MIT License.

---
*Created with 🙏 to preserve the eternal wisdom of the Vedas.*
