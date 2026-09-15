import { describe, it, expect, afterEach } from 'vitest';
import {
  AMBIENCE_SCENES,
  getAmbienceScene,
  recommendedAmbienceScenes,
  resolveAmbienceSceneId,
} from '../../src/data/ambienceCatalog';
import {
  DEFAULT_AMBIENCE_PAYLOAD,
  encodeAmbienceContent,
  parseAmbienceContentOrDefault,
  tryParseAmbienceContent,
} from '../../src/utils/ambiencePayload';
import {
  clearAmbienceBufferCacheForTests,
  getAmbienceMixer,
} from '../../src/services/ambienceMixer';
import { canvasNodeTypeLabelKey, getCanvasNodeSearchText } from '../../src/utils/canvasNodeSearch';

describe('ambience catalog', () => {
  it('includes remote nature streams for the playlist', () => {
    expect(AMBIENCE_SCENES.map((s) => s.id)).toEqual([
      'midnight-rain',
      'soft-ocean',
      'evening-storm',
      'crackling-fire',
      'winter-blizzard',
      'train-carriage',
    ]);
    expect(AMBIENCE_SCENES.every((s) => /^https?:\/\//.test(s.streamUrl))).toBe(true);
    expect(recommendedAmbienceScenes().length).toBeGreaterThanOrEqual(2);
    // crackling-fire / winter-blizzard deliberately omit playbackGain so the
    // mixer takes the simple-stream path; the Freesound fetch + decode +
    // amplify path was breaking on cdn.freesound.org's CORS surface.
    expect(getAmbienceScene('crackling-fire').playbackGain ?? 1).toBeLessThanOrEqual(1);
    expect(getAmbienceScene('winter-blizzard').playbackGain ?? 1).toBeLessThanOrEqual(1);
  });

  it('resolves unknown and legacy ids to nature scenes', () => {
    expect(getAmbienceScene('nope').id).toBe('midnight-rain');
    expect(resolveAmbienceSceneId('white-noise')).toBe('midnight-rain');
    expect(resolveAmbienceSceneId('waves')).toBe('soft-ocean');
    expect(resolveAmbienceSceneId('howling-wind')).toBe('winter-blizzard');
    expect(resolveAmbienceSceneId('blizzard')).toBe('winter-blizzard');
    expect(resolveAmbienceSceneId('train')).toBe('train-carriage');
    expect(resolveAmbienceSceneId('cafe-chatter')).toBe('train-carriage');
  });
});

describe('ambiencePayload', () => {
  it('round-trips trackId / master / muted', () => {
    const encoded = encodeAmbienceContent({
      trackId: 'soft-ocean',
      master: 0.4,
      muted: true,
    });
    expect(tryParseAmbienceContent(encoded)).toEqual({
      trackId: 'soft-ocean',
      master: 0.4,
      muted: true,
    });
  });

  it('migrates legacy multi-layer volumes to a single scene', () => {
    const legacy = encodeAmbienceContent({
      trackId: 'midnight-rain',
      master: 1,
      muted: false,
    });
    const old =
      'spoor-ambience:v1:' +
      JSON.stringify({
        volumes: { 'heavy-rain': 0.8, 'white-noise': 0.2 },
        master: 0.6,
        muted: false,
      });
    expect(tryParseAmbienceContent(old)?.trackId).toBe('midnight-rain');
    expect(parseAmbienceContentOrDefault(undefined)).toEqual(DEFAULT_AMBIENCE_PAYLOAD);
    expect(tryParseAmbienceContent(legacy)?.trackId).toBe('midnight-rain');
  });
});

describe('AmbienceMixer', () => {
  afterEach(() => {
    clearAmbienceBufferCacheForTests();
  });

  it('tracks exclusive play state', async () => {
    class FakeAudio {
      volume = 1;
      muted = false;
      loop = false;
      crossOrigin = '';
      preload = '';
      src = '';
      addEventListener() {}
      removeAttribute() {}
      load() {}
      pause() {}
      play() {
        return Promise.resolve();
      }
    }
    const prev = globalThis.Audio;
    (globalThis as unknown as { Audio: typeof FakeAudio }).Audio = FakeAudio;

    try {
      const a = getAmbienceMixer('node-a');
      const b = getAmbienceMixer('node-b');
      a.applyState({ trackId: 'midnight-rain', master: 0.5, muted: false });
      b.applyState({ trackId: 'soft-ocean', master: 0.5, muted: false });
      await a.play();
      expect(a.isPlaying).toBe(true);
      await b.play();
      expect(a.isPlaying).toBe(false);
      expect(b.isPlaying).toBe(true);
      b.stop();
      expect(b.isPlaying).toBe(false);
    } finally {
      (globalThis as unknown as { Audio: typeof prev }).Audio = prev;
    }
  });

  it('streams Freesound URLs directly when playbackGain is absent', async () => {
    // The crackling-fire / winter-blizzard tracks dropped playbackGain to
    // avoid the cdn.freesound.org fetch + decode + amplify path that was
    // failing on CORS / decodeAudioData. Verify the mixer now streams the
    // raw URL straight into the <audio> element instead of fetching +
    // blobifying.
    const played: string[] = [];
    class FakeAudio {
      volume = 1;
      muted = false;
      loop = false;
      preload = '';
      src = '';
      addEventListener() {}
      removeAttribute() {}
      load() {}
      pause() {}
      play() {
        played.push(this.src);
        return Promise.resolve();
      }
    }
    const prevAudio = globalThis.Audio;
    const prevFetch = globalThis.fetch;
    const prevCreate = URL.createObjectURL;
    (globalThis as unknown as { Audio: typeof FakeAudio }).Audio = FakeAudio;
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg' },
      });
    }) as typeof fetch;
    URL.createObjectURL = () => 'blob:ambience-test';

    try {
      const mixer = getAmbienceMixer('node-blizzard');
      mixer.applyState({ trackId: 'winter-blizzard', master: 0.5, muted: false });
      await mixer.play();
      expect(mixer.isPlaying).toBe(true);
      // The raw Freesound URL should be assigned straight to audio.src —
      // no fetch, no blob URL.
      expect(played[0]).toBe(
        'https://cdn.freesound.org/previews/849/849302_10711943-hq.mp3',
      );
      expect(fetchCalled).toBe(false);
      mixer.stop();
    } finally {
      (globalThis as unknown as { Audio: typeof prevAudio }).Audio = prevAudio;
      globalThis.fetch = prevFetch;
      URL.createObjectURL = prevCreate;
    }
  });
});

describe('ambience search helpers', () => {
  it('labels ambience type', () => {
    expect(canvasNodeTypeLabelKey('ambience')).toBe('canvas.search_type_ambience');
  });

  it('indexes scene title instead of raw JSON', () => {
    const content = encodeAmbienceContent({
      trackId: 'soft-ocean',
      master: 1,
      muted: false,
    });
    const text = getCanvasNodeSearchText({
      id: '1',
      type: 'ambience',
      content,
      description: 'Ambience',
      x: 0,
      y: 0,
    });
    expect(text.toLowerCase()).toMatch(/ocean|海浪|waves/);
    expect(text).not.toContain('spoor-ambience');
  });
});
