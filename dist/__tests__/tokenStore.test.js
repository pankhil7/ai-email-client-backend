"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
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
vitest_1.vi.mock('googleapis', () => ({
    google: {
        auth: { OAuth2: vitest_1.vi.fn() },
        oauth2: vitest_1.vi.fn(),
    },
}));
(0, vitest_1.describe)('tokenStore', () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.resetModules();
    });
    (0, vitest_1.it)('starts empty before init', async () => {
        const { tokenStore } = await Promise.resolve().then(() => __importStar(require('../routes/auth.routes')));
        (0, vitest_1.expect)(tokenStore).toBeInstanceOf(Map);
    });
    (0, vitest_1.it)('stores and retrieves a token', async () => {
        const { tokenStore } = await Promise.resolve().then(() => __importStar(require('../routes/auth.routes')));
        tokenStore.set('gmail-test@test.com', {
            accessToken: 'abc123',
            refreshToken: 'refresh456',
            email: 'test@test.com',
        });
        const token = tokenStore.get('gmail-test@test.com');
        (0, vitest_1.expect)(token?.accessToken).toBe('abc123');
        (0, vitest_1.expect)(token?.email).toBe('test@test.com');
    });
    (0, vitest_1.it)('overwrites existing token on re-set', async () => {
        const { tokenStore } = await Promise.resolve().then(() => __importStar(require('../routes/auth.routes')));
        tokenStore.set('gmail-test@test.com', { accessToken: 'old', refreshToken: '', email: 'test@test.com' });
        tokenStore.set('gmail-test@test.com', { accessToken: 'new', refreshToken: '', email: 'test@test.com' });
        (0, vitest_1.expect)(tokenStore.get('gmail-test@test.com')?.accessToken).toBe('new');
    });
    (0, vitest_1.it)('deletes a token', async () => {
        const { tokenStore } = await Promise.resolve().then(() => __importStar(require('../routes/auth.routes')));
        tokenStore.set('gmail-x@x.com', { accessToken: 'tok', refreshToken: '', email: 'x@x.com' });
        tokenStore.delete('gmail-x@x.com');
        (0, vitest_1.expect)(tokenStore.get('gmail-x@x.com')).toBeUndefined();
    });
});
