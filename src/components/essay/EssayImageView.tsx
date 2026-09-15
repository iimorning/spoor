import React, { useCallback, useContext, useRef, useState } from 'react';
import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import { articleMediaIdFromUrl } from '../../utils/articleMedia';
import { essayUrlTransform } from '../../utils/essayUrlTransform';
import { EssayMediaUrlsContext } from './essayMediaUrlsContext';
import { ESSAY_IMAGE_HTML_CLASS } from '../../utils/essayEditorMarkdown';

const MIN_IMAGE_WIDTH = 96;
const RESIZE_HANDLES = ['nw', 'ne', 'sw', 'se'] as const;
type ResizeHandle = (typeof RESIZE_HANDLES)[number];

function parsePixelAttr(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }
  if (typeof value === 'string') {
    const parsed = parseInt(value.replace(/px$/i, ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function signedResizeDelta(handle: ResizeHandle, dx: number, dy: number) {
  switch (handle) {
    case 'se':
      return { dw: dx, dh: dy };
    case 'sw':
      return { dw: -dx, dh: dy };
    case 'ne':
      return { dw: dx, dh: -dy };
    case 'nw':
      return { dw: -dx, dh: -dy };
  }
}

function scaledSize(
  start: { width: number; height: number },
  handle: ResizeHandle,
  dx: number,
  dy: number,
): { width: number; height: number } {
  const { dw, dh } = signedResizeDelta(handle, dx, dy);
  const aspect = start.width / start.height;
  const scaleW = (start.width + dw) / start.width;
  const scaleH = (start.height + dh) / start.height;
  const scale = Math.max(scaleW, scaleH);
  const width = Math.max(MIN_IMAGE_WIDTH, Math.round(start.width * scale));
  const height = Math.max(1, Math.round(width / aspect));
  return { width, height };
}

export function EssayImageView(props: ReactNodeViewProps) {
  const { node, selected, updateAttributes, getPos, editor } = props;
  const urls = useContext(EssayMediaUrlsContext);
  const imgRef = useRef<HTMLImageElement>(null);
  const [liveSize, setLiveSize] = useState<{ width: number; height: number } | null>(null);

  const src = String(node.attrs.src ?? '');
  const alt = String(node.attrs.alt ?? '');
  const mediaId = articleMediaIdFromUrl(src);
  const resolved = mediaId ? urls[mediaId] : essayUrlTransform(src);
  const storedWidth = parsePixelAttr(node.attrs.width);
  const storedHeight = parsePixelAttr(node.attrs.height);

  const getBaseSize = useCallback(() => {
    if (storedWidth && storedHeight) {
      return { width: storedWidth, height: storedHeight };
    }
    if (storedWidth && imgRef.current?.naturalWidth) {
      const ratio = imgRef.current.naturalHeight / imgRef.current.naturalWidth;
      return { width: storedWidth, height: Math.round(storedWidth * ratio) };
    }
    const el = imgRef.current;
    if (el && el.clientWidth > 0 && el.clientHeight > 0) {
      return { width: el.clientWidth, height: el.clientHeight };
    }
    if (el && el.naturalWidth > 0 && el.naturalHeight > 0) {
      return { width: el.naturalWidth, height: el.naturalHeight };
    }
    return { width: 320, height: 240 };
  }, [storedHeight, storedWidth]);

  const selectImage = useCallback(() => {
    const pos = getPos();
    if (typeof pos !== 'number') return;
    editor.chain().focus().setNodeSelection(pos).run();
  }, [editor, getPos]);

  const onResizePointerDown = (handle: ResizeHandle) => (event: React.PointerEvent<HTMLSpanElement>) => {
    event.preventDefault();
    event.stopPropagation();
    selectImage();

    const start = getBaseSize();
    const originX = event.clientX;
    const originY = event.clientY;
    const target = event.currentTarget;

    const onMove = (ev: PointerEvent) => {
      setLiveSize(scaledSize(start, handle, ev.clientX - originX, ev.clientY - originY));
    };

    const onUp = (ev: PointerEvent) => {
      target.releasePointerCapture(ev.pointerId);
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
      const next = scaledSize(start, handle, ev.clientX - originX, ev.clientY - originY);
      setLiveSize(null);
      updateAttributes({ width: next.width, height: next.height });
    };

    target.setPointerCapture(event.pointerId);
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  };

  const displayWidth = liveSize?.width ?? storedWidth ?? undefined;
  const displayHeight = liveSize?.height ?? storedHeight ?? undefined;
  const sized = Boolean(displayWidth && displayHeight);

  return (
    <NodeViewWrapper
      as="div"
      className={`essay-editor-image${selected ? ' essay-editor-image--selected' : ''}`}
      data-drag-handle=""
    >
      <div
        className="essay-editor-image__frame"
        style={sized ? { width: displayWidth, height: displayHeight } : undefined}
        onClick={selectImage}
      >
        {mediaId && !resolved ? (
          <span className="text-sm text-[#8c8a84]">…</span>
        ) : resolved ? (
          <img
            ref={imgRef}
            src={resolved}
            alt={alt}
            draggable={false}
            className={sized ? 'essay-editor-image__img essay-editor-image__img--sized' : ESSAY_IMAGE_HTML_CLASS}
            style={sized ? { width: '100%', height: '100%' } : undefined}
          />
        ) : null}
        {selected && resolved ? (
          RESIZE_HANDLES.map((handle) => (
            <span
              key={handle}
              role="presentation"
              aria-hidden
              className={`essay-editor-image__handle essay-editor-image__handle--${handle}`}
              onPointerDown={onResizePointerDown(handle)}
            />
          ))
        ) : null}
      </div>
    </NodeViewWrapper>
  );
}
