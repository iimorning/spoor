import { describe, expect, it } from 'vitest';
import { metasoQaRequestBody } from '../../src/services/metasoQa';

describe('metasoQaRequestBody', () => {
  it('matches playground 问答 defaults', () => {
    expect(metasoQaRequestBody('谷歌最新的模型怎么样')).toEqual({
      q: '谷歌最新的模型怎么样',
      scope: 'webpage',
      model: 'fast',
      format: 'chat_completions',
      stream: false,
      conciseSnippet: true,
    });
  });
});
