import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createRef } from 'react';
import { useCanvasInteraction } from '../../src/hooks/useCanvasInteraction';
import { CANVAS_VIEWPORTS_KEY } from '../../src/utils/canvasViewport';

describe('useCanvasInteraction', () => {
  let mainEl: HTMLDivElement;
  let contentEl: HTMLDivElement;

  beforeEach(() => {
    localStorage.removeItem(CANVAS_VIEWPORTS_KEY);
    mainEl = document.createElement('div');
    contentEl = document.createElement('div');
    vi.spyOn(mainEl, 'getBoundingClientRect').mockReturnValue({
      top: 0, left: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: () => {},
    });
    vi.spyOn(mainEl, 'addEventListener');
    vi.spyOn(mainEl, 'removeEventListener');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const setupHook = () => {
    const mainRef = { current: mainEl } as React.RefObject<HTMLDivElement | null>;
    const contentContainerRef = { current: contentEl } as React.RefObject<HTMLDivElement | null>;
    const svgRef = createRef<SVGSVGElement>() as React.RefObject<SVGSVGElement | null>;
    const edgeLabelsRef = createRef<HTMLDivElement>() as React.RefObject<HTMLDivElement | null>;
    const nodesRef = { current: {} } as React.RefObject<Record<string, HTMLElement | null>>;
    const setConnectingFrom = vi.fn();

    return renderHook(() =>
      useCanvasInteraction(
        mainRef,
        contentContainerRef,
        svgRef,
        edgeLabelsRef,
        nodesRef,
        null,
        setConnectingFrom,
        'test-canvas',
      ),
    );
  };

  it('初始 transform 为已保存视窗或默认 {x:0, y:0, scale:1}', () => {
    const { result } = setupHook();
    expect(result.current.canvasTransform).toEqual({ x: 0, y: 0, scale: 1 });
  });

  it('setCanvasTransform 更新 transform 并写入 DOM', () => {
    const { result } = setupHook();
    act(() => {
      result.current.setCanvasTransform({ x: 100, y: 200, scale: 1.5 });
    });
    expect(result.current.canvasTransform).toEqual({ x: 100, y: 200, scale: 1.5 });
    expect(contentEl.style.transform).toBe('translate(100px, 200px) scale(1.5)');
  });

  it('transformRef 同步更新', () => {
    const { result } = setupHook();
    act(() => {
      result.current.setCanvasTransform({ x: 50, y: 60, scale: 2 });
    });
    expect(result.current.transformRef.current).toEqual({ x: 50, y: 60, scale: 2 });
  });

  it('wheel 事件注册到 mainRef 元素', () => {
    setupHook();
    expect(mainEl.addEventListener).toHaveBeenCalledWith('wheel', expect.any(Function), { passive: false });
  });

  it('enabled 从 false→true 时把当前视口写回新的画布 DOM', () => {
    const mainRef = { current: mainEl } as React.RefObject<HTMLDivElement | null>;
    const contentContainerRef = { current: contentEl } as React.RefObject<HTMLDivElement | null>;
    const svgRef = createRef<SVGSVGElement>() as React.RefObject<SVGSVGElement | null>;
    const edgeLabelsRef = createRef<HTMLDivElement>() as React.RefObject<HTMLDivElement | null>;
    const nodesRef = { current: {} } as React.RefObject<Record<string, HTMLElement | null>>;
    const setConnectingFrom = vi.fn();

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useCanvasInteraction(
          mainRef,
          contentContainerRef,
          svgRef,
          edgeLabelsRef,
          nodesRef,
          null,
          setConnectingFrom,
          'test-canvas',
          enabled,
        ),
      { initialProps: { enabled: true } },
    );

    act(() => {
      result.current.setCanvasTransform({ x: -240, y: 80, scale: 1.4 });
    });
    expect(contentEl.style.transform).toBe('translate(-240px, 80px) scale(1.4)');

    rerender({ enabled: false });

    const remounted = document.createElement('div');
    contentContainerRef.current = remounted;

    rerender({ enabled: true });
    expect(remounted.style.transform).toBe('translate(-240px, 80px) scale(1.4)');
  });

  it('enabled=false 时不在 window 上拦截 Ctrl+滚轮（避免长文全屏里变成整页缩放）', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    renderHook(
      ({ enabled }: { enabled: boolean }) => {
        const mainRef = { current: mainEl } as React.RefObject<HTMLDivElement | null>;
        const contentContainerRef = { current: contentEl } as React.RefObject<HTMLDivElement | null>;
        const svgRef = createRef<SVGSVGElement>() as React.RefObject<SVGSVGElement | null>;
        const edgeLabelsRef = createRef<HTMLDivElement>() as React.RefObject<HTMLDivElement | null>;
        const nodesRef = { current: {} } as React.RefObject<Record<string, HTMLElement | null>>;
        return useCanvasInteraction(
          mainRef,
          contentContainerRef,
          svgRef,
          edgeLabelsRef,
          nodesRef,
          null,
          vi.fn(),
          'test-canvas',
          enabled,
        );
      },
      { initialProps: { enabled: false } },
    );
    const ctrlZoom = addSpy.mock.calls.find(
      (c) => c[0] === 'wheel' && (c[2] as AddEventListenerOptions | undefined)?.capture === true,
    );
    expect(ctrlZoom).toBeUndefined();
    addSpy.mockRestore();
  });

  it('画布节点换成新 main 后，window 捕获的 Ctrl+滚轮仍缩放画布而不是整页', () => {
    vi.useFakeTimers();
    const mainRef = { current: mainEl } as React.RefObject<HTMLDivElement | null>;
    const contentContainerRef = { current: contentEl } as React.RefObject<HTMLDivElement | null>;
    const svgRef = createRef<SVGSVGElement>() as React.RefObject<SVGSVGElement | null>;
    const edgeLabelsRef = createRef<HTMLDivElement>() as React.RefObject<HTMLDivElement | null>;
    const nodesRef = { current: {} } as React.RefObject<Record<string, HTMLElement | null>>;

    const { result } = renderHook(() =>
      useCanvasInteraction(
        mainRef,
        contentContainerRef,
        svgRef,
        edgeLabelsRef,
        nodesRef,
        null,
        vi.fn(),
        'test-canvas',
        true,
      ),
    );

    const remounted = document.createElement('div');
    vi.spyOn(remounted, 'getBoundingClientRect').mockReturnValue({
      top: 0, left: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: () => {},
    });
    document.body.appendChild(remounted);
    const inner = document.createElement('span');
    remounted.appendChild(inner);
    mainRef.current = remounted;

    const e = new WheelEvent('wheel', { deltaY: -40, bubbles: true, cancelable: true, ctrlKey: true });
    inner.dispatchEvent(e);

    expect(result.current.transformRef.current.scale).not.toBe(1);
    remounted.remove();
    vi.useRealTimers();
  });

  it('enabled 从 false→true 时会重新绑定 wheel 监听（避免切回画布后 Ctrl+滚轮变成整页缩放）', () => {
    const mainRef = { current: mainEl } as React.RefObject<HTMLDivElement | null>;
    const contentContainerRef = { current: contentEl } as React.RefObject<HTMLDivElement | null>;
    const svgRef = createRef<SVGSVGElement>() as React.RefObject<SVGSVGElement | null>;
    const edgeLabelsRef = createRef<HTMLDivElement>() as React.RefObject<HTMLDivElement | null>;
    const nodesRef = { current: {} } as React.RefObject<Record<string, HTMLElement | null>>;
    const setConnectingFrom = vi.fn();

    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useCanvasInteraction(
          mainRef,
          contentContainerRef,
          svgRef,
          edgeLabelsRef,
          nodesRef,
          null,
          setConnectingFrom,
          'test-canvas',
          enabled,
        ),
      { initialProps: { enabled: false } },
    );

    expect(mainEl.addEventListener).not.toHaveBeenCalledWith(
      'wheel',
      expect.any(Function),
      { passive: false },
    );

    rerender({ enabled: true });
    expect(mainEl.addEventListener).toHaveBeenCalledWith('wheel', expect.any(Function), { passive: false });
  });

  it('wheel 在仍可纵向滚动的子元素内时提前返回，不触发画布平移', () => {
    const { result } = setupHook();
    const wheelEntry = vi.mocked(mainEl.addEventListener).mock.calls.find((c) => c[0] === 'wheel');
    const onWheel = wheelEntry?.[1] as (e: WheelEvent) => void;
    expect(onWheel).toBeDefined();

    const scrollEl = document.createElement('div');
    const inner = document.createElement('span');
    scrollEl.appendChild(inner);
    mainEl.appendChild(scrollEl);

    Object.defineProperties(scrollEl, {
      scrollHeight: { get: () => 200, configurable: true },
      clientHeight: { get: () => 50, configurable: true },
      scrollTop: { get: () => 0, configurable: true },
    });

    const gcs = vi.spyOn(window, 'getComputedStyle').mockImplementation((elt: Element) => {
      if (elt === scrollEl) {
        return { overflowY: 'auto' } as unknown as CSSStyleDeclaration;
      }
      return { overflowY: 'visible' } as unknown as CSSStyleDeclaration;
    });

    const before = { ...result.current.canvasTransform };
    const e = new WheelEvent('wheel', { deltaY: 40, bubbles: true });
    Object.defineProperty(e, 'target', { value: inner, enumerable: true });

    act(() => {
      onWheel(e);
    });

    expect(result.current.canvasTransform).toEqual(before);
    gcs.mockRestore();
  });

  it('wheel 在 canvas overlay 内时不触发画布平移（含列表滚到边界）', () => {
    const { result } = setupHook();
    const wheelEntry = vi.mocked(mainEl.addEventListener).mock.calls.find((c) => c[0] === 'wheel');
    const onWheel = wheelEntry?.[1] as (e: WheelEvent) => void;
    expect(onWheel).toBeDefined();

    const overlay = document.createElement('div');
    overlay.setAttribute('data-canvas-overlay', '');
    const scrollEl = document.createElement('div');
    const inner = document.createElement('span');
    scrollEl.appendChild(inner);
    overlay.appendChild(scrollEl);
    mainEl.appendChild(overlay);

    Object.defineProperties(scrollEl, {
      scrollHeight: { get: () => 200, configurable: true },
      clientHeight: { get: () => 50, configurable: true },
      scrollTop: { get: () => 150, configurable: true },
    });

    const gcs = vi.spyOn(window, 'getComputedStyle').mockImplementation((elt: Element) => {
      if (elt === scrollEl) {
        return { overflowY: 'auto' } as unknown as CSSStyleDeclaration;
      }
      return { overflowY: 'visible' } as unknown as CSSStyleDeclaration;
    });

    const e = new WheelEvent('wheel', { deltaY: 40, bubbles: true });
    Object.defineProperty(e, 'target', { value: inner, enumerable: true });

    act(() => {
      onWheel(e);
    });

    expect(result.current.transformRef.current).toEqual({ x: 0, y: 0, scale: 1 });
    gcs.mockRestore();
  });

  it('wheel 在可滚动子元素已触底时仍不触发画布平移（避免穿透滚动）', () => {
    const { result } = setupHook();
    const wheelEntry = vi.mocked(mainEl.addEventListener).mock.calls.find((c) => c[0] === 'wheel');
    const onWheel = wheelEntry?.[1] as (e: WheelEvent) => void;
    expect(onWheel).toBeDefined();

    const scrollEl = document.createElement('div');
    const inner = document.createElement('span');
    scrollEl.appendChild(inner);
    mainEl.appendChild(scrollEl);

    Object.defineProperties(scrollEl, {
      scrollHeight: { get: () => 200, configurable: true },
      clientHeight: { get: () => 50, configurable: true },
      // 已滚到底：scrollTop + clientHeight >= scrollHeight - 1
      scrollTop: { get: () => 150, configurable: true },
    });

    const gcs = vi.spyOn(window, 'getComputedStyle').mockImplementation((elt: Element) => {
      if (elt === scrollEl) {
        return { overflowY: 'auto' } as unknown as CSSStyleDeclaration;
      }
      return { overflowY: 'visible' } as unknown as CSSStyleDeclaration;
    });

    const e = new WheelEvent('wheel', { deltaY: 40, bubbles: true });
    Object.defineProperty(e, 'target', { value: inner, enumerable: true });

    act(() => {
      onWheel(e);
    });

    expect(result.current.transformRef.current).toEqual({ x: 0, y: 0, scale: 1 });
    gcs.mockRestore();
  });

  it('wheel 在可滚动子元素已触底时，第二次溢出才平移画布', () => {
    const { result } = setupHook();
    const wheelEntry = vi.mocked(mainEl.addEventListener).mock.calls.find((c) => c[0] === 'wheel');
    const onWheel = wheelEntry?.[1] as (e: WheelEvent) => void;

    const scrollEl = document.createElement('div');
    const inner = document.createElement('span');
    scrollEl.appendChild(inner);
    mainEl.appendChild(scrollEl);

    Object.defineProperties(scrollEl, {
      scrollHeight: { get: () => 200, configurable: true },
      clientHeight: { get: () => 50, configurable: true },
      scrollTop: { get: () => 150, configurable: true },
    });

    const gcs = vi.spyOn(window, 'getComputedStyle').mockImplementation((elt: Element) => {
      if (elt === scrollEl) {
        return { overflowY: 'auto' } as unknown as CSSStyleDeclaration;
      }
      return { overflowY: 'visible' } as unknown as CSSStyleDeclaration;
    });

    const first = new WheelEvent('wheel', { deltaY: 40, bubbles: true });
    Object.defineProperty(first, 'target', { value: inner, enumerable: true });
    const second = new WheelEvent('wheel', { deltaY: 40, bubbles: true });
    Object.defineProperty(second, 'target', { value: inner, enumerable: true });

    act(() => {
      onWheel(first);
      onWheel(second);
    });

    expect(result.current.transformRef.current).toEqual({ x: 0, y: -40, scale: 1 });
    gcs.mockRestore();
  });

  it('wheel 在可滚动子元素已触顶时仍不触发画布平移', () => {
    const { result } = setupHook();
    const wheelEntry = vi.mocked(mainEl.addEventListener).mock.calls.find((c) => c[0] === 'wheel');
    const onWheel = wheelEntry?.[1] as (e: WheelEvent) => void;

    const scrollEl = document.createElement('div');
    const inner = document.createElement('span');
    scrollEl.appendChild(inner);
    mainEl.appendChild(scrollEl);

    Object.defineProperties(scrollEl, {
      scrollHeight: { get: () => 200, configurable: true },
      clientHeight: { get: () => 50, configurable: true },
      scrollTop: { get: () => 0, configurable: true },
    });

    const gcs = vi.spyOn(window, 'getComputedStyle').mockImplementation((elt: Element) => {
      if (elt === scrollEl) {
        return { overflowY: 'auto' } as unknown as CSSStyleDeclaration;
      }
      return { overflowY: 'visible' } as unknown as CSSStyleDeclaration;
    });

    const e = new WheelEvent('wheel', { deltaY: -40, bubbles: true });
    Object.defineProperty(e, 'target', { value: inner, enumerable: true });

    act(() => {
      onWheel(e);
    });

    expect(result.current.transformRef.current).toEqual({ x: 0, y: 0, scale: 1 });
    gcs.mockRestore();
  });

  it('编辑锁（data-canvas-edit-lock）：滚轮被锁在容器内，画布不被平移', () => {
    const { result } = setupHook();
    const wheelEntry = vi.mocked(mainEl.addEventListener).mock.calls.find((c) => c[0] === 'wheel');
    const onWheel = wheelEntry?.[1] as (e: WheelEvent) => void;
    expect(onWheel).toBeDefined();

    const lockEl = document.createElement('div');
    lockEl.setAttribute('data-canvas-edit-lock', '');
    const inner = document.createElement('span');
    lockEl.appendChild(inner);
    mainEl.appendChild(lockEl);

    const e = new WheelEvent('wheel', { deltaY: 40, bubbles: true });
    Object.defineProperty(e, 'target', { value: inner, enumerable: true });

    act(() => {
      onWheel(e);
    });

    expect(result.current.transformRef.current).toEqual({ x: 0, y: 0, scale: 1 });
    expect(contentEl.style.transform).toBe('translate(0px, 0px) scale(1)');
  });

  it('对照：无编辑锁、无可滚动子元素时，滚轮正常平移画布', () => {
    const { result } = setupHook();
    const wheelEntry = vi.mocked(mainEl.addEventListener).mock.calls.find((c) => c[0] === 'wheel');
    const onWheel = wheelEntry?.[1] as (e: WheelEvent) => void;

    const inner = document.createElement('span');
    mainEl.appendChild(inner);

    const e = new WheelEvent('wheel', { deltaY: 40, bubbles: true });
    Object.defineProperty(e, 'target', { value: inner, enumerable: true });

    act(() => {
      onWheel(e);
    });

    // y' = prev.y - deltaY → 向下滚 = 画布向下平移（world 坐标减）
    expect(result.current.transformRef.current).toEqual({ x: 0, y: -40, scale: 1 });
    expect(contentEl.style.transform).toBe('translate(0px, -40px) scale(1)');
  });

  it('在可滚动区域内按住 Ctrl 滚轮仍可缩放画布（热路径写 DOM/ref，debounce 后 commit state）', () => {
    vi.useFakeTimers();
    const { result } = setupHook();
    const wheelEntry = vi.mocked(mainEl.addEventListener).mock.calls.find((c) => c[0] === 'wheel');
    const onWheel = wheelEntry?.[1] as (e: WheelEvent) => void;

    const scrollEl = document.createElement('div');
    const inner = document.createElement('span');
    scrollEl.appendChild(inner);
    mainEl.appendChild(scrollEl);

    Object.defineProperties(scrollEl, {
      scrollHeight: { get: () => 200, configurable: true },
      clientHeight: { get: () => 50, configurable: true },
      scrollTop: { get: () => 150, configurable: true },
    });

    const gcs = vi.spyOn(window, 'getComputedStyle').mockImplementation((elt: Element) => {
      if (elt === scrollEl) {
        return { overflowY: 'auto' } as unknown as CSSStyleDeclaration;
      }
      return { overflowY: 'visible' } as unknown as CSSStyleDeclaration;
    });

    const e = new WheelEvent('wheel', { deltaY: -40, bubbles: true, ctrlKey: true });
    Object.defineProperty(e, 'target', { value: inner, enumerable: true });

    act(() => {
      onWheel(e);
    });

    // Immediate: ref + DOM updated; React state still at previous until debounce.
    expect(result.current.transformRef.current.scale).not.toBe(1);
    expect(contentEl.style.transform).toContain(`scale(${result.current.transformRef.current.scale})`);
    expect(result.current.canvasTransform.scale).toBe(1);

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current.canvasTransform.scale).toBe(result.current.transformRef.current.scale);
    gcs.mockRestore();
  });

  it('handlePanStart：move 只写 DOM，pointerup 再 commit React state', () => {
    const { result } = setupHook();
    const listeners = new Map<string, EventListener>();
    const addSpy = vi.spyOn(window, 'addEventListener').mockImplementation((type, listener) => {
      listeners.set(type, listener as EventListener);
    });
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const mockPointerDown = {
      target: mainEl,
      currentTarget: mainEl,
      button: 0,
      clientX: 100,
      clientY: 100,
      preventDefault: vi.fn(),
    } as unknown as React.PointerEvent;

    act(() => {
      result.current.handlePanStart(mockPointerDown);
    });

    expect(mockPointerDown.preventDefault).toHaveBeenCalled();
    expect(addSpy).toHaveBeenCalledWith('pointermove', expect.any(Function));
    expect(addSpy).toHaveBeenCalledWith('pointerup', expect.any(Function));

    const onMove = listeners.get('pointermove')!;
    act(() => {
      onMove(new PointerEvent('pointermove', { clientX: 140, clientY: 130 }));
    });

    expect(result.current.transformRef.current).toEqual({ x: 40, y: 30, scale: 1 });
    expect(contentEl.style.transform).toBe('translate(40px, 30px) scale(1)');
    expect(result.current.canvasTransform).toEqual({ x: 0, y: 0, scale: 1 });

    const onUp = listeners.get('pointerup')!;
    act(() => {
      onUp(new PointerEvent('pointerup'));
    });

    expect(result.current.canvasTransform).toEqual({ x: 40, y: 30, scale: 1 });
    expect(removeSpy).toHaveBeenCalledWith('pointermove', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('pointerup', expect.any(Function));
  });

  it('连线虚影随鼠标在 rAF 上写 transform，不改 left/top', async () => {
    const ghost = document.createElement('div');
    ghost.style.left = '0px';
    ghost.style.top = '0px';
    contentEl.appendChild(ghost);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('data-connecting-from', 'n1');
    const tempEdge = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    tempEdge.id = 'temp-edge';
    svg.appendChild(tempEdge);

    const fromNode = document.createElement('div');
    Object.defineProperties(fromNode, {
      offsetLeft: { get: () => 0 },
      offsetTop: { get: () => 0 },
      offsetWidth: { get: () => 100 },
      offsetHeight: { get: () => 80 },
      offsetParent: { get: () => contentEl },
    });

    vi.spyOn(contentEl, 'getBoundingClientRect').mockReturnValue({
      top: 0, left: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: () => {},
    });

    const mainRef = { current: mainEl } as React.RefObject<HTMLDivElement | null>;
    const contentContainerRef = { current: contentEl } as React.RefObject<HTMLDivElement | null>;
    const svgRef = { current: svg } as React.RefObject<SVGSVGElement | null>;
    const edgeLabelsRef = { current: null } as React.RefObject<HTMLDivElement | null>;
    const nodesRef = { current: { n1: fromNode } } as React.RefObject<Record<string, HTMLElement | null>>;
    const ghostRef = { current: ghost } as React.RefObject<HTMLDivElement | null>;

    renderHook(() =>
      useCanvasInteraction(
        mainRef,
        contentContainerRef,
        svgRef,
        edgeLabelsRef,
        nodesRef,
        'n1',
        vi.fn(),
        'test-canvas',
        true,
        ghostRef,
      ),
    );

    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 400, clientY: 300 }));

    await vi.waitFor(() => {
      expect(ghost.style.transform).toContain('translate3d(400px, 300px');
    });
    expect(ghost.style.left).toBe('0px');
    expect(ghost.style.top).toBe('0px');
  });
});
