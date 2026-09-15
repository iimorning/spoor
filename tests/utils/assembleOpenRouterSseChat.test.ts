import { describe, expect, it } from 'vitest';
import {
  assembleOpenRouterChatResponse,
  assembleOpenRouterSseChat,
  perplexityAssistantText,
} from '../../src/utils/assembleOpenRouterSseChat';

describe('assembleOpenRouterSseChat', () => {
  it('concatenates deltas and keeps the last search_results list', () => {
    const raw = [
      'data: {"id":"1","model":"perplexity/sonar-pro","choices":[{"delta":{"content":"Hello "}}]}',
      'data: {"choices":[{"delta":{"content":"world"}}],"search_results":[{"title":"A","url":"https://a.example"}]}',
      'data: [DONE]',
      '',
    ].join('\n');
    const out = assembleOpenRouterSseChat(raw);
    expect(perplexityAssistantText(out)).toBe('Hello world');
    expect(out.search_results).toEqual([{ title: 'A', url: 'https://a.example' }]);
    expect(out.model).toBe('perplexity/sonar-pro');
  });

  it('joins multiline SSE data fields', () => {
    const raw = [
      'data: {"choices":[{"delta":{"content":"x"}}],',
      'data: "citations":["https://cited.example/p"]}',
      '',
    ].join('\n');
    const out = assembleOpenRouterSseChat(raw);
    expect(out.citations).toEqual(['https://cited.example/p']);
  });
});

describe('assembleOpenRouterChatResponse', () => {
  it('parses a non-stream JSON body', () => {
    const data = assembleOpenRouterChatResponse(
      JSON.stringify({
        model: 'perplexity/sonar-pro',
        choices: [{ message: { content: 'ok' } }],
        search_results: [{ url: 'https://one.example' }],
      }),
    ) as { search_results: unknown[] };
    expect(data.search_results).toEqual([{ url: 'https://one.example' }]);
  });

  it('merges JSONL chunks (no data: prefix) so trailing citations are not dropped', () => {
    const raw = [
      JSON.stringify({ choices: [{ delta: { content: 'A' } }] }),
      JSON.stringify({
        choices: [
          {
            delta: {
              annotations: [
                {
                  type: 'url_citation',
                  url_citation: { title: 'G', url: 'https://gemini.example/3-1' },
                },
              ],
            },
            finish_reason: 'stop',
          },
        ],
      }),
    ].join('\n');
    const data = assembleOpenRouterChatResponse(raw) as {
      choices: [{ message: { annotations?: unknown[] } }];
    };
    expect(perplexityAssistantText(data)).toBe('A');
    expect(data.choices[0]?.message.annotations?.length).toBe(1);
  });
});
