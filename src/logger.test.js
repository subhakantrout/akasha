const test = require('node:test');
const assert = require('node:assert');
const { formatLog } = require('./logger');

test('formatLog', async (t) => {
  // Mock Date to ensure deterministic timestamps
  const fixedDate = new Date('2023-10-27T10:00:00.000Z');
  const originalDate = global.Date;

  global.Date = class extends originalDate {
    constructor(...args) {
      if (args.length === 0) {
        super();
        return fixedDate;
      }
      return new originalDate(...args);
    }
  };
  global.Date.now = () => fixedDate.getTime();

  await t.test('formats info level without data', () => {
    const result = formatLog('info', 'System started');
    assert.strictEqual(result, '[2023-10-27T10:00:00.000Z] [INFO] System started');
  });

  await t.test('formats error level with data', () => {
    const result = formatLog('error', 'Connection failed', { code: 500 });
    assert.strictEqual(result, '[2023-10-27T10:00:00.000Z] [ERROR] Connection failed {"code":500}');
  });

  await t.test('formats debug level with null data explicitly passed', () => {
    const result = formatLog('debug', 'Checking status', null);
    assert.strictEqual(result, '[2023-10-27T10:00:00.000Z] [DEBUG] Checking status');
  });

  await t.test('formats warn level with complex data', () => {
    const result = formatLog('warn', 'Retrying request', { attempt: 3, delay: 1000 });
    assert.strictEqual(result, '[2023-10-27T10:00:00.000Z] [WARN] Retrying request {"attempt":3,"delay":1000}');
  });

  // Restore original Date
  global.Date = originalDate;
}).then(() => {
  // Exit explicitly because logger.js starts some setIntervals
  setTimeout(() => process.exit(0), 10);
});
