require('dotenv').config();
const path = require('path');

const config = {
  node_env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '8080'),
  
  // Ollama Integration
  ollama: {
    host: process.env.OLLAMA_HOST || 'http://localhost:11434',
    model: process.env.OLLAMA_MODEL || 'llama3.2', // Default model if not set
    embeddingModel: process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text',
    timeout: parseInt(process.env.OLLAMA_TIMEOUT || '300000'), // default 5 mins
  },
  
  // Python Engine
  pythonEngine: {
    host: process.env.PYTHON_ENGINE_HOST || 'http://127.0.0.1',
    port: parseInt(process.env.PYTHON_ENGINE_PORT || '8000'),
    timeout: parseInt(process.env.PYTHON_ENGINE_TIMEOUT || '30000'), // default 30 secs
  },
  
  // Security
  cors: {
    origin: process.env.CORS_ORIGIN === '*' ? '*' : (process.env.CORS_ORIGIN || 'http://localhost:8080').split(','),
    credentials: true,
  },
  auth: {
    enabled: process.env.ENABLE_AUTH === 'true',
    apiKey: process.env.ENABLE_AUTH === 'true' && !process.env.API_KEY
      ? (() => { throw new Error('API_KEY environment variable is required when ENABLE_AUTH is true'); })()
      : process.env.API_KEY,
  },
  
  // Rate Limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'),
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
  },
  
  // Paths
  dataDir: process.env.DATA_DIR || path.join(__dirname, '..', 'data'),
  vaultDir: process.env.VAULT_DIR || path.join(__dirname, '..', 'data', 'vault'),
  chromaDbPath: process.env.CHROMA_DB_PATH || path.join(__dirname, '..', 'data', 'chroma_db'),
  
  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    file: process.env.LOG_FILE || path.join(__dirname, '..', 'logs', 'akasha.log'),
  },
  
  // Features
  features: {
    webScraping: process.env.ENABLE_WEB_SCRAPING !== 'false',
    semanticSearch: process.env.ENABLE_SEMANTIC_SEARCH !== 'false',
    harvester: process.env.ENABLE_HARVESTER !== 'false',
  },
  
  // Harvester
  harvester: {
    rateLimitMs: parseInt(process.env.HARVESTER_RATE_LIMIT_MS || '2000'),
    maxRetries: parseInt(process.env.HARVESTER_MAX_RETRIES || '3'),
    retryBackoffMs: parseInt(process.env.HARVESTER_RETRY_BACKOFF_MS || '5000'),
    crawlDepth: parseInt(process.env.HARVESTER_CRAWL_DEPTH || '3'),
    maxQueueSize: parseInt(process.env.HARVESTER_MAX_QUEUE_SIZE || '5000'),
  },

  // Search Engines
  searchEngines: {
    // SerpAPI key for Google (optional - set SERP_API_KEY env var)
    serpApiKey: process.env.SERP_API_KEY || '',
    // DuckDuckGo is free (used by default)
    preferred: process.env.SEARCH_ENGINE || 'duckduckgo', // 'google', 'bing', 'duckduckgo'
  },

  // Source Priority (higher = more authoritative)
  sourcePriority: {
    'wisdomlib.org': 90,
    'sacred-texts.com': 85,
    'archive.org': 80,
    'sanskritdocuments.org': 85,
    'hinduismtoday.com': 70,
    'vedicbooks.net': 75,
    'google.com': 50,
    'wikipedia.org': 60,
    'youtube.com': 20,
    'blogspot.com': 30,
    'wordpress.com': 25,
  },
};

module.exports = config;
