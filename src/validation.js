const path = require('path');

/**
 * Sanitize file path to prevent directory traversal attacks
 */
function sanitizeFilePath(filePath, baseDir) {
  // Resolve the full path and ensure it's within baseDir
  const resolved = path.resolve(filePath);
  const base = path.resolve(baseDir);
  
  if (!resolved.startsWith(base)) {
    throw new Error('Path traversal attempt detected');
  }
  
  return resolved;
}

/**
 * Sanitize vault ID to prevent path traversal
 */
function sanitizeVaultId(id) {
  // Allow only alphanumeric, underscore, and hyphen
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error('Invalid vault ID format');
  }
  return id;
}

/**
 * Validate URL to prevent SSRF attacks
 */
function validateUrl(url) {
  try {
    const parsed = new URL(url);
    
    // Block localhost/private IPs for web scraping
    const hostname = parsed.hostname;
    const blockedPatterns = [
      /^localhost$/,
      /^127\./,
      /^0\.0\.0\.0$/,
      /^::1$/,
      /^10\./,
      /^172\.(1[6-9]|2[0-9]|3[01])\./,
      /^192\.168\./,
    ];
    
    for (const pattern of blockedPatterns) {
      if (pattern.test(hostname)) {
        throw new Error('SSRF attack: Cannot access internal networks');
      }
    }
    
    // Only allow http/https
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Only HTTP/HTTPS protocols allowed');
    }
    
    return url;
  } catch (e) {
    throw new Error(`Invalid URL: ${e.message}`);
  }
}

/**
 * Validate JSON data structure
 */
function validateAnalysisData(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid analysis data: must be an object');
  }
  
  if (!Array.isArray(data.nodes)) {
    throw new Error('Invalid analysis data: nodes must be an array');
  }
  
  if (!Array.isArray(data.edges)) {
    throw new Error('Invalid analysis data: edges must be an array');
  }
  
  // Validate and auto-fix each node
  data.nodes.forEach((node, i) => {
    if (!node.id || typeof node.id !== 'string') {
      throw new Error(`Invalid node at index ${i}: missing or invalid id`);
    }
    // Auto-default missing type instead of crashing on existing data
    if (!node.type || typeof node.type !== 'string') {
      node.type = 'text';
    }
  });
  
  return data;
}

/**
 * Validate search query
 */
function validateSearchQuery(query) {
  if (!query || typeof query !== 'string') {
    throw new Error('Query must be a non-empty string');
  }
  
  if (query.length > 1000) {
    throw new Error('Query too long (max 1000 characters)');
  }
  
  return query.trim();
}

/**
 * Validate prompt for guru queries
 */
function validatePrompt(prompt) {
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('Prompt must be a non-empty string');
  }
  
  if (prompt.length > 5000) {
    throw new Error('Prompt too long (max 5000 characters)');
  }
  
  return prompt.trim();
}

module.exports = {
  sanitizeFilePath,
  sanitizeVaultId,
  validateUrl,
  validateAnalysisData,
  validateSearchQuery,
  validatePrompt,
};
