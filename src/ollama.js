const crypto = require('crypto');
const fetch = require("node-fetch");
const config = require("./config");
const logger = require("./logger");

const OLLAMA_URL = config.ollama.host;
const DEFAULT_MODEL = config.ollama.model;
const TIMEOUT = config.ollama.timeout;

// ===============================
// PERFORMANCE OPTIMIZATIONS
// ===============================

// Response cache with TTL
const responseCache = new Map();
const CACHE_TTL = 1000 * 60 * 30; // 30 minutes
const MAX_CACHE_SIZE = 500;

// Request queue with concurrency limit
const requestQueue = [];
let activeRequests = 0;
const MAX_CONCURRENT = 3;

function getCacheKey(prompt, model) {
  return crypto.createHash('md5').update(`${model}:${prompt.slice(0, 200)}`).digest('hex');
}

function getCachedResponse(key) {
  const cached = responseCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    logger.debug('Cache hit for prompt');
    return cached.response;
  }
  responseCache.delete(key);
  return null;
}

function setCachedResponse(key, response) {
  // Prevent unbounded growth
  if (responseCache.size >= MAX_CACHE_SIZE) {
    // Remove oldest entry
    const firstKey = responseCache.keys().next().value;
    responseCache.delete(firstKey);
  }
  responseCache.set(key, { response, timestamp: Date.now() });
}

// Request queue processor
async function processQueue() {
  while (activeRequests < MAX_CONCURRENT && requestQueue.length > 0) {
    const { resolve, reject, prompt, model, system } = requestQueue.shift();
    activeRequests++;

    try {
      const result = await executeOllamaRequest(prompt, model, system);
      resolve(result);
    } catch (e) {
      reject(e);
    } finally {
      activeRequests--;
      // Process next in queue
      setImmediate(processQueue);
    }
  }
}

function queueRequest(prompt, model = DEFAULT_MODEL, system) {
  return new Promise((resolve, reject) => {
    requestQueue.push({ resolve, reject, prompt, model, system });
    processQueue();
  });
}

async function executeOllamaRequest(prompt, model, system) {
  const timeoutMs = Math.min(config.ollama.timeout, 120000); // Cap at 2 minutes

  const response = await Promise.race([
    fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        system: system || "You are a Vedic Guru and Sanskrit scholar. Provide deep, accurate, and spiritual commentary.",
        prompt,
        stream: false,
        options: {
          temperature: 0.7,
          top_p: 0.9,
        }
      }),
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Request timeout')), timeoutMs)
    ),
  ]);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Ollama error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  if (!data.response) {
    throw new Error('Empty response from Ollama');
  }

  return data.response;
}

// ===============================
// PUBLIC API
// ===============================

async function checkOllama() {
  try {
    const res = await Promise.race([
      fetch(`${OLLAMA_URL}/api/tags`),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), 10000)
      ),
    ]);

    if (res.ok) {
      const data = await res.json();
      return {
        online: true,
        models: data.models || [],
      };
    }

    return { online: false, error: `HTTP ${res.status}` };
  } catch (e) {
    logger.warn('Ollama health check failed', { error: e.message });
    return { online: false, error: e.message };
  }
}

async function getBestModel(preferredModel) {
  try {
    const status = await checkOllama();

    if (!status.online || !status.models || status.models.length === 0) {
      logger.warn('No Ollama models available, using default', { model: preferredModel });
      return preferredModel || DEFAULT_MODEL;
    }

    if (preferredModel) {
      const modelExists = status.models.find(m => m.name === preferredModel || m.name.startsWith(preferredModel + ':'));
      if (modelExists) {
        return modelExists.name;
      }
      logger.warn('Preferred model not found, using fallback', { preferred: preferredModel, fallback: status.models[0].name });
    }

    return status.models[0].name;
  } catch (e) {
    logger.error('Failed to get best model', { error: e.message });
    return preferredModel || DEFAULT_MODEL;
  }
}

async function askGuru(options) {
  try {
    let { prompt, model = DEFAULT_MODEL, system } = options;

    if (!prompt) {
      throw new Error('Prompt is required');
    }

    // Validate and fallback model if needed
    model = await getBestModel(model);

    logger.info(`[Ollama] Requesting insight from model: ${model}`);

    // Check cache first
    const cacheKey = getCacheKey(prompt, model);
    const cachedResponse = getCachedResponse(cacheKey);
    if (cachedResponse) {
      logger.debug('Returning cached response');
      return cachedResponse;
    }

    // Use queued requests for better concurrency
    const response = await queueRequest(prompt, model, system);

    // Cache the response
    setCachedResponse(cacheKey, response);

    logger.info(`Guru responded with ${response.length} characters`);
    return response;
  } catch (e) {
    logger.error('Guru query failed', { error: e.message });
    throw e;
  }
}

// Clear cache function (can be called externally)
function clearCache() {
  responseCache.clear();
  logger.info('Ollama response cache cleared');
}

module.exports = {
  checkOllama,
  askGuru,
  clearCache,
};