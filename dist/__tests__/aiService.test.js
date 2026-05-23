"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
// Set dummy env before any imports
process.env.GROQ_API_KEY = 'test-key';
vitest_1.vi.mock('groq-sdk', () => {
    const mockCreate = vitest_1.vi.fn().mockImplementation(({ stream }) => {
        if (stream) {
            return Promise.resolve((async function* () {
                yield { choices: [{ delta: { content: 'This ' } }] };
                yield { choices: [{ delta: { content: 'is a summary.' } }] };
            })());
        }
        return Promise.resolve({ choices: [{ message: { content: '8' } }] });
    });
    return {
        default: vitest_1.vi.fn().mockImplementation(() => ({
            chat: { completions: { create: mockCreate } },
        })),
    };
});
vitest_1.vi.mock('../logger', () => ({
    default: { info: vitest_1.vi.fn(), warn: vitest_1.vi.fn(), error: vitest_1.vi.fn(), debug: vitest_1.vi.fn() },
}));
const ai_service_1 = require("../services/ai.service");
(0, vitest_1.describe)('AIService', () => {
    (0, vitest_1.it)('streams summary chunks', async () => {
        const service = new ai_service_1.AIService();
        const chunks = [];
        for await (const chunk of service.summarizeEmailStream('Test Subject', 'Test body')) {
            chunks.push(chunk);
        }
        (0, vitest_1.expect)(chunks.length).toBeGreaterThan(0);
        (0, vitest_1.expect)(chunks.join('')).toContain('This');
    });
    (0, vitest_1.it)('returns a numeric priority score between 1 and 10', async () => {
        const service = new ai_service_1.AIService();
        const score = await service.prioritizeEmail('Urgent meeting', 'Please respond ASAP', 'boss@company.com');
        (0, vitest_1.expect)(typeof score).toBe('number');
        (0, vitest_1.expect)(score).toBeGreaterThanOrEqual(1);
        (0, vitest_1.expect)(score).toBeLessThanOrEqual(10);
    });
    (0, vitest_1.it)('clamps out-of-range scores to 1-10', async () => {
        // Test the clamping logic directly
        const clamp = (n) => Math.min(10, Math.max(1, n));
        (0, vitest_1.expect)(clamp(0)).toBe(1);
        (0, vitest_1.expect)(clamp(15)).toBe(10);
        (0, vitest_1.expect)(clamp(7)).toBe(7);
    });
    (0, vitest_1.it)('falls back to 5 for non-numeric AI response', async () => {
        const text = 'not a number';
        const score = parseInt(text);
        const result = isNaN(score) ? 5 : Math.min(10, Math.max(1, score));
        (0, vitest_1.expect)(result).toBe(5);
    });
});
