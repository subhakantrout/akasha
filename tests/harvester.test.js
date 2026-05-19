const { normalizeUrl } = require('../src/harvester');

describe('normalizeUrl', () => {
  it('should remove query parameters correctly', () => {
    const url = 'https://example.com/page?utm_source=test&utm_medium=medium&utm_campaign=campaign&fbclid=abc&gclid=def&ref=ghi';
    const normalized = normalizeUrl(url);
    expect(normalized).toBe('https://example.com/page');
  });

  it('should retain non-targeted query parameters', () => {
    const url = 'https://example.com/page?utm_source=test&other=keep';
    const normalized = normalizeUrl(url);
    expect(normalized).toBe('https://example.com/page?other=keep');
  });

  it('should remove the hash portion of the URL', () => {
    const url = 'https://example.com/page#section1';
    const normalized = normalizeUrl(url);
    expect(normalized).toBe('https://example.com/page');
  });

  it('should handle URLs without query parameters or hash', () => {
    const url = 'https://example.com/page';
    const normalized = normalizeUrl(url);
    expect(normalized).toBe('https://example.com/page');
  });

  it('should return the original string if parsing fails', () => {
    const invalidUrl = 'invalid-url';
    const normalized = normalizeUrl(invalidUrl);
    expect(normalized).toBe('invalid-url');
  });

  it('should handle URL with trailing slash', () => {
     const url = 'https://example.com/';
     const normalized = normalizeUrl(url);
     expect(normalized).toBe('https://example.com/');
  });

  it('should handle multiple occurrences of the same parameter (though typically one, testing edge case)', () => {
    const url = 'https://example.com/page?utm_source=1&utm_source=2';
    const normalized = normalizeUrl(url);
    expect(normalized).toBe('https://example.com/page');
  });

  it('should work fine with ports', () => {
      const url = 'http://localhost:3000/page?utm_source=test#hash';
      const normalized = normalizeUrl(url);
      expect(normalized).toBe('http://localhost:3000/page');
  });
});

const { test, describe, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const { isDuplicateContent, textHashes } = require('../src/harvester');

describe('isDuplicateContent', () => {
  beforeEach(() => {
    textHashes.clear();
  });

  after(() => {
    // Force process exit to bypass the intervals in harvester.js
    // which keeps the event loop alive.
    setTimeout(() => process.exit(0), 10);
  });

  test('should return false for new content', () => {
    const isDup = isDuplicateContent('This is some new text');
    assert.strictEqual(isDup, false);
    assert.strictEqual(textHashes.size, 1);
  });

  test('should return true for duplicate content', () => {
    isDuplicateContent('This is the same text');
    const isDup = isDuplicateContent('This is the same text');
    assert.strictEqual(isDup, true);
    assert.strictEqual(textHashes.size, 1);
  });

  test('should bound memory to 2500 when exceeding 5000 items', () => {
    // Fill the set to 5000
    for (let i = 0; i < 5000; i++) {
      isDuplicateContent(`Unique text item number ${i}`);
    }
    assert.strictEqual(textHashes.size, 5000);

    // The 5001st item will trigger cleanup
    const triggerText = 'This is item 5001 that pushes it over the edge';
    const isDup = isDuplicateContent(triggerText);

    assert.strictEqual(isDup, false);
    assert.strictEqual(textHashes.size, 2500);

    // Verify the most recently added item is kept
    const isDupAgain = isDuplicateContent(triggerText);
    assert.strictEqual(isDupAgain, true);

    // Verify an older item is removed (e.g. item 0)
    const isOldDup = isDuplicateContent('Unique text item number 0');
    assert.strictEqual(isOldDup, false);
  });
});
