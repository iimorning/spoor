import React, { type RefObject } from 'react';
import { createPortal } from 'react-dom';

export function TextSelectionToolbar({
  top,
  left,
  toolbarRef,
  onArm,
  onDisarm,
  children,
  placement = 'absolute',
  portalHost,
  zClassName,
}: {
  top: number;
  left: number;
  toolbarRef: RefObject<HTMLDivElement | null>;
  onArm: () => void;
  onDisarm: () => void;
  children: React.ReactNode;
  placement?: 'absolute' | 'fixed';
  /** When set, fixed toolbars portal here instead of `document.body`. */
  portalHost?: HTMLElement | null;
  zClassName?: string;
}) {
  const layerClass =
    zClassName ?? (placement === 'fixed' ? 'z-[80]' : 'z-20');
  const node = (
    <div
      ref={toolbarRef}
      data-testid="text-selection-toolbar"
      className={`${placement === 'fixed' ? `fixed ${layerClass}` : `absolute ${layerClass}`} flex items-center gap-1 p-0.5 rounded-lg bg-white border border-[#E6E4DF] shadow-md`}
      style={{ top, left }}
      data-no-drag=""
      onPointerDown={(e) => {
        // Keep selection; note: preventDefault suppresses mouse* events, so actions use pointerup.
        e.stopPropagation();
        e.preventDefault();
        onArm();
      }}
      onPointerUp={(e) => {
        e.stopPropagation();
        onDisarm();
      }}
      onPointerCancel={() => {
        onDisarm();
      }}
    >
      {children}
    </div>
  );
  if (placement === 'fixed' && typeof document !== 'undefined') {
    const host = portalHost ?? document.body;
    return createPortal(node, host);
  }
  return node;
}

export function TextSelectionToolbarButton({
  variant,
  onAction,
  onArm,
  children,
}: {
  variant: 'primary' | 'ghost';
  onAction: () => void;
  onArm: () => void;
  children: React.ReactNode;
}) {
  const className =
    variant === 'primary'
      ? 'flex items-center gap-1 px-2 py-1 rounded-md bg-[#C2410C] text-white text-[11px] font-sans font-bold hover:bg-[#a0350a] transition-colors'
      : 'flex items-center gap-1 px-2 py-1 rounded-md text-[#C2410C] text-[11px] font-sans font-bold hover:bg-[#FFF7ED] transition-colors';
  return (
    <button
      type="button"
      className={className}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onArm();
      }}
      onPointerUp={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onAction();
      }}
    >
      {children}
    </button>
  );
}
