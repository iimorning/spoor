import { describe, expect, it } from 'vitest';
import { parseMetasoQaResponse } from '../../src/utils/parseMetasoQa';

describe('parseMetasoQaResponse', () => {
  it('reads chat_completions content and webpages', () => {
    const out = parseMetasoQaResponse({
      choices: [{ message: { content: 'Gemini 3.7 Flash 已发布。' } }],
      webpages: [
        {
          title: 'Reuters',
          link: 'https://www.reuters.com/example',
          snippet: 'Google unveils Gemini 3.7 Flash',
        },
      ],
    });
    expect(out.brief).toBe('Gemini 3.7 Flash 已发布。');
    expect(out.webpages).toEqual([
      expect.objectContaining({
        title: 'Reuters',
        link: 'https://www.reuters.com/example',
        snippet: 'Google unveils Gemini 3.7 Flash',
      }),
    ]);
  });

  it('reads references when webpages are missing', () => {
    const out = parseMetasoQaResponse({
      answer: '简答',
      references: [{ title: '36kr', url: 'https://www.36kr.com/p/1', snippet: '腰斩' }],
    });
    expect(out.brief).toBe('简答');
    expect(out.webpages[0]).toMatchObject({
      title: '36kr',
      link: 'https://www.36kr.com/p/1',
      snippet: '腰斩',
    });
  });
});
