const fs = require('fs-extra');
const path = require('path');
const config = require('./config');

const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const currentLogLevel = LOG_LEVELS[config.logging.level] || LOG_LEVELS.info;
const logFile = config.logging.file;
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB

// Ensure log directory exists
fs.ensureDirSync(path.dirname(logFile));

// ===============================
// PERFORMANCE OPTIMIZATIONS
// ===============================

// Circular buffer for in-memory logs (fixed size)
const MAX_MEMORY_LOGS = 100;
const logs = [];
let logIndex = 0;

function addLogToMemory(formatted) {
  logs[logIndex] = { message: formatted, time: new Date().toISOString() };
  logIndex = (logIndex + 1) % MAX_MEMORY_LOGS;
}

// Buffered file writes
let writeBuffer = [];
const FLUSH_INTERVAL = 1000; // 1 second

function flushBuffer() {
  if (writeBuffer.length === 0) return;

  const toWrite = writeBuffer.join('\n') + '\n';
  writeBuffer = [];

  fs.appendFile(logFile, toWrite).catch(e => {
    console.error('Failed to write to log file:', e.message);
  });
}

// Flush buffer periodically
setInterval(flushBuffer, FLUSH_INTERVAL).unref();

// Also flush on exit
process.on('beforeExit', flushBuffer);
process.on('SIGINT', flushBuffer);
process.on('SIGTERM', flushBuffer);

function formatLog(level, message, data = null) {
  const timestamp = new Date().toISOString();
  const dataStr = data ? ` ${JSON.stringify(data)}` : '';
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${dataStr}`;
}

function writeLog(level, message, data = null) {
  const formatted = formatLog(level, message, data);

  // Console output (async, non-blocking)
  if (LOG_LEVELS[level] <= currentLogLevel) {
    setImmediate(() => console.log(formatted));
  }

  // Buffered file output (non-blocking)
  writeBuffer.push(formatted);

  // Memory log (circular buffer, no growth)
  addLogToMemory(formatted);
}

// Log rotation check (less frequent - every 10 minutes)
const logRotator = setInterval(async () => {
  try {
    const stat = await fs.stat(logFile);
    if (stat.size > MAX_LOG_SIZE) {
      const rotated = logFile + '.old';
      await fs.move(logFile, rotated, { overwrite: true });
      writeLog('info', 'Log file rotated');
    }
  } catch (e) {
    // File may not exist yet
  }
}, 600000);

// ===============================
// PUBLIC API
// ===============================

function error(message, data = null) {
  writeLog('error', message, data);
}

function warn(message, data = null) {
  writeLog('warn', message, data);
}

function info(message, data = null) {
  writeLog('info', message, data);
}

function debug(message, data = null) {
  writeLog('debug', message, data);
}

function getLogs(limit = 30) {
  // Return most recent logs from circular buffer
  const result = [];
  const count = Math.min(limit, MAX_MEMORY_LOGS);

  for (let i = 0; i < count; i++) {
    const idx = (logIndex - count + i + MAX_MEMORY_LOGS) % MAX_MEMORY_LOGS;
    if (logs[idx]) {
      result.push(logs[idx]);
    }
  }

  return result;
}

module.exports = {
  error,
  warn,
  info,
  debug,
  getLogs,
  formatLog,
};