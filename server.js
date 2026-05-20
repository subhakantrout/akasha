const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs-extra");
const fetch = require("node-fetch");
const cheerio = require("cheerio");
const crypto = require("crypto");
const compression = require("compression");

// Load environment variables
require("dotenv").config();

// Import utilities
const config = require("./src/config");
const logger = require("./src/logger");
const rateLimiter = require("./src/rate-limiter");
const validation = require("./src/validation");

// Import application modules
const { ensureStorage, readAnalysis, writeAnalysis, readSettings, writeSettings } = require("./src/store");
const { checkOllama, askGuru } = require("./src/ollama");
const { getSeedData } = require("./src/ingest");
const { mergeGraphs } = require("./src/ontology");
const harvester = require("./src/harvester");
const parser = require("./src/parser");

// Shared semantic engine buffer
let semanticBuffer = [];
let semanticFlushTimer = null;

async function pushToSemanticEngine(id, content, metadata) {
  semanticBuffer.push({ id, content, metadata });
  
  if (semanticBuffer.length >= 10) {
    await flushSemanticBuffer();
  } else if (!semanticFlushTimer) {
    semanticFlushTimer = setTimeout(flushSemanticBuffer, 10000);
  }
}

async function flushSemanticBuffer() {
  if (semanticBuffer.length === 0) return;
  if (semanticFlushTimer) {
    clearTimeout(semanticFlushTimer);
    semanticFlushTimer = null;
  }

  const batch = [...semanticBuffer];
  semanticBuffer = [];

  try {
    const url = `http://localhost:${config.pythonEngine.port}/ingest_batch`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documents: batch })
    });
    logger.info(`🚀 Flushed ${batch.length} docs to semantic engine from Server`);
  } catch (e) {
    // Re-queue failed documents for retry
    semanticBuffer.push(...batch);
    logger.warn(`Server failed to push batch to semantic engine: ${e.message}. Re-queued ${batch.length} docs.`);
  }
}

const app = express();
app.set('trust proxy', 1); // Enable for proper IP detection behind proxies

// Performance: Gzip compression for faster network
app.use(compression({
  level: 6,
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers['x-no-compress']) return false;
    return compression.filter(req, res);
  }
}));

const PORT = config.port;

// ===========================
// MIDDLEWARE
// ===========================

// CORS - Restricted to configured origins
app.use(cors({
  origin: config.cors.origin,
  credentials: config.cors.credentials,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, "public")));

// Authentication middleware (if enabled)
if (config.auth.enabled) {
  app.use((req, res, next) => {
    const apiKey = req.headers['x-api-key'] || '';
    const expected = config.auth.apiKey || '';
    
    // Timing-safe comparison to prevent timing attacks
    // Hash both values first to prevent length leakage timing attacks
    try {
      const aHash = crypto.createHash('sha256').update(String(apiKey)).digest();
      const bHash = crypto.createHash('sha256').update(String(expected)).digest();

      if (!crypto.timingSafeEqual(aHash, bHash)) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    } catch (e) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  });
}

// Rate limiting middleware
app.use((req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  if (rateLimiter.isRateLimited(ip)) {
    const status = rateLimiter.getRateLimitStatus(ip);
    return res.status(429).json({
      error: 'Rate limit exceeded',
      resetAt: new Date(status.resetAt),
    });
  }
  next();
});


// ===========================
// API ENDPOINTS
// ===========================

let cachedHealth = null;
let lastHealthCheck = 0;

// Health check with caching
app.get("/api/health", async (req, res) => {
  const now = Date.now();
  if (cachedHealth && (now - lastHealthCheck < 30000)) {
    return res.json(cachedHealth);
  }
  
  try {
    const ollama = await checkOllama();
    cachedHealth = { ok: true, app: "Akasha", ollama };
    lastHealthCheck = now;
    res.json(cachedHealth);
  } catch (e) {
    logger.error('Health check failed', { error: e.message });
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/logs", (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 30, 100);
  try {
    const logs = logger.getLogs(limit);
    res.json({ logs });
  } catch (e) {
    logger.error('Failed to fetch logs', { error: e.message });
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

// Get knowledge graph (with pagination — edges filtered to match page nodes)
app.get("/api/knowledge/graph", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 100, 10000); // Max 10000
    
    const analysis = await readAnalysis();
    validation.validateAnalysisData(analysis);
    
    const startIdx = (page - 1) * limit;
    const endIdx = startIdx + limit;
    
    const paginatedNodes = analysis.nodes.slice(startIdx, endIdx);
    const totalPages = Math.ceil(analysis.nodes.length / limit);
    
    // Filter edges to only include those relevant to paginated nodes
    const nodeIds = new Set(paginatedNodes.map(n => n.id));
    const filteredEdges = analysis.edges.filter(e => 
      nodeIds.has(e.from) || nodeIds.has(e.to)
    );
    
    res.json({
      nodes: paginatedNodes,
      edges: filteredEdges,
      pagination: {
        page,
        limit,
        total: analysis.nodes.length,
        totalPages,
      },
      stats: analysis.stats,
    });
  } catch (e) {
    logger.error('Failed to fetch graph', { error: e.message });
    res.status(500).json({ error: 'Failed to fetch knowledge graph' });
  }
});

// Post log (rate limited inherently by middleware)
app.post("/api/logs", (req, res) => {
  try {
    const { msg } = req.body;
    if (!msg || typeof msg !== 'string') {
      return res.status(400).json({ error: 'msg field required' });
    }
    // Limit log message length to prevent abuse
    const sanitized = msg.slice(0, 500);
    logger.info(sanitized);
    res.json({ ok: true });
  } catch (e) {
    logger.error('Failed to post log', { error: e.message });
    res.status(500).json({ error: 'Failed to post log' });
  }
});

// Get vault file by ID (with path traversal protection)
app.get("/api/knowledge/vault/:id", async (req, res) => {
  try {
    const sanitizedId = validation.sanitizeVaultId(req.params.id);
    const vaultPath = path.join(config.vaultDir, `${sanitizedId}.txt`);
    
    // Prevent path traversal
    const resolved = path.resolve(vaultPath);
    const baseResolved = path.resolve(config.vaultDir);
    if (!resolved.startsWith(baseResolved)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    if (await fs.pathExists(vaultPath)) {
      const content = await fs.readFile(vaultPath, "utf8");
      res.json({ content });
    } else {
      res.status(404).json({ error: "Text not found in archive." });
    }
  } catch (e) {
    logger.error('Failed to read vault file', { error: e.message });
    res.status(400).json({ error: e.message });
  }
});

// Ask Guru (with input validation)
app.post("/api/guru/ask", async (req, res) => {
  try {
    const { prompt, mantraId } = req.body;
    
    // Validate input
    const cleanPrompt = validation.validatePrompt(prompt);
    
    const settings = await readSettings();
    logger.info(`🙏 Guru query: "${cleanPrompt.slice(0, 60)}${cleanPrompt.length > 60 ? '…' : ''}"`);
    
    let finalPrompt = cleanPrompt;
    
    if (mantraId) {
      try {
        const analysis = await readAnalysis();
        const verse = analysis.nodes.find(n => n.id === mantraId);
        
        if (verse) {
          let verseText = verse.content;
          
          // Load from vault if not in graph
          if (!verseText) {
            try {
              const sanitizedId = validation.sanitizeVaultId(mantraId);
              const vaultPath = path.join(config.vaultDir, `${sanitizedId}.txt`);
              
              if (await fs.pathExists(vaultPath)) {
                verseText = await fs.readFile(vaultPath, "utf8");
                
                // Truncate large texts to prevent token overflow
                const maxLength = 8000;
                if (verseText.length > maxLength) {
                  verseText = verseText.substring(0, maxLength) + "... (truncated)";
                }
              }
            } catch (e) {
              logger.warn('Failed to load verse from vault', { error: e.message, mantraId });
            }
          }
          
          if (verseText) {
            finalPrompt = `Regarding this Vedic scripture/verse (${verse.label || ''}): "${verseText}"\n\nUser Question: ${cleanPrompt}`;
          } else {
            finalPrompt = `Regarding the topic of ${verse.label || 'Vedic scripture'}:\n\nUser Question: ${cleanPrompt}`;
          }
        }
      } catch (e) {
        logger.warn('Failed to contextualize query', { error: e.message });
      }
    }
    
    const response = await askGuru({
      prompt: finalPrompt,
      model: settings.ai.model
    });
    
    logger.info(`✅ Guru responded (${response ? response.length : 0} chars)`);
    res.json({ response });
  } catch (e) {
    logger.error('Guru query failed', { error: e.message });
    res.status(500).json({ error: e.message });
  }
});

// Translate via Guru
app.post("/api/guru/translate", async (req, res) => {
  try {
    const { text, lang } = req.body;
    
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'text field required' });
    }
    if (!lang || typeof lang !== 'string') {
      return res.status(400).json({ error: 'lang field required' });
    }
    
    const cleanText = text.slice(0, 2000).trim();
    const cleanLang = lang.slice(0, 50).trim();
    
    const settings = await readSettings();
    
    const response = await askGuru({
      prompt: `Translate the following sacred text to ${cleanLang}. Provide an accurate and respectful translation:\n\n${cleanText}`,
      model: settings.ai.model,
      system: 'You are an expert translator of sacred Vedic and Sanskrit texts. Provide accurate, scholarly translations.'
    });
    
    res.json({ response });
  } catch (e) {
    logger.error('Translation failed', { error: e.message });
    res.status(500).json({ error: e.message });
  }
});

// Semantic search via Python bridge
app.post("/api/advanced/search", async (req, res) => {
  try {
    if (!config.features.semanticSearch) {
      return res.status(403).json({ error: 'Semantic search disabled' });
    }
    
    const { query, limit = 10 } = req.body;
    const cleanQuery = validation.validateSearchQuery(query);
    
    logger.info(`🔍 Semantic search: "${cleanQuery.slice(0, 50)}"`);
    
    const engineUrl = `${config.pythonEngine.host}:${config.pythonEngine.port}/search`;
    const response = await Promise.race([
      fetch(engineUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: cleanQuery, limit }),
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), config.pythonEngine.timeout)
      ),
    ]);
    
    if (!response.ok) {
      throw new Error(`Engine returned ${response.status}`);
    }
    
    const data = await response.json();
    logger.info(`✅ Semantic results: ${data.results ? data.results.length : 0} matches`);
    res.json(data);
  } catch (e) {
    logger.error('Semantic search failed', { error: e.message });
    res.status(503).json({ error: "Semantic engine unavailable" });
  }
});

// Web scraping endpoint (with SSRF protection)
app.post("/api/knowledge/scrape", async (req, res) => {
  try {
    if (!config.features.webScraping) {
      return res.status(403).json({ error: 'Web scraping disabled' });
    }
    
    const { url, nodeId } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: "URL required" });
    }
    
    // Validate URL (prevents SSRF)
    await validation.validateUrl(url);
    
    const sanitizedId = nodeId ? 
      validation.sanitizeVaultId(nodeId) : 
      ("ext_" + crypto.createHash("md5").update(url).digest("hex").substring(0, 10));
    
    const vaultPath = path.join(config.vaultDir, `${sanitizedId}.txt`);
    
    // Check if already cached
    if (await fs.pathExists(vaultPath)) {
      const content = await fs.readFile(vaultPath, "utf8");
      return res.json({ ok: true, id: sanitizedId, content, cached: true });
    }
    
    logger.info(`📥 Scraping: ${url.slice(0, 60)}`);
    
    const parsed = await parser.extractTextFromUrl(url);
    let contentToSave = parsed.text;
    
    // Fallback logic for abstract HTML indexes that aren't plain text documents
    if (parsed.type === 'html' && parsed.$) {
      const $ = parsed.$;
      if ($('.list-group-item').length > 0 && !url.includes('/d/doc')) {
        const links = [];
        $('.list-group-item').each((i, el) => {
          const href = $(el).attr('href');
          if (href) {
            links.push({
              title: $(el).text().trim(),
              orig: href.startsWith('http') ? href : 'https://www.wisdomlib.org' + href
            });
          }
        });
        contentToSave = JSON.stringify({
          title: "Archived Manuscript Index",
          description: "Dynamically fetched and archived in Akasha Vault",
          data: links
        }, null, 2);
      }
    }
    
    if (!contentToSave) contentToSave = "Could not extract readable text from page.";
    
    // Save to vault
    await fs.ensureDir(config.vaultDir);
    await fs.writeFile(vaultPath, contentToSave);
    
    logger.info(`✅ Archived: ${sanitizedId}`);
    
    // Attempt to push to semantic engine in background
    pushToSemanticEngine(sanitizedId, contentToSave, {
      label: `Scraped Node ${sanitizedId.substring(0, 6)}`,
      type: "text",
      source: url
    }).catch(e => logger.warn(`Semantic ingest error: ${e.message}`));
    
    res.json({ ok: true, id: sanitizedId, content: contentToSave });
  } catch (e) {
    logger.error('Web scraping failed', { error: e.message });
    res.status(400).json({ error: e.message });
  }
});

// Get settings
app.get("/api/settings", async (req, res) => {
  try {
    const settings = await readSettings();
    res.json(settings);
  } catch (e) {
    logger.error('Failed to fetch settings', { error: e.message });
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// Update settings (with schema validation)
app.post("/api/settings", async (req, res) => {
  try {
    const newSettings = req.body;
    
    if (!newSettings || typeof newSettings !== 'object') {
      return res.status(400).json({ error: 'Invalid settings object' });
    }
    
    // Limit settings size to prevent abuse (max 10KB)
    const serialized = JSON.stringify(newSettings);
    if (serialized.length > 10240) {
      return res.status(400).json({ error: 'Settings too large (max 10KB)' });
    }
    
    // Whitelist allowed settings keys
    const allowed = {};
    if (newSettings.ai && typeof newSettings.ai === 'object') {
      allowed.ai = {
        enabled: typeof newSettings.ai.enabled === 'boolean' ? newSettings.ai.enabled : true,
        model: typeof newSettings.ai.model === 'string' ? newSettings.ai.model.slice(0, 100) : undefined,
      };
    }
    if (newSettings.ui && typeof newSettings.ui === 'object') {
      allowed.ui = {
        theme: typeof newSettings.ui.theme === 'string' ? newSettings.ui.theme.slice(0, 50) : 'temple',
      };
    }
    
    // Merge with existing settings
    const existing = await readSettings();
    const merged = { ...existing, ...allowed };
    
    await writeSettings(merged);
    logger.info('⚙️ Settings updated');
    res.json({ ok: true, settings: merged });
  } catch (e) {
    logger.error('Failed to update settings', { error: e.message });
    res.status(500).json({ error: e.message });
  }
});

// ===========================
// HARVESTER ENDPOINTS
// ===========================

app.get("/api/harvester/status", (req, res) => {
  try {
    res.json(harvester.getHarvesterStatus());
  } catch (e) {
    logger.error('Failed to get harvester status', { error: e.message });
    res.status(500).json({ error: 'Failed to get status' });
  }
});

app.post("/api/harvester/start", (req, res) => {
  try {
    harvester.startHarvester();
    res.json({ ok: true, status: harvester.getHarvesterStatus() });
  } catch (e) {
    logger.error('Failed to start harvester', { error: e.message });
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/harvester/stop", (req, res) => {
  try {
    harvester.stopHarvester();
    res.json({ ok: true, status: harvester.getHarvesterStatus() });
  } catch (e) {
    logger.error('Failed to stop harvester', { error: e.message });
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/harvester/job", (req, res) => {
  try {
    const { type, url, metadata } = req.body;
    if (!type || !url) {
      return res.status(400).json({ error: "type and url required" });
    }
    const queued = harvester.addJob(type, url, metadata);
    res.json({ ok: true, queued, status: harvester.getHarvesterStatus() });
  } catch (e) {
    logger.error('Failed to add harvester job', { error: e.message });
    res.status(500).json({ error: e.message });
  }
});


// ===========================
// STARTUP & INITIALIZATION
// ===========================

function initPythonBridge() {
  if (config.features.semanticSearch) {
    try {
      const { spawn } = require('child_process');
      const pythonProcess = spawn('python', ['ingestion_engine/bridge.py'], {
        cwd: __dirname,  // Ensure correct working directory
      });

      pythonProcess.stdout.on('data', (data) => {
        logger.debug(`Python Bridge: ${data}`.trim());
      });

      pythonProcess.stderr.on('data', (data) => {
        // FastAPI/uvicorn logs to stderr by default — treat as debug unless error-like
        const msg = `${data}`.trim();
        if (msg.includes('Error') || msg.includes('error') || msg.includes('Traceback')) {
          logger.error(`Python Bridge Error: ${msg}`);
        } else {
          logger.debug(`Python Bridge: ${msg}`);
        }
      });

      pythonProcess.on('close', (code) => {
        if (code !== 0) {
          logger.warn(`Python bridge exited with code ${code}`);
        }
      });

      pythonProcess.on('error', (err) => {
        logger.warn(`Python bridge spawn failed: ${err.message}. Semantic search will be unavailable.`);
      });

      process.on('exit', () => { try { pythonProcess.kill(); } catch(e) {} });
      process.on('SIGINT', () => {
        try { pythonProcess.kill(); } catch(e) {}
        process.exit();
      });
      process.on('SIGTERM', () => {
        try { pythonProcess.kill(); } catch(e) {}
        process.exit();
      });

      logger.info('🔗 Python Semantic Vector Bridge spawned.');
    } catch (e) {
      logger.warn('Could not spawn Python bridge', { error: e.message });
    }
  }
}

async function seedKnowledgeGraph() {
  const current = await readAnalysis();
  if (!current.nodes || current.nodes.length === 0) {
    logger.info('📦 Seeding initial Vedic knowledge graph…');
    const seed = getSeedData();
    const fullGraph = mergeGraphs(seed.map(s => s.analysis));
    await writeAnalysis({
      generatedAt: new Date().toISOString(),
      stats: {
        texts: seed.length,
        nodes: fullGraph.nodes.length,
        edges: fullGraph.edges.length
      },
      nodes: fullGraph.nodes,
      edges: fullGraph.edges,
    });
    logger.info(`✅ Seeded ${fullGraph.nodes.length} nodes, ${fullGraph.edges.length} edges`);
  } else {
    logger.info(`📊 Knowledge graph loaded: ${current.nodes.length} nodes, ${current.edges.length} edges`);
  }
}

async function reportVaultStatus() {
  try {
    const vaultFiles = await fs.readdir(config.vaultDir);
    logger.info(`📁 Sovereign Vault: ${vaultFiles.length} sacred texts archived`);
  } catch (e) {
    logger.warn('Could not read vault directory', { error: e.message });
  }
}

async function checkOllamaStatus() {
  try {
    const ollamaStatus = await checkOllama();
    if (ollamaStatus && ollamaStatus.online) {
      logger.info(`🧠 Guru online — ${ollamaStatus.models ? ollamaStatus.models.length : 0} models available`);
    } else {
      logger.warn('⚠️ Guru (Ollama) is offline');
    }
  } catch (e) {
    logger.warn('Could not reach Ollama', { error: e.message });
  }
}

function startHeartbeat() {
  setInterval(() => {
    const uptime = process.uptime();
    const hrs = Math.floor(uptime / 3600);
    const mins = Math.floor((uptime % 3600) / 60);
    logger.debug(`💓 System heartbeat — uptime: ${hrs}h ${mins}m`);
  }, 120000); // Every 2 minutes
}

async function startup() {
  try {
    // Initialize storage
    await ensureStorage();
    logger.info('🕉️ AKASHA system initializing…');
    
    // Spawn Python Semantic Bridge (if semantic search enabled)
    initPythonBridge();
    
    // Initialize autonomous harvester
    harvester.initHarvester((msg) => logger.info(msg));
    
    // Load or seed knowledge graph
    await seedKnowledgeGraph();
    
    // Report vault status
    await reportVaultStatus();
    
    // Check Ollama status
    await checkOllamaStatus();
    
    logger.info('✅ AKASHA portal ready. All systems nominal.');
    
    // Start autonomous harvester (if enabled)
    if (config.features.harvester) {
      harvester.startHarvester();
    }
    
    // Start server
    app.listen(PORT, () => {
      logger.info(`🚀 Akasha Intelligence running at http://localhost:${PORT}`);
    });
    
    // Periodic heartbeat
    startHeartbeat();
  } catch (e) {
    logger.error('Startup failed', { error: e.message });
    process.exit(1);
  }
}

// Start the application
startup().catch(e => {
  console.error('Fatal startup error:', e);
  process.exit(1);
});

module.exports = app;
