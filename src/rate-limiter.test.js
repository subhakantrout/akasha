const rateLimiter = require('./rate-limiter');
const config = require('./config');

jest.mock('./config', () => ({
  rateLimit: {
    windowMs: 60000,
    maxRequests: 3
  }
}));

describe('rate-limiter', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2023-01-01T00:00:00Z'));
  });

  afterEach(() => {
    rateLimiter.resetKey('test-user');
    rateLimiter.resetKey('user2');
    rateLimiter.resetKey(); // global
  });

  afterAll(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('isRateLimited', () => {
    it('should allow requests within limit', () => {
      expect(rateLimiter.isRateLimited('test-user')).toBe(false);
      expect(rateLimiter.isRateLimited('test-user')).toBe(false);
      expect(rateLimiter.isRateLimited('test-user')).toBe(false);
    });

    it('should block requests exceeding limit', () => {
      expect(rateLimiter.isRateLimited('test-user')).toBe(false);
      expect(rateLimiter.isRateLimited('test-user')).toBe(false);
      expect(rateLimiter.isRateLimited('test-user')).toBe(false);
      expect(rateLimiter.isRateLimited('test-user')).toBe(true);
    });

    it('should allow requests again after window passes', () => {
      expect(rateLimiter.isRateLimited('test-user')).toBe(false);
      expect(rateLimiter.isRateLimited('test-user')).toBe(false);
      expect(rateLimiter.isRateLimited('test-user')).toBe(false);
      expect(rateLimiter.isRateLimited('test-user')).toBe(true);

      // Advance time by windowMs + 1
      jest.setSystemTime(new Date(Date.now() + 60001));
      jest.advanceTimersByTime(60001);

      expect(rateLimiter.isRateLimited('test-user')).toBe(false);
    });

    it('should track different keys independently', () => {
      expect(rateLimiter.isRateLimited('test-user')).toBe(false);
      expect(rateLimiter.isRateLimited('test-user')).toBe(false);
      expect(rateLimiter.isRateLimited('test-user')).toBe(false);
      expect(rateLimiter.isRateLimited('test-user')).toBe(true);

      expect(rateLimiter.isRateLimited('user2')).toBe(false);
    });

    it('should fall back to global key if no identifier provided', () => {
      expect(rateLimiter.isRateLimited()).toBe(false);
      expect(rateLimiter.isRateLimited()).toBe(false);
      expect(rateLimiter.isRateLimited()).toBe(false);
      expect(rateLimiter.isRateLimited()).toBe(true);
    });
  });

  describe('getRateLimitStatus', () => {
    it('should return correct status for new key', () => {
      const status = rateLimiter.getRateLimitStatus('new-user');
      expect(status.remaining).toBe(3);
      expect(status.resetAt).toBe(Date.now() + 60000);
    });

    it('should return correct status after some requests', () => {
      rateLimiter.isRateLimited('test-user');
      const status = rateLimiter.getRateLimitStatus('test-user');
      expect(status.remaining).toBe(2);
      expect(status.resetAt).toBe(Date.now() + 60000);
    });

    it('should return correct status when limited', () => {
      rateLimiter.isRateLimited('test-user');
      rateLimiter.isRateLimited('test-user');
      rateLimiter.isRateLimited('test-user');
      const status = rateLimiter.getRateLimitStatus('test-user');
      expect(status.remaining).toBe(0);
      expect(status.resetAt).toBe(Date.now() + 60000);
    });
  });

  describe('resetKey', () => {
    it('should reset rate limit for a specific key', () => {
      rateLimiter.isRateLimited('test-user');
      rateLimiter.isRateLimited('test-user');
      rateLimiter.isRateLimited('test-user');
      expect(rateLimiter.isRateLimited('test-user')).toBe(true);

      rateLimiter.resetKey('test-user');

      expect(rateLimiter.isRateLimited('test-user')).toBe(false);
    });
  });

  describe('setInterval pruning', () => {
    it('should remove expired keys after interval', () => {
      // isRateLimited pushes a request timestamp
      rateLimiter.isRateLimited('test-user');
      expect(rateLimiter.getRateLimitStatus('test-user').remaining).toBe(2);

      // The module requires isolating module loading so jest intercepts the initial setInterval call
      // Alternatively, we can isolate just the pruning test:

      // Let's create an isolated instance of the module for this test
      jest.isolateModules(() => {
        const isolatedRateLimiter = require('./rate-limiter');
        isolatedRateLimiter.isRateLimited('test-user-isolated');
        expect(isolatedRateLimiter.getRateLimitStatus('test-user-isolated').remaining).toBe(2);

        // Advance the timer by 300000 to ensure interval is hit
        // We also need to advance the system time to make sure Date.now() in the
        // interval handler evaluates the request as expired
        const now = Date.now();
        jest.setSystemTime(now + 300000);
        jest.advanceTimersByTime(300000);

        expect(isolatedRateLimiter.getRateLimitStatus('test-user-isolated').remaining).toBe(3);
      });
    });
  });
});
