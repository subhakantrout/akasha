const path = require('path');
const dns = require('dns').promises;

/**
 * Check if an IP address is internal/private
 */
function isInternalIp(ipStr) {
  if (!ipStr) return false;

  if (/^127\./.test(ipStr)) return true;
  if (/^10\./.test(ipStr)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(ipStr)) return true;
  if (/^192\.168\./.test(ipStr)) return true;
  if (/^169\.254\./.test(ipStr)) return true; // Link local, AWS IMDS
  if (/^0\.0\.0\.0/.test(ipStr)) return true;
  if (ipStr === '::1') return true;
  if (/^[fF][cCdD]/.test(ipStr)) return true; // IPv6 unique local address
  if (/^[fF][eE][89aAbB]/.test(ipStr)) return true; // IPv6 link local address
  if (/^::[fF]{4}:/.test(ipStr)) return true; // IPv4-mapped IPv6 address (e.g., ::ffff:127.0.0.1)

  return false;
}

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
async function validateUrl(url) {
  try {
    const parsed = new URL(url);
    
    // Only allow http/https
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Only HTTP/HTTPS protocols allowed');
    }

    // Block localhost/private IPs for web scraping
    // hostname might have brackets if it's an IPv6 literal (e.g. [2001:db8::1])
    const hostname = parsed.hostname.replace(/^\[(.*)\]$/, '$1');
    const blockedPatterns = [
      /^localhost$/,
      /^127\./,
      /^0\.0\.0\.0$/,
      /^::1$/,
      /^10\./,
      /^172\.(1[6-9]|2[0-9]|3[01])\./,
      /^192\.168\./,
      /^169\.254\./
    ];
    
    for (const pattern of blockedPatterns) {
      if (pattern.test(hostname)) {
        throw new Error('SSRF attack: Cannot access internal networks');
      }
    }

    // Do DNS resolution to prevent DNS rebinding attacks
    let address;
    try {
      const result = await dns.lookup(hostname);
      address = result.address;
    } catch (e) {
      throw new Error(`DNS resolution failed for ${hostname}`);
    }
    
    if (isInternalIp(address)) {
      throw new Error('SSRF attack: Resolved to internal IP');
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
