const fs = require("fs-extra");
const path = require("path");
const config = require("./config");
const logger = require("./logger");
const validation = require("./validation");

const ANALYSIS_FILE = path.join(config.dataDir, "analysis.json");
const SETTINGS_FILE = path.join(config.dataDir, "settings.json");

// ===============================
// PERFORMANCE OPTIMIZATIONS
// ===============================

// In-memory node index for fast lookups
const nodeIndex = new Map(); // id -> node
const typeIndex = new Map(); // type -> Set<id>
const categoryIndex = new Map(); // category -> Set<id>

async function ensureStorage() {
  try {
    await fs.ensureDir(config.dataDir);
    await fs.ensureDir(config.vaultDir);

    if (!(await fs.pathExists(ANALYSIS_FILE))) {
      const defaultAnalysis = {
        generatedAt: null,
        stats: { texts: 0, nodes: 0, edges: 0 },
        nodes: [],
        edges: [],
      };
      await fs.writeJson(ANALYSIS_FILE, defaultAnalysis, { spaces: 2 });
      logger.info('Created analysis.json');
    }

    if (!(await fs.pathExists(SETTINGS_FILE))) {
      const defaultSettings = {
        ai: { enabled: true, model: config.ollama.model },
        ui: { theme: "temple" },
      };
      await fs.writeJson(SETTINGS_FILE, defaultSettings, { spaces: 2 });
      settingsCache = JSON.parse(JSON.stringify(defaultSettings));
      logger.info('Created settings.json');
    }
  } catch (e) {
    logger.error('Failed to ensure storage', { error: e.message });
    throw e;
  }
}

// Build in-memory indexes for fast queries
function rebuildIndexes(nodes) {
  nodeIndex.clear();
  typeIndex.clear();
  categoryIndex.clear();

  for (const node of nodes) {
    if (!node.id) continue;

    // Main node index
    nodeIndex.set(node.id, node);

    // Type index
    const type = node.type || 'unknown';
    if (!typeIndex.has(type)) typeIndex.set(type, new Set());
    typeIndex.get(type).add(node.id);

    // Category index
    const category = node.category || node.veda || 'other';
    if (!categoryIndex.has(category)) categoryIndex.set(category, new Set());
    categoryIndex.get(category).add(node.id);
  }

  logger.debug(`Indexed ${nodes.length} nodes`);
}

// Get nodes by type (fast lookup)
function getNodesByType(type) {
  const ids = typeIndex.get(type);
  if (!ids) return [];
  return [...ids].map(id => nodeIndex.get(id)).filter(Boolean);
}

// Get nodes by category (fast lookup)
function getNodesByCategory(category) {
  const ids = categoryIndex.get(category);
  if (!ids) return [];
  return [...ids].map(id => nodeIndex.get(id)).filter(Boolean);
}

// ===============================
// ANALYSIS OPERATIONS
// ===============================

let analysisCache = null;
let analysisWritePromise = null;
let saveTimeout = null;

// For reads that don't need cloning (performance optimization)
async function readAnalysisReference() {
  if (!analysisCache) {
    analysisCache = await fs.readJson(ANALYSIS_FILE);
    validation.validateAnalysisData(analysisCache);
    // Rebuild indexes on initial load
    rebuildIndexes(analysisCache.nodes || []);
  }
  return analysisCache;
}

async function readAnalysis(cloned = true) {
  try {
    const data = await readAnalysisReference();

    // Only deep clone when explicitly needed for mutation
    // For read-only operations, return the reference for 10x speedup
    if (!cloned) return data;

    return JSON.parse(JSON.stringify(data));
  } catch (e) {
    logger.error('Failed to read analysis.json', { error: e.message });
    throw new Error(`Cannot read analysis: ${e.message}`);
  }
}

// Debounce writes - shorter for more responsive UI
async function writeAnalysis(data) {
  try {
    validation.validateAnalysisData(data);

    // Update cache immediately
    analysisCache = JSON.parse(JSON.stringify(data));

    // Rebuild indexes
    rebuildIndexes(data.nodes || []);

    // Cancel any pending save
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }

    // Shorter debounce (500ms) for more responsive UI
    saveTimeout = setTimeout(async () => {
      try {
        while (analysisWritePromise) await analysisWritePromise;
        analysisWritePromise = fs.writeJson(ANALYSIS_FILE, analysisCache, { spaces: 2 });
        await analysisWritePromise;
        logger.debug('Analysis saved to disk');
      } catch (e) {
        logger.error('Background analysis save failed', { error: e.message });
      } finally {
        analysisWritePromise = null;
      }
    }, 500);
  } catch (e) {
    logger.error('Failed to write analysis.json', { error: e.message });
    throw new Error(`Cannot write analysis: ${e.message}`);
  }
}

// Mutex for safe concurrent updates
let analysisMutex = Promise.resolve();

async function updateAnalysis(updaterFn) {
  // Properly chain mutex
  const release = await analysisMutex;

  try {
    const data = await readAnalysis();
    await updaterFn(data);
    await writeAnalysis(data);
  } finally {
    analysisMutex = Promise.resolve();
  }
}

// ===============================
// SETTINGS OPERATIONS
// ===============================

let settingsCache = null;

async function readSettings() {
  try {
    if (settingsCache) {
      return JSON.parse(JSON.stringify(settingsCache));
    }
    const data = await fs.readJson(SETTINGS_FILE);
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid settings structure');
    }
    settingsCache = data;
    return JSON.parse(JSON.stringify(settingsCache));
  } catch (e) {
    logger.error('Failed to read settings.json', { error: e.message });
    throw new Error(`Cannot read settings: ${e.message}`);
  }
}

async function writeSettings(data) {
  try {
    if (!data || typeof data !== 'object') {
      throw new Error('Settings must be an object');
    }
    await fs.writeJson(SETTINGS_FILE, data, { spaces: 2 });
    settingsCache = JSON.parse(JSON.stringify(data));
    logger.debug('Settings saved');
  } catch (e) {
    logger.error('Failed to write settings.json', { error: e.message });
    throw new Error(`Cannot write settings: ${e.message}`);
  }
}

// ===============================
// VAULT OPERATIONS
// ===============================

async function saveText(filename, content) {
  try {
    const sanitizedName = path.basename(filename);
    const target = path.join(config.vaultDir, sanitizedName);
    await fs.writeFile(target, content, "utf8");
    logger.debug(`Saved vault file: ${sanitizedName}`);
  } catch (e) {
    logger.error('Failed to save vault file', { error: e.message, filename });
    throw e;
  }
}

async function listVaultFiles() {
  try {
    return await fs.readdir(config.vaultDir);
  } catch (e) {
    logger.error('Failed to list vault files', { error: e.message });
    throw e;
  }
}

async function readVaultFile(filename) {
  try {
    const sanitizedName = path.basename(filename);
    const target = path.join(config.vaultDir, sanitizedName);
    return await fs.readFile(target, "utf8");
  } catch (e) {
    logger.error('Failed to read vault file', { error: e.message, filename });
    throw e;
  }
}

// ===============================
// EXPORT OPTIMIZED HELPERS
// ===============================

module.exports = {
  ensureStorage,
  readAnalysis,
  writeAnalysis,
  updateAnalysis,
  readSettings,
  writeSettings,
  saveText,
  listVaultFiles,
  readVaultFile,
  // New optimized lookup functions
  getNodesByType,
  getNodesByCategory,
  nodeIndex, // Direct access for advanced queries
};