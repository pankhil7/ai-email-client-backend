"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const express_1 = __importDefault(require("express"));
const supertest_1 = __importDefault(require("supertest"));
// ── Mock heavy dependencies so tests run without DB or credentials ──────────
vitest_1.vi.mock('../db', () => ({
    default: {
        query: vitest_1.vi.fn().mockResolvedValue({ rows: [] }),
    },
    initDb: vitest_1.vi.fn().mockResolvedValue(undefined),
}));
vitest_1.vi.mock('../logger', () => ({
    default: {
        info: vitest_1.vi.fn(),
        warn: vitest_1.vi.fn(),
        error: vitest_1.vi.fn(),
        debug: vitest_1.vi.fn(),
    },
}));
vitest_1.vi.mock('../routes/auth.routes', () => ({
    default: express_1.default.Router(),
    tokenStore: new Map(),
    initTokenStore: vitest_1.vi.fn().mockResolvedValue(undefined),
}));
vitest_1.vi.mock('../routes/emails.routes', () => ({
    default: express_1.default.Router(),
    initAccounts: vitest_1.vi.fn().mockResolvedValue(undefined),
}));
// ── Minimal app for testing ──────────────────────────────────────────────────
function buildApp() {
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));
    return app;
}
(0, vitest_1.describe)('GET /health', () => {
    const app = buildApp();
    (0, vitest_1.it)('returns 200 with status ok', async () => {
        const res = await (0, supertest_1.default)(app).get('/health');
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.status).toBe('ok');
    });
    (0, vitest_1.it)('returns a timestamp', async () => {
        const res = await (0, supertest_1.default)(app).get('/health');
        (0, vitest_1.expect)(res.body.timestamp).toBeDefined();
        (0, vitest_1.expect)(new Date(res.body.timestamp).toString()).not.toBe('Invalid Date');
    });
});
