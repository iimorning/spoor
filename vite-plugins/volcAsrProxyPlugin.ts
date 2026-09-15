/**
 * Vite plugin: dev-only two-leg proxy for Volcengine streaming ASR.
 *
 *   - POST /api/volc-asr/issue-token  →  issues a short-lived opaque token.
 *   - POST /api/volc-asr/recognize-flash → file ASR (openspeech flash HTTP).
 *   - WS   /api/volc-asr?token=…       →  looks up the credentials by token and
 *                                         opens an upstream WebSocket to
 *                                         `wss://openspeech.bytedance.com` with
 *                                         `X-Api-*` headers injected.
 *
 * ⚠️  LOCAL DEV / PREVIEW ONLY. DO NOT expose this plugin (or any build that contains it)
 *     to the public internet.
 *
 *     `POST /api/volc-asr/issue-token` has NO authentication and NO CSRF protection —
 *     anyone able to reach the dev/preview server can immediately obtain a token bound
 *     to whatever credentials the user has already cached there, then proxy traffic to
 *     `openspeech.bytedance.com` on the server's bill. This is fine for `npm run dev`
 *     on a laptop; it is catastrophic if the dev bundle is published.
 *
 *     Production / Tauri builds should bypass this proxy entirely (Tauri IPC can pass
 *     custom WS headers directly to `wss://openspeech.bytedance.com`); this plugin is
 *     guarded out of production by virtue of `vite-plugins/*` being dev-only code.
 *
 * The browser never puts the long-lived ASR credentials in the WebSocket URL. Only an
 * opaque short-lived token (default 10 min TTL — voice sessions reissue each start) is
 * visible in browser history, dev-server logs, and screenshots.
 */
import type { Plugin } from 'vite';
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import { randomUUID } from 'node:crypto';
import { createTokenStore, DEFAULT_TOKEN_TTL_MS } from './volcAsrTokenStore';
import { forwardVolcFlashRecognize } from './volcAsrFlashUpstream';

const UPSTREAM_URL = 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async';
const ISSUE_PATH = '/api/volc-asr/issue-token';
const FLASH_PATH = '/api/volc-asr/recognize-flash';
const WS_PATH = '/api/volc-asr';
const FLASH_MAX_BODY = 28 * 1024 * 1024;

// Single shared store across dev / preview servers. Reset on process restart.
const tokenStore = createTokenStore();

// Periodic sweep so the map doesn't grow indefinitely if the dev server runs for days.
const sweepTimer = setInterval(() => {
  tokenStore.sweep();
}, 60_000);
if (typeof sweepTimer.unref === 'function') sweepTimer.unref();

function readQuery(reqUrl: string | undefined): URLSearchParams {
  try {
    return new URL(reqUrl || '', 'http://localhost').searchParams;
  } catch {
    return new URLSearchParams();
  }
}

type IssueBody = { apiKey?: string; appId?: string; accessToken?: string };

function pickCreds(body: IssueBody | null): IssueBody | null {
  if (!body) return null;
  const apiKey = (body.apiKey ?? '').trim();
  const appId = (body.appId ?? '').trim();
  const accessToken = (body.accessToken ?? '').trim();
  if (apiKey) return { apiKey };
  if (appId && accessToken) return { appId, accessToken };
  return null;
}

/** Connect-style middleware reads the body and writes a JSON response.
 *
 *  ⚠️ NO AUTHENTICATION / NO CSRF — only safe because the dev server is bound to localhost.
 */
function attachIssueEndpoint(server: {
  middlewares: { use: (fn: (req: IncomingMessage, res: any, next: (err?: unknown) => void) => void) => void };
}) {
  server.middlewares.use(async (req, res, next) => {
    const path = (req.url || '').split('?')[0];
    if (req.method !== 'POST' || path !== ISSUE_PATH) {
      return next();
    }
    try {
      const raw: unknown = await new Promise((resolve, reject) => {
        let data = '';
        req.setEncoding('utf8');
        req.on('data', (chunk: string) => {
          data += chunk;
        });
        req.on('end', () => {
          if (!data) return resolve(null);
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
        req.on('error', reject);
      });
      const creds = pickCreds(raw as IssueBody | null);
      if (!creds) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'missing_volc_asr_credentials' }));
        return;
      }
      const { token, expiresIn } = tokenStore.issue(creds, DEFAULT_TOKEN_TTL_MS);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ token, expiresIn }));
    } catch (e) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: (e as Error).message }));
    }
  });
}

function attachFlashEndpoint(server: {
  middlewares: { use: (fn: (req: IncomingMessage, res: any, next: (err?: unknown) => void) => void) => void };
}) {
  server.middlewares.use(async (req, res, next) => {
    const path = (req.url || '').split('?')[0];
    if (req.method !== 'POST' || path !== FLASH_PATH) return next();
    try {
      const raw = await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        let total = 0;
        req.on('data', (chunk: Buffer | string) => {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          total += buf.length;
          if (total > FLASH_MAX_BODY) {
            reject(new Error('payload_too_large'));
            return;
          }
          chunks.push(buf);
        });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
      });
      const parsed = JSON.parse(raw.toString('utf8')) as {
        apiKey?: string;
        appId?: string;
        accessToken?: string;
        format?: string;
        data?: string;
      };
      const creds = pickCreds(parsed);
      const format = (parsed.format ?? '').trim();
      const data = (parsed.data ?? '').trim();
      if (!creds || !data) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'missing_volc_asr_credentials_or_audio' }));
        return;
      }
      const result = await forwardVolcFlashRecognize(creds, format || 'mp3', data);
      res.statusCode = result.ok ? 200 : result.status;
      res.setHeader('Content-Type', 'application/json');
      res.end(result.ok ? JSON.stringify({ text: result.text }) : JSON.stringify({ error: result.error }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      res.statusCode = msg === 'payload_too_large' ? 413 : 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: msg }));
    }
  });
}

function attachVolcAsrUpgrade(server: {
  httpServer?: { on: (event: string, listener: (...args: any[]) => void) => void } | null;
}) {
  const wss = new WebSocketServer({ noServer: true });

  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = req.url || '';
    const path = url.split('?')[0];
    if (!path.startsWith(WS_PATH) || path === ISSUE_PATH || path === FLASH_PATH) return;

    const qs = readQuery(url);
    const token = (qs.get('token') || '').trim();
    const resourceId = (qs.get('resourceId') || 'volc.seedasr.sauc.duration').trim();
    const requestId = (qs.get('requestId') || randomUUID()).trim();

    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    const creds = tokenStore.lookup(token);
    if (!creds) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    const headers: Record<string, string> = {
      'X-Api-Resource-Id': resourceId,
      'X-Api-Request-Id': requestId,
      'X-Api-Connect-Id': requestId,
      'X-Api-Sequence': '-1',
    };
    if (creds.apiKey) {
      headers['X-Api-Key'] = creds.apiKey;
    } else {
      // pickCreds() guarantees either apiKey OR (appId && accessToken), but TS doesn't
      // narrow — the `!` here is safe given the contract above.
      headers['X-Api-App-Key'] = creds.appId!;
      headers['X-Api-Access-Key'] = creds.accessToken!;
    }

    wss.handleUpgrade(req, socket, head, (client) => {
      let upstream: WebSocket;
      console.log('[Spoor ASR Proxy] client upgraded', { requestId, resourceId, hasApiKey: !!creds.apiKey, hasAppId: !!creds.appId });
      try {
        upstream = new WebSocket(UPSTREAM_URL, { headers });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[Spoor ASR Proxy] upstream ctor failed', msg);
        client.send(JSON.stringify({ error: msg }));
        client.close();
        return;
      }

      // Browser `onopen` fires when the local leg is ready — often BEFORE upstream opens.
      // Without a queue, the gzip full-client-request is silently dropped and the session
      // hangs forever in "listening" with no error and no transcripts.
      const pendingFromClient: Buffer[] = [];
      const MAX_PENDING_FROM_CLIENT = 64;

      const toBuffer = (data: WebSocket.RawData): Buffer => {
        if (Buffer.isBuffer(data)) return data;
        if (data instanceof ArrayBuffer) return Buffer.from(data);
        if (Array.isArray(data)) return Buffer.concat(data);
        return Buffer.from(data);
      };

      const flushPendingToUpstream = () => {
        if (upstream.readyState !== WebSocket.OPEN) return;
        for (const buf of pendingFromClient) {
          upstream.send(buf, { binary: true });
        }
        pendingFromClient.length = 0;
      };

      upstream.on('open', () => {
        console.log('[Spoor ASR Proxy] upstream open', { pending: pendingFromClient.length });
        flushPendingToUpstream();
      });

      // Upstream openspeech always uses the binary framing protocol. If we forward with
      // binary:false (ws sometimes reports isBinary incorrectly), the browser UTF-8-decodes
      // the bytes and parseServerFrame sees garbage → "ASR frame truncated payload".
      upstream.on('message', (data) => {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as Uint8Array);
        const mt = buf.length >= 2 ? (buf[1]! >> 4) & 0x0f : -1;
        console.log('[Spoor ASR Proxy] upstream → client', { bytes: buf.length, msgType: mt });
        if (client.readyState === WebSocket.OPEN) {
          client.send(buf, { binary: true });
        }
      });
      upstream.on('error', (err) => {
        console.error('[Spoor ASR Proxy] upstream error', err.message);
        pendingFromClient.length = 0;
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ error: err.message || 'upstream error' }));
        }
      });
      upstream.on('close', () => {
        console.log('[Spoor ASR Proxy] upstream close');
        pendingFromClient.length = 0;
        try {
          client.close();
        } catch {
          /* ignore */
        }
      });
      client.on('message', (data) => {
        const buf = toBuffer(data);
        const mt = buf.length >= 2 ? (buf[1]! >> 4) & 0x0f : -1;
        console.log('[Spoor ASR Proxy] client → upstream', { bytes: buf.length, msgType: mt, upstreamState: upstream.readyState });
        if (upstream.readyState === WebSocket.OPEN) {
          upstream.send(buf, { binary: true });
          return;
        }
        if (pendingFromClient.length >= MAX_PENDING_FROM_CLIENT) {
          pendingFromClient.shift();
        }
        pendingFromClient.push(buf);
      });
      client.on('close', () => {
        pendingFromClient.length = 0;
        try {
          upstream.close();
        } catch {
          /* ignore */
        }
      });
      client.on('error', () => {
        pendingFromClient.length = 0;
        try {
          upstream.close();
        } catch {
          /* ignore */
        }
      });
    });
  };

  server.httpServer?.on('upgrade', onUpgrade);
}

export function volcAsrProxyPlugin(): Plugin {
  return {
    name: 'spoor-volc-asr-proxy',
    configureServer(server) {
      attachIssueEndpoint(server);
      attachFlashEndpoint(server);
      attachVolcAsrUpgrade(server);
    },
    configurePreviewServer(server) {
      attachIssueEndpoint(server);
      attachFlashEndpoint(server);
      attachVolcAsrUpgrade(server);
    },
  };
}

/** Exposed for tests so they can introspect / reset the store between cases. */
export const __volcAsrTestHooks = {
  issue: tokenStore.issue,
  lookup: tokenStore.lookup,
  revoke: tokenStore.revoke,
  sweep: tokenStore.sweep,
  size: tokenStore.size,
  clear: tokenStore.clear,
};
