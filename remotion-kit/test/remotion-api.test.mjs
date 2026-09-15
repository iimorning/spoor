import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import test from 'node:test';
import request from 'supertest';
import { createMinimalRemotionApp } from './test-app.mjs';
import { buildRemotionInputProps } from '../routes/remotion.mjs';

const kitRemotionRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'remotion');

function makeTestProject() {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'remotion-kit-api-'));
  const remotionDir = path.join(projectRoot, 'remotion');
  fs.mkdirSync(remotionDir, { recursive: true });
  fs.writeFileSync(
    path.join(remotionDir, 'index.js'),
    `import { registerRoot } from 'remotion';
import { RemotionRoot } from './Root.jsx';
registerRoot(RemotionRoot);`,
    'utf8'
  );
  const realRoot = path.join(kitRemotionRoot, 'Root.jsx');
  if (fs.existsSync(realRoot)) {
    fs.copyFileSync(realRoot, path.join(remotionDir, 'Root.jsx'));
  }
  fs.writeFileSync(
    path.join(remotionDir, 'Composition.jsx'),
    `import React from 'react';
import { AbsoluteFill } from 'remotion';
export const MyComposition = () => <AbsoluteFill>JustTalk</AbsoluteFill>;`,
    'utf8'
  );
  fs.writeFileSync(
    path.join(remotionDir, 'PromoVertical.jsx'),
    `import React from 'react';
import { AbsoluteFill } from 'remotion';
export const PromoVerticalDuration = 150;
export const PromoVertical = () => <AbsoluteFill>Promo</AbsoluteFill>;`,
    'utf8'
  );

  const outputDir = path.join(projectRoot, 'output');
  fs.mkdirSync(outputDir, { recursive: true });

  const cliTarget = path.join(projectRoot, 'node_modules', '@remotion', 'cli');
  fs.mkdirSync(cliTarget, { recursive: true });
  fs.writeFileSync(path.join(cliTarget, 'remotion-cli.js'), '// stub', 'utf8');

  return { projectRoot };
}

test('POST /api/remotion/render 400 when compositionId missing', async () => {
  const { projectRoot } = makeTestProject();
  const app = createMinimalRemotionApp(projectRoot);
  const res = await request(app).post('/api/remotion/render').send({ outputName: 'test.mp4' }).expect(400);
  assert.ok(String(res.body.error).includes('compositionId'));
});

test('buildRemotionInputProps maps audio path and subtitle segments', () => {
  const { projectRoot } = makeTestProject();
  const audioRel = 'media/demo/episode.wav';
  const audioAbs = path.join(projectRoot, audioRel);
  fs.mkdirSync(path.dirname(audioAbs), { recursive: true });
  fs.writeFileSync(audioAbs, 'fake audio', 'utf8');
  const req = {
    protocol: 'http',
    get(name) {
      return name === 'host' ? 'localhost:3780' : '';
    },
    body: {
      inputProps: {
        title: 'Lump in the throat',
        subtitle: '播客推广',
        audioPath: audioRel,
        timestampSegments: [
          { startSec: 0, endSec: 2.5, en: 'Hello.', zh: '你好。' },
          { startSec: 'bad', endSec: 3, en: 'Skip me.' }
        ]
      }
    }
  };

  const props = buildRemotionInputProps(req, projectRoot);
  assert.equal(props.title, 'Lump in the throat');
  assert.equal(props.audioPath, audioRel);
  assert.equal(props.audioUrl, 'http://localhost:3780/media/demo/episode.wav');
  assert.deepEqual(props.timestampSegments, [{ startSec: 0, endSec: 2.5, en: 'Hello.', zh: '你好。' }]);
  assert.equal(props.totalDurationSec, 2.5);
});

test('POST /api/remotion/render 400 when outputName missing', async () => {
  const { projectRoot } = makeTestProject();
  const app = createMinimalRemotionApp(projectRoot);
  const res = await request(app)
    .post('/api/remotion/render')
    .send({ compositionId: 'MyComposition' })
    .expect(400);
  assert.ok(String(res.body.error).includes('outputName'));
});

test('POST /api/remotion/render 400 when both missing', async () => {
  const { projectRoot } = makeTestProject();
  const app = createMinimalRemotionApp(projectRoot);
  const res = await request(app).post('/api/remotion/render').send({}).expect(400);
  assert.ok(String(res.body.error).includes('compositionId'));
});

test('POST /api/remotion/render returns SSE content type', async () => {
  const { projectRoot } = makeTestProject();
  const app = createMinimalRemotionApp(projectRoot);
  const res = await request(app)
    .post('/api/remotion/render')
    .send({ compositionId: 'MyComposition', outputName: 'test-output.mp4' })
    .expect(200);
  assert.match(String(res.headers['content-type'] || ''), /text\/event-stream/i);
});

test('POST /api/remotion/render returns at least one SSE event', async () => {
  const { projectRoot } = makeTestProject();
  const app = createMinimalRemotionApp(projectRoot);
  const res = await request(app)
    .post('/api/remotion/render')
    .send({ compositionId: 'MyComposition', outputName: 'test.mp4' })
    .expect(200);

  const body = String(res.text || '');
  assert.ok(body.includes('event:'));
  assert.ok(body.includes('data:'));
});

test('POST /api/remotion/render 503 when CLI missing', async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'remotion-kit-no-cli-'));
  fs.mkdirSync(path.join(projectRoot, 'remotion'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'remotion', 'index.js'), "import {registerRoot} from 'remotion'; registerRoot(()=>null);\n");
  const app = createMinimalRemotionApp(projectRoot);
  const res = await request(app)
    .post('/api/remotion/render')
    .send({ compositionId: 'MyComposition', outputName: 'x.mp4' })
    .expect(503);
  assert.ok(String(res.body.error).includes('@remotion/cli'));
});
