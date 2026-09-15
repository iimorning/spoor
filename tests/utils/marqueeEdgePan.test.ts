import { describe, it, expect } from 'vitest';
import {
  clientToWorld,
  isNearMarqueeEdge,
  marqueeEdgePanDelta,
  marqueeScreenRect,
  worldToViewport,
} from '../../src/utils/marqueeEdgePan';

describe('clientToWorld / worldToViewport', () => {
  it('往返换算在平移和缩放后仍对齐', () => {
    const transform = { x: 40, y: -80, scale: 0.5 };
    const world = clientToWorld(120, 200, 10, 20, transform);
    const screen = worldToViewport(world.x, world.y, transform);
    expect(screen.x).toBeCloseTo(120 - 10);
    expect(screen.y).toBeCloseTo(200 - 20);
  });
});

describe('marqueeScreenRect', () => {
  it('起点钉在世界坐标：平移画布后框会跟着起点变长', () => {
    const start = clientToWorld(200, 400, 0, 0, { x: 0, y: 0, scale: 1 });
    const before = marqueeScreenRect({
      startWorldX: start.x,
      startWorldY: start.y,
      clientX: 200,
      clientY: 20,
      viewportLeft: 0,
      viewportTop: 0,
      transform: { x: 0, y: 0, scale: 1 },
    });
    expect(before.height).toBe(380);

    const after = marqueeScreenRect({
      startWorldX: start.x,
      startWorldY: start.y,
      clientX: 200,
      clientY: 20,
      viewportLeft: 0,
      viewportTop: 0,
      transform: { x: 0, y: 80, scale: 1 },
    });
    expect(after.height).toBe(460);
    expect(after.y).toBe(20);
  });
});

describe('isNearMarqueeEdge / marqueeEdgePanDelta', () => {
  const viewport = { width: 800, height: 600 };

  it('视口中心不贴边、不产生位移', () => {
    expect(isNearMarqueeEdge(400, 300, viewport.width, viewport.height)).toBe(false);
    expect(
      marqueeEdgePanDelta({
        localX: 400,
        localY: 300,
        width: viewport.width,
        height: viewport.height,
        dtMs: 16,
      }),
    ).toEqual({ x: 0, y: 0 });
  });

  it('贴上沿时 transform.y 增加，把上方内容拉进视口', () => {
    expect(isNearMarqueeEdge(400, 8, viewport.width, viewport.height)).toBe(true);
    const delta = marqueeEdgePanDelta({
      localX: 400,
      localY: 0,
      width: viewport.width,
      height: viewport.height,
      dtMs: 16,
    });
    expect(delta.x).toBe(0);
    expect(delta.y).toBeGreaterThan(0);
  });

  it('指针越出上沿时速度封顶', () => {
    const onEdge = marqueeEdgePanDelta({
      localX: 400,
      localY: 0,
      width: viewport.width,
      height: viewport.height,
      dtMs: 10,
      maxSpeed: 1,
    });
    const pastEdge = marqueeEdgePanDelta({
      localX: 400,
      localY: -40,
      width: viewport.width,
      height: viewport.height,
      dtMs: 10,
      maxSpeed: 1,
    });
    expect(onEdge.y).toBe(10);
    expect(pastEdge.y).toBe(10);
  });
});
