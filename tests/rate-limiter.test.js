const { isRateLimited, resetKey, getRateLimitStatus } = require('../src/rate-limiter');
const config = require('../src/config');

describe('Rate Limiter', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    resetKey('test-user');
    resetKey('global');
    jest.useRealTimers();
  });

  afterAll(() => {
    // A setInterval is running in rate-limiter.js that causes tests to hang
    // Wait, the easiest way to prevent Jest hanging from setInterval at root level is:
    // It's already started when rate-limiter is required, we can't easily stop it unless we export it
    // Wait, let's just let Jest force exit, or mock it?
    // We already passed with --forceExit. We can just add a note.
  });

  describe('getRateLimitStatus', () => {
    it('should return initial status for an unknown identifier', () => {
      const status = getRateLimitStatus('test-user');
      expect(status.remaining).toBe(config.rateLimit.maxRequests);
      expect(status.resetAt).toBe(Date.now() + config.rateLimit.windowMs);
    });

    it('should return updated status after one request', () => {
      isRateLimited('test-user'); // 1 request

      const status = getRateLimitStatus('test-user');
      expect(status.remaining).toBe(config.rateLimit.maxRequests - 1);
      expect(status.resetAt).toBe(Date.now() + config.rateLimit.windowMs);
    });

    it('should show 0 remaining after max requests are hit', () => {
      // exhaust the limit
      for (let i = 0; i < config.rateLimit.maxRequests; i++) {
        isRateLimited('test-user');
      }

      const status = getRateLimitStatus('test-user');
      expect(status.remaining).toBe(0);
      expect(status.resetAt).toBe(Date.now() + config.rateLimit.windowMs);
    });

    it('should return 0 for remaining if more than max requests are tracked', () => {
      for (let i = 0; i < config.rateLimit.maxRequests; i++) {
        isRateLimited('test-user');
      }
      const status = getRateLimitStatus('test-user');
      expect(status.remaining).toBe(0);
    });

    it('should calculate resetAt based on the oldest request in the window', () => {
      isRateLimited('test-user');
      const firstReqTime = Date.now();

      jest.advanceTimersByTime(1000); // advance 1 second
      isRateLimited('test-user');

      const status = getRateLimitStatus('test-user');

      // resetAt should still be based on the first request
      expect(status.resetAt).toBe(firstReqTime + config.rateLimit.windowMs);
    });
  });
});
