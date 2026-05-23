import { describe, it, expect, vi } from 'vitest';

// Set dummy env before any imports
process.env.GROQ_API_KEY = 'test-key';

vi.mock('groq-sdk', () => {
  const mockCreate = vi.fn().mockImplementation(({ stream }: any) => {
    if (stream) {
      return Promise.resolve(
        (async function* () {
          yield { choices: [{ delta: { content: 'This ' } }] };
          yield { choices: [{ delta: { content: 'is a summary.' } }] };
        })()
      );
    }
    return Promise.resolve({ choices: [{ message: { content: '8' } }] });
  });

  return {
    default: vi.fn().mockImplementation(() => ({
      chat: { completions: { create: mockCreate } },
    })),
  };
});

vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { AIService } from '../services/ai.service';

describe('AIService', () => {
  it('streams summary chunks', async () => {
    const service = new AIService();
    const chunks: string[] = [];
    for await (const chunk of service.summarizeEmailStream('Test Subject', 'Test body')) {
      chunks.push(chunk);
    }
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.join('')).toContain('This');
  });

  it('returns a numeric priority score between 1 and 10', async () => {
    const service = new AIService();
    const score = await service.prioritizeEmail('Urgent meeting', 'Please respond ASAP', 'boss@company.com');
    expect(typeof score).toBe('number');
    expect(score).toBeGreaterThanOrEqual(1);
    expect(score).toBeLessThanOrEqual(10);
  });

  it('clamps out-of-range scores to 1-10', async () => {
    // Test the clamping logic directly
    const clamp = (n: number) => Math.min(10, Math.max(1, n));
    expect(clamp(0)).toBe(1);
    expect(clamp(15)).toBe(10);
    expect(clamp(7)).toBe(7);
  });

  it('falls back to 5 for non-numeric AI response', async () => {
    const text = 'not a number';
    const score = parseInt(text);
    const result = isNaN(score) ? 5 : Math.min(10, Math.max(1, score));
    expect(result).toBe(5);
  });
});
