const config = require('./config');

// Simple in-memory rate limiter
const requests = new Map();

function getKey(identifier) {
  return identifier || 'global';
}

function _cleanRequests(reqs, now, windowMs) {
  while (reqs.length > 0 && reqs[0] < now - windowMs) {
    reqs.shift();
  }
}

function isRateLimited(identifier) {
  const key = getKey(identifier);
  const now = Date.now();
  const limit = config.rateLimit;
  
  if (!requests.has(key)) {
    requests.set(key, []);
  }
  
  const reqs = requests.get(key);
  
  // Remove old requests outside window
  _cleanRequests(reqs, now, limit.windowMs);
  
  if (reqs.length >= limit.maxRequests) {
    return true;
  }
  
  reqs.push(now);
  return false;
}

function resetKey(identifier) {
  const key = getKey(identifier);
  requests.delete(key);
}

function getRateLimitStatus(identifier) {
  const key = getKey(identifier);
  const now = Date.now();
  const limit = config.rateLimit;
  
  if (!requests.has(key)) {
    return {
      remaining: limit.maxRequests,
      resetAt: now + limit.windowMs,
    };
  }
  
  const reqs = requests.get(key);
  _cleanRequests(reqs, now, limit.windowMs);

  const remaining = Math.max(0, limit.maxRequests - reqs.length);
  const resetAt = reqs.length > 0 ? reqs[0] + limit.windowMs : now;
  
  return { remaining, resetAt };
}

// Prune stale entries every 5 minutes to prevent memory leak
const intervalId = setInterval(() => {
  const now = Date.now();
  const windowMs = config.rateLimit.windowMs;
  
  for (const [key, reqs] of requests.entries()) {
    // Remove expired timestamps
    _cleanRequests(reqs, now, windowMs);

    // Delete key entirely if no active requests
    if (reqs.length === 0) {
      requests.delete(key);
    }
  }
}, 300000);

// Prevent the interval from keeping the Node process alive
if (intervalId.unref) {
  intervalId.unref();
}

module.exports = {
  isRateLimited,
  resetKey,
  getRateLimitStatus,
};
