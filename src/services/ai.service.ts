import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export class AIService {
  async summarizeEmail(subject: string, body: string): Promise<string> {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 150,
      messages: [
        {
          role: 'user',
          content: `Summarize this email in 2-3 sentences. Be concise and focus on key points and any action items.

Subject: ${subject}
Body: ${body.substring(0, 3000)}`,
        },
      ],
    });

    return (message.content[0] as { type: string; text: string }).text;
  }

  async draftReply(subject: string, body: string, fromName: string): Promise<string> {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      messages: [
        {
          role: 'user',
          content: `Draft a professional, concise reply to this email. Only write the reply body — no subject line, no "Subject:" prefix.

From: ${fromName}
Subject: ${subject}
Email: ${body.substring(0, 2000)}`,
        },
      ],
    });

    return (message.content[0] as { type: string; text: string }).text;
  }

  async prioritizeEmail(subject: string, body: string, from: string): Promise<number> {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 10,
      messages: [
        {
          role: 'user',
          content: `Rate the urgency/importance of this email from 1-10. Reply with ONLY the number, nothing else.
1-3: Low priority (newsletters, promotions)
4-6: Medium priority (general correspondence)
7-9: High priority (action required, deadlines)
10: Critical (urgent, immediate action needed)

From: ${from}
Subject: ${subject}
Preview: ${body.substring(0, 500)}`,
        },
      ],
    });

    const text = (message.content[0] as { type: string; text: string }).text.trim();
    const score = parseInt(text);
    return isNaN(score) ? 5 : Math.min(10, Math.max(1, score));
  }

  async *summarizeEmailStream(subject: string, body: string): AsyncGenerator<string> {
    const stream = await client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 150,
      messages: [
        {
          role: 'user',
          content: `Summarize this email in 2-3 sentences. Be concise and focus on key points and any action items.

Subject: ${subject}
Body: ${body.substring(0, 3000)}`,
        },
      ],
    });

    for await (const chunk of stream) {
      if (
        chunk.type === 'content_block_delta' &&
        chunk.delta.type === 'text_delta'
      ) {
        yield chunk.delta.text;
      }
    }
  }

  async *draftReplyStream(subject: string, body: string, fromName: string): AsyncGenerator<string> {
    const stream = await client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      messages: [
        {
          role: 'user',
          content: `Draft a professional, concise reply to this email. Only write the reply body — no subject line.

From: ${fromName}
Subject: ${subject}
Email: ${body.substring(0, 2000)}`,
        },
      ],
    });

    for await (const chunk of stream) {
      if (
        chunk.type === 'content_block_delta' &&
        chunk.delta.type === 'text_delta'
      ) {
        yield chunk.delta.text;
      }
    }
  }
}
