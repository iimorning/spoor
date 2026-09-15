/**
 * 浏览器端调用 /api/remotion/render（SSE）的参考写法。
 * 摘自 content-factory/workspace.js，可按你的 state 改写 inputProps。
 */
async function startRemotionRender(compositionId, outputName) {
  const inputProps = {
    title: 'Episode title',
    subtitle: '分类或副标题',
    audioPath: 'relative/from/projectRoot.wav', // 须真实存在；服务端会转成 http(s) URL 给 <Audio />
    timestampSegments: [
      { startSec: 0, endSec: 3.5, en: 'Hello.', zh: '你好。' }
    ]
  };

  const res = await fetch('/api/remotion/render', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ compositionId, outputName, inputProps })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || res.status);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let eventType = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        eventType = line.slice(7).trim();
        continue;
      }
      if (line.startsWith('data: ')) {
        const raw = line.slice(6).trim();
        if (eventType === 'log') {
          console.log(JSON.parse(raw));
        } else if (eventType === 'done') {
          const { outputUrl } = JSON.parse(raw);
          console.log('完成', outputUrl);
        } else if (eventType === 'error') {
          throw new Error(JSON.parse(raw));
        }
      }
    }
  }
}

// startRemotionRender('PromoVertical', 'promo.mp4');
