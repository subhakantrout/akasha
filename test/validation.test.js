const { test, describe } = require('node:test');
const assert = require('node:assert');
const { validateUrl } = require('../src/validation');

describe('validateUrl', () => {
  test('should allow valid http and https URLs', () => {
    assert.strictEqual(validateUrl('http://example.com'), 'http://example.com');
    assert.strictEqual(validateUrl('https://google.com'), 'https://google.com');
    assert.strictEqual(validateUrl('https://sub.domain.org/path?query=1'), 'https://sub.domain.org/path?query=1');
  });

  test('should block localhost and private IPs (SSRF prevention)', () => {
    const blockedUrls = [
      'http://localhost',
      'http://localhost:8080',
      'http://127.0.0.1',
      'http://127.0.0.1:3000',
      'http://0.0.0.0',
      'http://[::1]',
      'http://10.0.0.1',
      'http://10.255.255.255',
      'http://172.16.0.1',
      'http://172.31.255.255',
      'http://192.168.1.1',
      'http://192.168.0.255'
    ];

    for (const url of blockedUrls) {
      assert.throws(
        () => validateUrl(url),
        /SSRF attack: Cannot access internal networks/,
        `Should have blocked ${url}`
      );
    }
  });

  test('should reject non-HTTP/HTTPS protocols', () => {
    const invalidProtocols = [
      'ftp://example.com',
      'file:///etc/passwd',
      'data:text/plain;base64,SGVsbG8sIFdvcmxkIQ==',
      'gopher://gopher.example.com'
    ];

    for (const url of invalidProtocols) {
      assert.throws(
        () => validateUrl(url),
        /Only HTTP\/HTTPS protocols allowed/,
        `Should have blocked protocol in ${url}`
      );
    }
  });

  test('should reject invalid URL strings', () => {
    assert.throws(
      () => validateUrl('not-a-url'),
      /Invalid URL: Invalid URL/,
      'Should throw on invalid URL format'
    );

    assert.throws(
      () => validateUrl(''),
      /Invalid URL: Invalid URL/,
      'Should throw on empty string'
    );
  });
});
