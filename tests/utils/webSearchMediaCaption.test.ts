import { describe, expect, it } from 'vitest';
import {
  buildWebSearchMediaRelation,
  formatSearchMediaDescription,
  joinSearchQueries,
  parentCardTopic,
  parseSearchMediaDescription,
  webSearchRelationContext,
} from '../../src/utils/webSearchMediaCaption';

describe('parentCardTopic', () => {
  it('prefers the user question on AI cards', () => {
    expect(
      parentCardTopic({
        type: 'ai',
        userTurn: '古着怎么搭配',
        content: '可以先从一件牛仔外套开始……',
      }),
    ).toBe('古着怎么搭配');
  });

  it('strips search command words from the user turn', () => {
    expect(
      parentCardTopic({
        type: 'ai',
        userTurn: '父与子作者的生平如何？联网搜索',
        content: '……',
      }),
    ).toBe('父与子作者的生平如何');
  });

  it('uses explicit query after 搜图', () => {
    expect(parentCardTopic({ type: 'ai', userTurn: '搜图 富士山' })).toBe('富士山');
  });

  it('falls back to the first line of note content', () => {
    expect(parentCardTopic({ type: 'note', content: '东京古着店\n第二行' })).toBe('东京古着店');
  });
});

describe('joinSearchQueries', () => {
  it('dedupes and joins queries', () => {
    expect(joinSearchQueries(['vintage jacket', ' vintage jacket ', 'thrift haul'])).toBe(
      'vintage jacket；thrift haul',
    );
  });
});

describe('buildWebSearchMediaRelation', () => {
  it('returns empty when there is no snippet', () => {
    expect(
      buildWebSearchMediaRelation({
        query: 'vintage denim jacket',
        parentLabel: '古着怎么搭配',
      }),
    ).toBe('');
  });

  it('shows only the hit snippet when present', () => {
    expect(
      buildWebSearchMediaRelation({
        query: 'vintage',
        parentLabel: '古着穿搭',
        snippet: 'A Tokyo thrift haul looking at 90s denim.',
      }),
    ).toBe('A Tokyo thrift haul looking at 90s denim.');
  });
});

describe('format/parseSearchMediaDescription', () => {
  it('round-trips title and relation', () => {
    const raw = formatSearchMediaDescription('Vintage haul', 'A short snippet from the page.');
    expect(parseSearchMediaDescription(raw)).toEqual({
      title: 'Vintage haul',
      relation: 'A short snippet from the page.',
    });
  });

  it('keeps legacy single-line descriptions as title only', () => {
    expect(parseSearchMediaDescription('Just a title')).toEqual({
      title: 'Just a title',
      relation: '',
    });
  });
});

describe('webSearchRelationContext', () => {
  it('packs query + cleaned parent label', () => {
    expect(
      webSearchRelationContext({ type: 'ai', userTurn: '搜图 古着' }, 'vintage jacket'),
    ).toEqual({
      query: 'vintage jacket',
      parentLabel: '古着',
    });
  });
});
