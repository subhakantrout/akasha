const fs = require('fs-extra');
const path = require('path');
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const crypto = require('crypto');
const config = require('./config');
const logger = require('./logger');
const { readAnalysis, updateAnalysis, readSettings } = require('./store');
const { askGuru } = require('./ollama');
const parser = require('./parser');

// ===============================
// ADVANCED HARVESTER FEATURES
// ===============================

// Content deduplication at text level (simhash-like)
const textHashes = new Set();
function getTextHash(text) {
  return crypto.createHash('md5').update(text.slice(0, 5000).normalize('NFKC')).digest('hex').slice(0, 16);
}

function isDuplicateContent(text) {
  const hash = getTextHash(text);
  if (textHashes.has(hash)) return true;
  textHashes.add(hash);
  // Keep memory bounded
  if (textHashes.size > 5000) {
    const arr = [...textHashes];
    textHashes.clear();
    arr.slice(-2500).forEach(h => textHashes.add(h));
  }
  return false;
}

// Source priority scoring
function getSourcePriority(url) {
  const priorityMap = config.sourcePriority;
  for (const [domain, score] of Object.entries(priorityMap)) {
    if (url.includes(domain)) return score;
  }
  return 50; // default medium priority
}

// URL respect robots.txt (basic check)
const robotsCache = new Map();
async function canCrawlUrl(url) {
  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname;

    if (!robotsCache.has(hostname)) {
      try {
        const robotsRes = await fetch(`https://${hostname}/robots.txt`, { timeout: 5000 });
        const robotsTxt = await robotsRes.text();
        robotsCache.set(hostname, robotsTxt.toLowerCase());
      } catch {
        robotsCache.set(hostname, ''); // No robots.txt = allow
      }
    }

    const robotsTxt = robotsCache.get(hostname);
    if (robotsTxt.includes('disallow') && robotsTxt.includes('/')) {
      // Simple check - if robots exists and has disallow, be conservative
      const userAgent = 'akashaharvester';
      const lines = robotsTxt.split('\n');
      let disallowed = false;
      let applicable = false;

      for (const line of lines) {
        if (line.startsWith('user-agent:')) {
          applicable = line.includes(userAgent) || line === 'user-agent: *';
        } else if (applicable && line.startsWith('disallow:')) {
          const disallowPath = line.split('disallow:')[1].trim();
          if (disallowPath && parsedUrl.pathname.startsWith(disallowPath)) {
            disallowed = true;
            break;
          }
        }
      }
      return !disallowed;
    }
    return true;
  } catch {
    return true; // Default allow if check fails
  }
}

// Search engine多样
async function searchMultipleEngines(query, limit = 10) {
  const results = [];

  // DuckDuckGo (free, default)
  try {
    const ddgRes = await Promise.race([
      fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('DDG timeout')), 15000))
    ]);

    if (ddgRes.ok) {
      const html = await ddgRes.text();
      const $ = cheerio.load(html);
      $('.result__url').each((i, el) => {
        let url = $(el).attr('href');
        if (url && url.startsWith('//duckduckgo.com/l/?uddg=')) {
          try {
            const targetUrl = decodeURIComponent(url.split('uddg=')[1].split('&')[0]);
            if (targetUrl.startsWith('http') && !targetUrl.includes('youtube.com')) {
              results.push({ url: targetUrl, engine: 'duckduckgo', priority: getSourcePriority(targetUrl) });
            }
          } catch {}
        }
      });
    }
  } catch (e) {
    logger.debug(`DuckDuckGo failed: ${e.message}`);
  }

  // Bing (if configured)
  if (config.searchEngines.preferred === 'bing' && config.searchEngines.serpApiKey) {
    try {
      const bingRes = await fetch(`https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(query)}`, {
        headers: { 'Ocp-Apim-Subscription-Key': config.searchEngines.serpApiKey }
      });
      const bingData = await bingRes.json();
      if (bingData.webPages?.value) {
        for (const item of bingData.webPages.value) {
          if (!item.url.includes('youtube.com')) {
            results.push({ url: item.url, engine: 'bing', priority: getSourcePriority(item.url) });
          }
        }
      }
    } catch (e) {
      logger.debug(`Bing failed: ${e.message}`);
    }
  }

  // Sort by priority (authoritative sources first)
  results.sort((a, b) => b.priority - a.priority);
  return results.slice(0, limit);
}

// Crawl depth tracking
const crawlDepthTracker = new Map();
function getCrawlDepth(url, parentDepth = 0) {
  const key = new URL(url).hostname;
  const currentDepth = crawlDepthTracker.get(key) || 0;
  const newDepth = Math.min(currentDepth + 1, config.harvester.crawlDepth);
  crawlDepthTracker.set(key, newDepth);
  return newDepth;
}

// ===============================
// PERFORMANCE OPTIMIZATIONS
// ===============================

// Semantic buffer with larger batch for efficiency
let semanticBuffer = [];
let semanticFlushTimer = null;
const BATCH_THRESHOLD = 20; // Larger batch = more efficient
const FLUSH_INTERVAL = 5000; // 5 seconds

// O(1) duplicate detection using Set
const processedUrls = new Set();
const urlSet = new Set();

async function pushToSemanticEngine(id, content, metadata) {
  semanticBuffer.push({ id, content, metadata });

  if (semanticBuffer.length >= BATCH_THRESHOLD) {
    await flushSemanticBuffer();
  } else if (!semanticFlushTimer) {
    semanticFlushTimer = setTimeout(flushSemanticBuffer, FLUSH_INTERVAL);
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
    logger.info(`🚀 Flushed ${batch.length} docs to semantic engine`);
  } catch (e) {
    // Re-queue failed documents
    semanticBuffer.push(...batch);
    logger.warn(`Failed to push batch to semantic engine: ${e.message}. Re-queued ${batch.length} docs.`);
  }
}

// ===============================
// HARVESTER ENGINE
// ===============================

const QUEUE_FILE = path.join(config.dataDir, 'harvester_queue.json');

const STATE = {
  isRunning: false,
  queue: [],
  processing: false,
  stats: {
    processed: 0,
    failed: 0,
    queued: 0,
    duplicates: 0,
    robotsBlocked: 0
  }
};

function uid(s) {
  return crypto.createHash('md5').update(s).digest('hex').slice(0, 8);
}

async function initHarvester(logCallback) {
  try {
    await fs.ensureFile(QUEUE_FILE);
    try {
      const savedQueue = await fs.readJson(QUEUE_FILE);
      STATE.queue = Array.isArray(savedQueue) ? savedQueue : [];
      // Rebuild URL set for O(1) duplicate detection
      STATE.queue.forEach(j => urlSet.add(j.url));
    } catch (e) {
      STATE.queue = [];
    }
    STATE.stats.queued = STATE.queue.length;
    logger.info(`Harvester initialized with ${STATE.queue.length} queued jobs`);
  } catch (e) {
    logger.error('Failed to initialize harvester', { error: e.message });
  }
}

let pendingQueueSave = false;
let saveTimeout = null;

async function saveQueue() {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }

  saveTimeout = setTimeout(async () => {
    try {
      await fs.writeJson(QUEUE_FILE, STATE.queue, { spaces: 2 });
    } catch (e) {
      logger.error('Failed to save harvester queue', { error: e.message });
    }
  }, 1000); // Quick save after changes
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    const params = ['utm_source', 'utm_medium', 'utm_campaign', 'fbclid', 'gclid', 'ref'];
    params.forEach(p => u.searchParams.delete(p));
    return u.toString();
  } catch (e) {
    return url;
  }
}

function addJob(type, url, metadata = {}) {
  const normUrl = normalizeUrl(url);

  // O(1) duplicate check using Set
  if (urlSet.has(normUrl)) {
    return false;
  }

  // Queue size limit
  if (STATE.queue.length >= config.harvester.maxQueueSize) {
    logger.warn(`Queue full (${config.harvester.maxQueueSize}), dropping: ${normUrl.slice(0, 40)}`);
    return false;
  }

  const priority = getSourcePriority(normUrl);
  const depth = metadata.depth || 0;

  STATE.queue.push({
    id: uid(normUrl + type),
    type,
    url: normUrl,
    metadata: { ...metadata, priority, depth },
    addedAt: Date.now(),
    retries: 0,
    backoff: 1000,
    priority // Higher = more important
  });

  // Sort queue by priority (higher first)
  STATE.queue.sort((a, b) => b.priority - a.priority);

  urlSet.add(normUrl);
  STATE.stats.queued = STATE.queue.length;
  saveQueue();
  logger.info(`📥 Queued [${type}] priority:${priority} ${url.slice(0, 50)}`);

  if (STATE.isRunning && !STATE.processing) {
    processNext();
  }
  return true;
}

const MAX_CONCURRENT_WORKERS = 5;

function startHarvester() {
  if (STATE.isRunning) return;
  STATE.isRunning = true;
  logger.info(`🕸️ Autonomous Harvester Engine started with ${MAX_CONCURRENT_WORKERS} workers`);
  for (let i = 0; i < MAX_CONCURRENT_WORKERS; i++) {
    processNext();
  }
}

function stopHarvester() {
  STATE.isRunning = false;
  logger.info('🕸️ Autonomous Harvester Engine stopped');
}

function getHarvesterStatus() {
  return {
    ...STATE.stats,
    queued: STATE.queue.length,
    isRunning: STATE.isRunning,
    queueByPriority: {
      high: STATE.queue.filter(j => j.priority >= 80).length,
      medium: STATE.queue.filter(j => j.priority >= 50 && j.priority < 80).length,
      low: STATE.queue.filter(j => j.priority < 50).length
    }
  };
}

// ===============================
// WORKER LOOP
// ===============================

async function processNext() {
  if (!STATE.isRunning) {
    STATE.processing = false;
    return;
  }

  if (STATE.queue.length === 0) {
    if (config.features.harvester) {
      await triggerAutonomousDiscovery();
    }
    if (STATE.queue.length === 0) {
      STATE.processing = false;
      return;
    }
  }

  STATE.processing = true;
  const job = STATE.queue.shift();

  // Remove from URL set
  urlSet.delete(job.url);

  STATE.stats.queued = STATE.queue.length;
  saveQueue();

  try {
    logger.info(`Processing job: ${job.type}`);

    if (job.type === 'spider_wisdomlib_index') {
      await spiderWisdomLibIndex(job);
    } else if (job.type === 'spider_sacred_texts_index') {
      await spiderSacredTextsIndex(job);
    } else if (job.type === 'extract_text') {
      await extractTextJob(job);
    } else if (job.type === 'open_internet_discovery') {
      await openInternetDiscovery(job);
    } else if (job.type === 'open_internet_evaluate') {
      await openInternetEvaluate(job);
    } else {
      logger.warn(`Unknown job type: ${job.type}`);
    }

    STATE.stats.processed++;
    // Mark as processed to avoid re-adding
    processedUrls.add(job.url);

    logger.info(`✅ Job completed: ${job.type}`);
  } catch (e) {
    STATE.stats.failed++;
    logger.error(`Job failed: ${job.type}`, { error: e.message, url: job.url });

    // Exponential backoff retry
    if (job.retries < config.harvester.maxRetries) {
      job.retries++;
      job.backoff = Math.min(job.backoff * 2, 30000); // Cap at 30s

      logger.info(`Re-queuing job (Retry ${job.retries}/${config.harvester.maxRetries}) with ${job.backoff}ms backoff`);

      await new Promise(resolve => setTimeout(resolve, job.backoff));

      // Add back to queue
      STATE.queue.push(job);
      urlSet.add(job.url);
      STATE.stats.queued = STATE.queue.length;
      saveQueue();
    } else {
      logger.warn(`Job abandoned after ${job.retries} retries`);
    }
  }

  await new Promise(resolve => setTimeout(resolve, config.harvester.rateLimitMs));

  if (STATE.isRunning) {
    setImmediate(() => processNext());
  } else {
    STATE.processing = false;
  }
}

// ===============================
// AUTONOMOUS MISSION
// ===============================

async function triggerAutonomousDiscovery() {
  try {
    logger.info("Queue empty. Generating enhanced discovery mission...");
    const analysis = await readAnalysis(false);

    // Priority-aware search queries (target authoritative sources)
    const priorityQueries = [
      "site:wisdomlib.org vedic",
      "site:archive.org ancient indian scripture",
      "site:sanskritdocuments.org philosophical",
      "vedic manuscript pdf download",
      "upanishad english translation authentic",
      "mahabharata critical edition pdf",
      "bhagavad gita scholarly translation",
      "puranas ancient hindu text",
      "vedas sanskrit english pdf"
    ];

    // If we have existing nodes, build contextual queries
    if (analysis.nodes && analysis.nodes.length > 0) {
      const randomNode = analysis.nodes[Math.floor(Math.random() * analysis.nodes.length)];
      const suffixes = [
        "site:wisdomlib.org",
        "site:archive.org",
        "authentic translation pdf",
        "ancient manuscript archive"
      ];
      const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
      const query = `${randomNode.label} ${suffix}`;
      addJob('open_internet_discovery', query, { query, priority: 80 });
    } else {
      // Use pre-defined high-authority queries
      const query = priorityQueries[Math.floor(Math.random() * priorityQueries.length)];
      addJob('open_internet_discovery', query, { query, priority: 90 });
    }

    logger.info(`Generated priority discovery mission`);
  } catch (e) {
    logger.warn('Failed to generate autonomous mission', { error: e.message });
  }
}

// ===============================
// SPIDERS
// ===============================

async function fetchDom(url, timeout = 30000) {
  try {
    const response = await Promise.race([
      fetch(url, {
        headers: { 'User-Agent': 'AkashaHarvester/2.0 (Dharmic Knowledge Project)' }
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Request timeout')), timeout)
      )
    ]);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    return cheerio.load(html);
  } catch (e) {
    logger.error('Failed to fetch DOM', { error: e.message, url });
    throw e;
  }
}

async function spiderWisdomLibIndex(job) {
  logger.info(`Spidering WisdomLib Index: ${job.url}`);

  const parsed = await parser.extractTextFromUrl(job.url);
  if (!parsed.$) {
    logger.warn(`Failed to parse HTML for indexing: ${job.url}`);
    return;
  }
  const $ = parsed.$;

  let linkCount = 0;
  const bookBase = new URL(job.url).pathname;

  $('a').each((i, el) => {
    let href = $(el).attr('href');
    if (!href) return;

    if (href.startsWith(bookBase) && href.includes('/d/doc')) {
      const fullUrl = href.startsWith('http') ? href : `https://www.wisdomlib.org${href}`;
      const title = $(el).text().trim() || `Chapter ${linkCount + 1}`;

      addJob('extract_text', fullUrl, {
        category: job.metadata.category || 'academic',
        source: 'wisdomlib',
        label: `${job.metadata.bookTitle || 'Book'} - ${title}`,
        priority: 90
      });
      linkCount++;
    }
  });

  // Also discover PDF/Epub links
  const docLinks = discoverDocumentLinks($, job.url);
  logger.info(`Spider found ${linkCount} chapters + ${docLinks.length} documents`);
}

function discoverDocumentLinks($, baseUrl) {
  const documents = [];
  const docExtensions = ['.pdf', '.epub', '.mobi', '.djvu', '.txt'];

  $('a').each((i, el) => {
    const href = $(el).attr('href');
    if (!href) return;

    const ext = docExtensions.find(e => href.toLowerCase().endsWith(e));
    if (ext) {
      const fullUrl = href.startsWith('http') ? href : new URL(href, baseUrl).toString();
      documents.push({
        url: fullUrl,
        type: ext.slice(1),
        title: $(el).text().trim() || `Document ${documents.length + 1}`
      });
    }
  });

  return documents;
}

async function spiderSacredTextsIndex(job) {
  logger.info(`Spidering Sacred-Texts Index: ${job.url}`);

  const $ = await fetchDom(job.url);
  const baseUrl = job.url.substring(0, job.url.lastIndexOf('/') + 1);
  let linkCount = 0;

  $('a').each((i, el) => {
    let href = $(el).attr('href');
    if (!href || href.startsWith('http') || href.startsWith('#') || href.includes('index.htm')) return;

    if (href.endsWith('.htm') || href.endsWith('.html')) {
      const fullUrl = baseUrl + href;
      const title = $(el).text().trim() || `Section ${linkCount + 1}`;

      addJob('extract_text', fullUrl, {
        category: job.metadata.category || 'academic',
        source: 'sacred-texts',
        label: `${job.metadata.bookTitle || 'Book'} - ${title}`,
        priority: 85
      });
      linkCount++;
    }
  });

  // Discover documents
  const docLinks = discoverDocumentLinks($, baseUrl);
  for (const doc of docLinks) {
    addJob('extract_text', doc.url, {
      category: job.metadata.category || 'academic',
      source: 'sacred-texts',
      label: doc.title,
      isDocument: true,
      docType: doc.type,
      priority: 85
    });
  }

  logger.info(`Spider found ${linkCount} chapters + ${docLinks.length} docs`);
}

// ===============================
// OPEN INTERNET DISCOVERY
// ===============================

async function openInternetDiscovery(job) {
  const query = job.metadata.query || job.url;
  logger.info(`🔍 Multi-engine discovery for: "${query.slice(0, 60)}"`);

  try {
    // Use advanced multi-engine search
    const results = await searchMultipleEngines(query, 15);
    let linkCount = 0;

    for (const result of results) {
      // Check robots.txt before adding
      const allowed = await canCrawlUrl(result.url);
      if (!allowed) {
        STATE.stats.robotsBlocked++;
        logger.debug(`Blocked by robots.txt: ${result.url}`);
        continue;
      }

      addJob('open_internet_evaluate', result.url, {
        category: 'discovered',
        query: query,
        source: result.engine,
        engine: result.engine,
        priority: result.priority
      });
      linkCount++;
    }

    logger.info(`🌐 Discovery found ${linkCount} allowed sources (sorted by authority)`);
  } catch (e) {
    logger.error('Discovery search failed', { error: e.message });
    throw e;
  }
}

async function openInternetEvaluate(job) {
  logger.info(`Evaluating [priority:${job.metadata?.priority || '?'}]: ${job.url.slice(0, 60)}`);

  // Check robots.txt
  const allowed = await canCrawlUrl(job.url);
  if (!allowed) {
    STATE.stats.robotsBlocked++;
    logger.info(`🚫 Blocked by robots.txt: ${job.url}`);
    return;
  }

  const fileId = `wild_${uid(job.url)}`;
  const extractResult = await checkVaultAndExtract(job, fileId);
  if (!extractResult) return;
  const { fp, parsed } = extractResult;

  let rawText = parsed.text;

  if (!rawText || rawText.length < 200) {
    logger.info(`Skipping: insufficient content (${rawText?.length || 0} chars)`);
    return;
  }

  // Content-level deduplication
  if (isDuplicateContent(rawText)) {
    STATE.stats.duplicates++;
    logger.info(`🗑️ Duplicate content detected, skipping`);
    return;
  }

  const docTypeContext = parsed.type !== 'html' ? `\nNote: This text was extracted from a ${parsed.type.toUpperCase()} document.` : '';

  const sampleText = rawText.substring(0, 8000);
  logger.info(`Asking Guru to evaluate content relevance...`);

  const prompt = `You are the Akasha Ingestion Gatekeeper. Evaluate this extracted text.
Does it contain substantive, authentic Vedic, Dharmic, Hindu philosophical, or ancient Indian knowledge?

If NOT (blog post, unrelated news, product page), output EXACTLY: REJECTED
If YES, extract and clean up the core knowledge, removing boilerplate.

TEXT:
${sampleText}${docTypeContext}`;

  const settings = await readSettings();

  const aiResponse = await askGuru({
    prompt,
    system: 'You are a highly strict academic and spiritual archivist.',
    model: settings.ai.model
  });

  if (aiResponse.includes('REJECTED') || aiResponse.trim().length < 50) {
    logger.info(`❌ AI rejected content from: ${job.url}`);
    return;
  }

  logger.info(`✅ AI approved! Archiving knowledge...`);

  const title = parsed.title || (parsed.$ && parsed.$('title').text().trim()) || 'Discovered Knowledge';
  const header = `=== ${title} ===\nSource: ${job.url}\nCategory: Discovered\nMethod: AI Harvester\nEngine: ${job.metadata?.engine || 'unknown'}\nPriority: ${job.metadata?.priority || 50}\n${"=".repeat(40)}\n\n`;

  await fs.ensureDir(config.vaultDir);
  await fs.writeFile(fp, header + aiResponse, "utf8");

  await updateAnalysis((analysis) => {
    analysis.nodes.push({
      id: fileId,
      label: title.substring(0, 50),
      type: "text",
      category: "discovered",
      vaultFile: `${fileId}.txt`,
      size: aiResponse.length,
      harvesterTag: true,
      sourcePriority: job.metadata?.priority || 50
    });
    analysis.stats.nodes = analysis.nodes.length;
  });

  await pushToSemanticEngine(fileId, aiResponse, {
    label: title.substring(0, 50),
    type: "text",
    category: "discovered",
    source: job.url
  });

  logger.info(`🌟 Added to vault: ${title.substring(0, 40)}`);
}

// ===============================
// EXTRACTION WORKER
// ===============================

async function checkVaultAndExtract(job, fileId) {
  const fp = path.join(config.vaultDir, `${fileId}.txt`);

  if (await fs.pathExists(fp)) {
    logger.info(`Already in vault: ${fileId}`);
    return null;
  }

  const parsed = await parser.extractTextFromUrl(job.url);
  return { fp, parsed };
}


async function extractTextJob(job) {
  logger.info(`Extracting: ${job.metadata.label || job.url}`);

  const fileId = `${job.metadata.source}_${uid(job.url)}`;
  const extractResult = await checkVaultAndExtract(job, fileId);
  if (!extractResult) return;
  const { fp, parsed } = extractResult;

  let text = parsed.text;

  if (parsed.type === 'html' && parsed.$) {
    const $ = parsed.$;
    if (job.metadata.source === 'wisdomlib') {
      text = $("#scontent").text().trim() || $("article").text().trim() || $(".content-body").text().trim();
    } else if (job.metadata.source === 'sacred-texts') {
      text = $("body").text().trim();
      text = text.replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
    }
  }

  if (!text || text.length < 50) {
    throw new Error('Extracted text too short or empty');
  }

  const header = `=== ${job.metadata.label || 'Extracted Text'} ===\nSource: ${job.url}\nCategory: ${job.metadata.category}\nDate: ${new Date().toISOString()}\n${"=".repeat(40)}\n\n`;

  await fs.ensureDir(config.vaultDir);
  await fs.writeFile(fp, header + text, "utf8");

  await updateAnalysis((analysis) => {
    const existingNode = analysis.nodes.find(n => n.id === fileId);
    if (!existingNode) {
      analysis.nodes.push({
        id: fileId,
        label: job.metadata.label || `Doc ${fileId.substring(0, 4)}`,
        type: "text",
        category: job.metadata.category || "academic",
        vaultFile: `${fileId}.txt`,
        size: text.length,
        harvesterTag: true
      });
      analysis.stats.nodes = analysis.nodes.length;
    }
  });

  await pushToSemanticEngine(fileId, text, {
    label: job.metadata.label || `Doc ${fileId.substring(0, 4)}`,
    type: "text",
    category: job.metadata.category || "academic",
    source: job.url
  });

  logger.info(`✅ Extracted and saved: ${job.metadata.label} (${(text.length/1024).toFixed(1)} KB)`);
}

// Clear processed URLs (call periodically to prevent memory growth)
function clearProcessedUrls() {
  if (processedUrls.size > 10000) {
    // Keep last 5000
    const arr = [...processedUrls];
    processedUrls.clear();
    arr.slice(-5000).forEach(u => processedUrls.add(u));
    logger.debug(`Cleared processed URLs, kept ${processedUrls.size}`);
  }
}

setInterval(clearProcessedUrls, 60000);

module.exports = {
  initHarvester,
  startHarvester,
  stopHarvester,
  addJob,
  getHarvesterStatus
};