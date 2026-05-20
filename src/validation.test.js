const path = require('path');
const {
  sanitizeFilePath,
  sanitizeVaultId,
  validateUrl,
  validateAnalysisData,
  validateSearchQuery,
  validatePrompt,
} = require('./validation');

describe('validation.js', () => {
  describe('sanitizeFilePath', () => {
    it('should return resolved path if within baseDir', () => {
      const baseDir = '/var/www/app';
      const filePath = '/var/www/app/uploads/file.txt';
      const expected = path.resolve(filePath);
      expect(sanitizeFilePath(filePath, baseDir)).toBe(expected);
    });

    it('should throw an error for path traversal attempt (outside baseDir)', () => {
      const baseDir = '/var/www/app';
      const filePath = '/var/www/app/../etc/passwd';
      expect(() => sanitizeFilePath(filePath, baseDir)).toThrow('Path traversal attempt detected');
    });

    it('should throw an error for path traversal attempt with relative paths', () => {
      const baseDir = __dirname;
      const filePath = path.join(__dirname, '../../etc/passwd');
      expect(() => sanitizeFilePath(filePath, baseDir)).toThrow('Path traversal attempt detected');
    });

    it('should work with relative filePaths if they resolve within baseDir', () => {
      const baseDir = __dirname;
      const filePath = './somefile.txt';
      const expected = path.resolve(baseDir, filePath);
      expect(sanitizeFilePath(expected, baseDir)).toBe(expected);
    });
  });

  describe('sanitizeVaultId', () => {
    it('should return the vault ID if valid', () => {
      expect(sanitizeVaultId('valid_id-123')).toBe('valid_id-123');
    });

    it('should throw an error if the vault ID is invalid', () => {
      expect(() => sanitizeVaultId('invalid id')).toThrow('Invalid vault ID format');
      expect(() => sanitizeVaultId('invalid/id')).toThrow('Invalid vault ID format');
      expect(() => sanitizeVaultId('invalid.id')).toThrow('Invalid vault ID format');
    });
  });

  describe('validateUrl', () => {
    it('should return the URL if valid', () => {
      expect(validateUrl('https://example.com')).toBe('https://example.com');
      expect(validateUrl('http://example.com/path?query=1')).toBe('http://example.com/path?query=1');
    });

    it('should throw an error for non HTTP/HTTPS URLs', () => {
      expect(() => validateUrl('ftp://example.com')).toThrow('Only HTTP/HTTPS protocols allowed');
      expect(() => validateUrl('file:///etc/passwd')).toThrow('Only HTTP/HTTPS protocols allowed');
    });

    it('should throw an error for SSRF blocked IPs', () => {
      const blockedUrls = [
        'http://localhost',
        'http://127.0.0.1',
        'http://0.0.0.0',
        'http://[::1]',
        'http://10.0.0.1',
        'http://172.16.0.1',
        'http://172.31.255.255',
        'http://192.168.1.1'
      ];

      blockedUrls.forEach(url => {
        expect(() => validateUrl(url)).toThrow('SSRF attack: Cannot access internal networks');
      });
    });

    it('should throw an error for invalid URLs', () => {
      expect(() => validateUrl('not-a-url')).toThrow('Invalid URL: Invalid URL');
    });
  });

  describe('validateAnalysisData', () => {
    it('should return data for valid input', () => {
      const data = {
        nodes: [{ id: '1', type: 'custom' }],
        edges: []
      };
      expect(validateAnalysisData(data)).toEqual(data);
    });

    it('should default missing node type to text', () => {
      const data = {
        nodes: [{ id: '1' }],
        edges: []
      };
      const result = validateAnalysisData(data);
      expect(result.nodes[0].type).toBe('text');
    });

    it('should throw if data is not an object', () => {
      expect(() => validateAnalysisData(null)).toThrow('Invalid analysis data: must be an object');
      expect(() => validateAnalysisData('string')).toThrow('Invalid analysis data: must be an object');
    });

    it('should throw if nodes is not an array', () => {
      expect(() => validateAnalysisData({ edges: [] })).toThrow('Invalid analysis data: nodes must be an array');
    });

    it('should throw if edges is not an array', () => {
      expect(() => validateAnalysisData({ nodes: [] })).toThrow('Invalid analysis data: edges must be an array');
    });

    it('should throw if node is missing id or id is invalid', () => {
      expect(() => validateAnalysisData({ nodes: [{}], edges: [] })).toThrow('Invalid node at index 0: missing or invalid id');
      expect(() => validateAnalysisData({ nodes: [{ id: 1 }], edges: [] })).toThrow('Invalid node at index 0: missing or invalid id');
    });
  });

  describe('validateSearchQuery', () => {
    it('should return trimmed valid search query', () => {
      expect(validateSearchQuery('  my query  ')).toBe('my query');
    });

    it('should throw if query is empty or not a string', () => {
      expect(() => validateSearchQuery('')).toThrow('Query must be a non-empty string');
      expect(() => validateSearchQuery(null)).toThrow('Query must be a non-empty string');
      expect(() => validateSearchQuery(123)).toThrow('Query must be a non-empty string');
    });

    it('should throw if query is too long', () => {
      const longQuery = 'a'.repeat(1001);
      expect(() => validateSearchQuery(longQuery)).toThrow('Query too long (max 1000 characters)');
    });
  });

  describe('validatePrompt', () => {
    it('should return trimmed valid prompt', () => {
      expect(validatePrompt('  my prompt  ')).toBe('my prompt');
    });

    it('should throw if prompt is empty or not a string', () => {
      expect(() => validatePrompt('')).toThrow('Prompt must be a non-empty string');
      expect(() => validatePrompt(null)).toThrow('Prompt must be a non-empty string');
      expect(() => validatePrompt(123)).toThrow('Prompt must be a non-empty string');
    });

    it('should throw if prompt is too long', () => {
      const longPrompt = 'a'.repeat(5001);
      expect(() => validatePrompt(longPrompt)).toThrow('Prompt too long (max 5000 characters)');
    });
  });
});
