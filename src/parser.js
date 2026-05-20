const fetch = require('node-fetch');
const cheerio = require('cheerio');
const officeParser = require('officeparser');
const Tesseract = require('tesseract.js');
const Epub = require('epub2').EPub;
const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const logger = require('./logger');

// ===============================
// LRU CACHE FOR PARSER
// ===============================

class LRUCache {
  constructor(maxSize = 200) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }

  get(key) {
    if (!this.cache.has(key)) return null;

    // Move to end (most recently used)
    const value = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key, value) {
    // Remove oldest if at capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    this.cache.set(key, value);
  }

  clear() {
    this.cache.clear();
  }
}

// Create cache instance
const parseCache = new LRUCache(200);

// Cache TTL - 30 minutes
const CACHE_TTL = 30 * 60 * 1000;
const cacheTimestamps = new Map();

function getCachedResult(url) {
  const normalized = url.split('?')[0]; // Ignore query params
  const cached = parseCache.get(normalized);

  if (cached) {
    const timestamp = cacheTimestamps.get(normalized);
    if (timestamp && Date.now() - timestamp < CACHE_TTL) {
      logger.debug(`Cache hit for: ${normalized.slice(0, 40)}`);
      return cached;
    }
  }

  return null;
}

function setCachedResult(url, result) {
  const normalized = url.split('?')[0];
  parseCache.set(normalized, result);
  cacheTimestamps.set(normalized, Date.now());
}

// Clear old cache entries periodically
function cleanupCache() {
  const now = Date.now();
  for (const [key, timestamp] of cacheTimestamps) {
    if (now - timestamp > CACHE_TTL) {
      parseCache.cache.delete(key);
      cacheTimestamps.delete(key);
    }
  }
}

setInterval(cleanupCache, 5 * 60 * 1000); // Every 5 minutes

// ===============================
// PARSER ENGINE
// ===============================

/**
 * Universal text extractor with LRU caching
 */
async function extractTextFromUrl(url, timeout = 60000) {
  // Check cache first
  const cached = getCachedResult(url);
  if (cached) {
    return cached;
  }

  try {
    const response = await Promise.race([
      fetch(url, {
        headers: { 'User-Agent': 'AkashaHarvester/4.0 (Universal Data Engine)' }
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Request timeout')), timeout)
      )
    ]);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    const urlLower = url.toLowerCase();

    logger.info(`🔍 Parsing data stream of type: ${contentType || 'unknown'}`);

    let result;

    // JSON
    if (contentType.includes('application/json') || urlLower.endsWith('.json')) {
      const json = await response.json();
      result = {
        text: JSON.stringify(json, null, 2),
        type: 'json',
        isDocument: true,
        rawJson: json
      };
    }
    // OCR for IMAGES
    else if (contentType.includes('image/') || urlLower.match(/\.(jpeg|jpg|png|gif|bmp|tiff|webp)$/i)) {
      logger.info(`👁️ Running Tesseract OCR on image: ${url}`);
      const buffer = await response.buffer();
      const ocrResult = await Tesseract.recognize(buffer, 'eng+san+hin', {
        logger: m => {}
      });
      result = {
        text: ocrResult.data.text.trim(),
        type: 'image',
        isDocument: true
      };
    }
    // EPUB
    else if (contentType.includes('epub') || urlLower.endsWith('.epub')) {
      logger.info(`📚 Parsing EPUB document: ${url}`);
      result = await parseEpub(url, response);
    }
    // OFFICE FILES & PDFS
    else if (isOfficeFile(contentType, urlLower)) {
      logger.info(`📄 Parsing Office/PDF document: ${url}`);
      result = await parseOfficeFile(url, response);
    }
    // TEXT/HTML/XML
    else {
      result = await parseTextOrHtml(url, response, contentType, urlLower);
    }

    // Cache the result
    if (result && result.text && result.text.length > 100) {
      setCachedResult(url, result);
    }

    return result;

  } catch (e) {
    logger.error('Failed to extract text from URL', { error: e.message, url });
    throw e;
  }
}

// Helper functions

function isOfficeFile(contentType, urlLower) {
  return contentType.includes('wordprocessingml') ||
         contentType.includes('spreadsheetml') ||
         contentType.includes('presentationml') ||
         contentType.includes('application/pdf') ||
         contentType.includes('opendocument') ||
         urlLower.match(/\.(docx|pptx|xlsx|odt|odp|ods|pdf)$/i);
}

async function parseEpub(url, response) {
  const buffer = await response.buffer();
  const tmpPath = path.join(__dirname, `../data/temp_${crypto.randomBytes(4).toString('hex')}.epub`);
  await fs.writeFile(tmpPath, buffer);

  const text = await new Promise((resolve, reject) => {
    const epub = new Epub(tmpPath);
    let fullText = '';
    let chaptersProcessed = 0;
    const totalChapters = epub.flow.length;

    if (totalChapters === 0) {
      resolve('');
      return;
    }

    epub.flow.forEach(chapter => {
      epub.getChapter(chapter.id, (err, txt) => {
        if (!err && txt) {
          const $ = cheerio.load(txt);
          fullText += $('body').text().trim() + '\n\n';
        }
        chaptersProcessed++;
        if (chaptersProcessed === totalChapters) {
          resolve(fullText.trim());
        }
      });
    });

    epub.on('error', reject);
    epub.parse();
  });

  await fs.remove(tmpPath);
  return { text, type: 'epub', isDocument: true };
}

async function parseOfficeFile(url, response) {
  const buffer = await response.buffer();
  const tmpPath = path.join(__dirname, `../data/temp_${crypto.randomBytes(4).toString('hex')}`);
  await fs.writeFile(tmpPath, buffer);

  const text = await officeParser.parseOfficeAsync(tmpPath);
  await fs.remove(tmpPath);

  return {
    text: text.trim(),
    type: 'office/pdf',
    isDocument: true
  };
}

async function parseTextOrHtml(url, response, contentType, urlLower) {
  let text = await response.text();

  // Clean HTML
  if (contentType.includes('html') || urlLower.endsWith('.html') || urlLower.endsWith('.htm')) {
    const $ = cheerio.load(text);
    $("script, style, nav, header, footer, .navbar, .sidebar, #menu, .ads, .breadcrumb, form, button, .footer, .header, noscript").remove();

    if (urlLower.includes('wisdomlib.org')) {
      text = $("#scontent").text().trim() || $("article").text().trim() || $(".content-body").text().trim();
    } else if (urlLower.includes('sacred-texts.com')) {
      text = $("body").text().trim();
    } else {
      text = $("article").text().trim() || $(".content-body").text().trim() || $(".post-content").text().trim() || $("main").text().trim() || $("body").text().trim();
    }

    const title = $("title").text().trim() || $("h1").first().text().trim() || "Untitled Knowledge";
    text = text.replace(/\n{2,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();

    return {
      text,
      title,
      type: 'html',
      isDocument: false,
      $: $
    };
  }

  // Plain text
  const lines = text.trim().split('\n');
  const title = lines[0].substring(0, 80).trim() || path.basename(url);

  return {
    text: text.trim(),
    title,
    type: 'text/xml/csv',
    isDocument: true
  };
}

// Cache stats for monitoring
function getCacheStats() {
  return {
    size: parseCache.cache.size,
    maxSize: parseCache.maxSize,
    ttl: CACHE_TTL
  };
}

// Clear cache manually
function clearCache() {
  parseCache.clear();
  cacheTimestamps.clear();
  logger.info('Parser cache cleared');
}

module.exports = {
  extractTextFromUrl,
  getCacheStats,
  clearCache
};