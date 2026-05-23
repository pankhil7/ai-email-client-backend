import Groq from 'groq-sdk';

const MODEL = 'llama-3.3-70b-versatile';

export class AIService {
  private _client: Groq | null = null;

  private get client(): Groq {
    if (!this._client) {
      this._client = new Groq({ apiKey: process.env.GROQ_API_KEY });
    }
    return this._client;
  }

  async summarizeEmail(subject: string, body: string): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: MODEL,
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

    return response.choices[0]?.message?.content || '';
  }

  async draftReply(subject: string, body: string, fromName: string): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: MODEL,
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

    return response.choices[0]?.message?.content || '';
  }

  async prioritizeEmail(subject: string, body: string, from: string): Promise<number> {
    const response = await this.client.chat.completions.create({
      model: MODEL,
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

    const text = response.choices[0]?.message?.content?.trim() || '5';
    const score = parseInt(text);
    return isNaN(score) ? 5 : Math.min(10, Math.max(1, score));
  }

  async *summarizeEmailStream(subject: string, body: string): AsyncGenerator<string> {
    const stream = await this.client.chat.completions.create({
      model: MODEL,
      max_tokens: 150,
      stream: true,
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
      const text = chunk.choices[0]?.delta?.content;
      if (text) yield text;
    }
  }

  async classifyEmail(subject: string, body: string): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: MODEL,
      max_tokens: 10,
      messages: [
        {
          role: 'user',
          content: `Classify this email into exactly one of these categories:
Work, Personal, Urgent, Follow Up, Newsletter, Finance

Reply with ONLY the category name, nothing else.

Subject: ${subject}
Body preview: ${body.substring(0, 500)}`,
        },
      ],
    });

    const label = response.choices[0]?.message?.content?.trim() || '';
    const valid = ['Work', 'Personal', 'Urgent', 'Follow Up', 'Newsletter', 'Finance'];
    return valid.includes(label) ? label : '';
  }

  async *draftReplyStream(subject: string, body: string, fromName: string): AsyncGenerator<string> {
    const stream = await this.client.chat.completions.create({
      model: MODEL,
      max_tokens: 400,
      stream: true,
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
      const text = chunk.choices[0]?.delta?.content;
      if (text) yield text;
    }
  }
}
