import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../db', () => ({
  default: {
    query: vi.fn().mockResolvedValue({ rows: [] }),
  },
  initDb: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('googleapis', () => ({
  google: {
    auth: { OAuth2: vi.fn() },
    oauth2: vi.fn(),
  },
}));

describe('tokenStore', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('starts empty before init', async () => {
    const { tokenStore } = await import('../routes/auth.routes');
    expect(tokenStore).toBeInstanceOf(Map);
  });

  it('stores and retrieves a token', async () => {
    const { tokenStore } = await import('../routes/auth.routes');
    tokenStore.set('gmail-test@test.com', {
      accessToken: 'abc123',
      refreshToken: 'refresh456',
      email: 'test@test.com',
    });
    const token = tokenStore.get('gmail-test@test.com');
    expect(token?.accessToken).toBe('abc123');
    expect(token?.email).toBe('test@test.com');
  });

  it('overwrites existing token on re-set', async () => {
    const { tokenStore } = await import('../routes/auth.routes');
    tokenStore.set('gmail-test@test.com', { accessToken: 'old', refreshToken: '', email: 'test@test.com' });
    tokenStore.set('gmail-test@test.com', { accessToken: 'new', refreshToken: '', email: 'test@test.com' });
    expect(tokenStore.get('gmail-test@test.com')?.accessToken).toBe('new');
  });

  it('deletes a token', async () => {
    const { tokenStore } = await import('../routes/auth.routes');
    tokenStore.set('gmail-x@x.com', { accessToken: 'tok', refreshToken: '', email: 'x@x.com' });
    tokenStore.delete('gmail-x@x.com');
    expect(tokenStore.get('gmail-x@x.com')).toBeUndefined();
  });
});
