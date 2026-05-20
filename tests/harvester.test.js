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