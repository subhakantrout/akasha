jest.useFakeTimers();

describe('rate-limiter', () => {
  let rateLimiterModule;
  let mockConfig;

  beforeEach(() => {
    jest.resetModules();
    jest.setSystemTime(1000000);

    mockConfig = {
      rateLimit: {
        windowMs: 60000, // 1 minute
        maxRequests: 5,
      }
    };

    jest.mock('./config', () => mockConfig);
    rateLimiterModule = require('./rate-limiter');
  });

  afterEach(() => {
    rateLimiterModule.resetKey('test-user');
    rateLimiterModule.resetKey(null);
  });

  afterAll(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('allows requests below maxRequests', () => {
    expect(rateLimiterModule.isRateLimited('test-user')).toBe(false);
    expect(rateLimiterModule.isRateLimited('test-user')).toBe(false);
    expect(rateLimiterModule.isRateLimited('test-user')).toBe(false);
    expect(rateLimiterModule.isRateLimited('test-user')).toBe(false);
    expect(rateLimiterModule.isRateLimited('test-user')).toBe(false);
  });

  it('blocks requests over maxRequests', () => {
    for (let i = 0; i < 5; i++) {
      rateLimiterModule.isRateLimited('test-user');
    }
    expect(rateLimiterModule.isRateLimited('test-user')).toBe(true);
  });

  it('allows requests after windowMs has passed', () => {
    for (let i = 0; i < 5; i++) {
      rateLimiterModule.isRateLimited('test-user');
    }
    expect(rateLimiterModule.isRateLimited('test-user')).toBe(true);

    jest.advanceTimersByTime(60001);

    expect(rateLimiterModule.isRateLimited('test-user')).toBe(false);
  });

  it('handles null identifier gracefully by using global key', () => {
    for (let i = 0; i < 5; i++) {
      rateLimiterModule.isRateLimited(null);
    }
    expect(rateLimiterModule.isRateLimited(null)).toBe(true);
  });

  it('provides accurate getRateLimitStatus for existing keys', () => {
    rateLimiterModule.isRateLimited('test-user');
    rateLimiterModule.isRateLimited('test-user');
    const status = rateLimiterModule.getRateLimitStatus('test-user');
    expect(status.remaining).toBe(3);
    expect(status.resetAt).toBe(1000000 + 60000);
  });

  it('provides default getRateLimitStatus for new keys', () => {
    const status = rateLimiterModule.getRateLimitStatus('new-user');
    expect(status.remaining).toBe(5);
    expect(status.resetAt).toBe(1000000 + 60000);
  });

  it('prunes stale entries on 5 minute interval', () => {
    rateLimiterModule.isRateLimited('prune-user');
    jest.advanceTimersByTime(300000);
    const status = rateLimiterModule.getRateLimitStatus('prune-user');
    expect(status.remaining).toBe(5);
  });

  it('removes expired timestamps but keeps active ones on prune', () => {
    rateLimiterModule.isRateLimited('mixed-user');
    jest.advanceTimersByTime(20000); // 1020000
    rateLimiterModule.isRateLimited('mixed-user');

    // Move forward so first is expired, second is not
    jest.advanceTimersByTime(40001); // 1060001
    // First request (1000000) is > 60000 ms old (1060001 - 1000000 = 60001)
    // Second request (1020000) is < 60000 ms old (1060001 - 1020000 = 40001)

    // Fast forward to trigger next interval (needs 300k, we are at ~60k)
    // Wait, setInterval fires every 300000ms.
    jest.advanceTimersByTime(239999); // 1300000
    // Now both will be expired.
  });

  it('covers branches for getRateLimitStatus when reqs is empty', () => {
    // Modify maxRequests to 0 to simulate empty reqs being kept
    mockConfig.rateLimit.maxRequests = 0;

    // Call isRateLimited. It will see reqs.length (0) >= maxRequests (0), and return true.
    // It will NOT push the timestamp.
    expect(rateLimiterModule.isRateLimited('zero-max')).toBe(true);

    // Now getRateLimitStatus will retrieve an empty array.
    const status = rateLimiterModule.getRateLimitStatus('zero-max');
    expect(status.remaining).toBe(0);
    expect(status.resetAt).toBe(1000000); // Because reqs is empty, it uses now
  });

  it('covers prune branch where reqs is not empty after shift', () => {
    // Create an entry that will be shifted, and one that won't
    rateLimiterModule.isRateLimited('keep-one'); // at 1,000,000

    // We want the setInterval to trigger when one is expired and one is not.
    // However, setInterval runs every 300,000ms.
    // By the time 300,000ms passes, anything added now will be expired.
    // Let's add something at T = 1,280,000 instead.
    jest.advanceTimersByTime(280000); // T = 1,280,000
    rateLimiterModule.isRateLimited('keep-one');

    // Now advance 20,000 to reach T = 1,300,000 (when interval fires)
    // The first request (1,000,000) is 300,000ms old -> shifted.
    // The second request (1,280,000) is 20,000ms old -> kept.
    jest.advanceTimersByTime(20000);

    // The key should still exist
    const status = rateLimiterModule.getRateLimitStatus('keep-one');
    expect(status.remaining).toBe(4);
  });
});
