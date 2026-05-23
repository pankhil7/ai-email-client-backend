import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── Mock heavy dependencies so tests run without DB or credentials ──────────

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

vi.mock('../routes/auth.routes', () => ({
  default: express.Router(),
  tokenStore: new Map(),
  initTokenStore: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../routes/emails.routes', () => ({
  default: express.Router(),
  initAccounts: vi.fn().mockResolvedValue(undefined),
}));

// ── Minimal app for testing ──────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));
  return app;
}

describe('GET /health', () => {
  const app = buildApp();

  it('returns 200 with status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('returns a timestamp', async () => {
    const res = await request(app).get('/health');
    expect(res.body.timestamp).toBeDefined();
    expect(new Date(res.body.timestamp).toString()).not.toBe('Invalid Date');
  });
});
