const INK = '80, 78, 72';

export type WorkZoneRegionPaint = {
  fill: string;
  stroke: string;
  strokeWidth: number;
  strokeDasharray?: string;
  rx: number;
  ry: number;
  labelFill: string;
  handleStroke: string;
};

/** Dashed hollow rectangle at the current canvas scale. */
export function workZoneRegionPaint(opts: {
  selected: boolean;
  draft: boolean;
  scale: number;
}): WorkZoneRegionPaint {
  const s = opts.scale > 0 ? opts.scale : 1;
  const strokeOpacity = opts.draft ? 0.32 : opts.selected ? 0.42 : 0.26;
  return {
    fill: 'none',
    stroke: `rgba(${INK}, ${strokeOpacity})`,
    strokeWidth: 1.5 / s,
    strokeDasharray: `${8 / s} ${6 / s}`,
    rx: 0,
    ry: 0,
    labelFill: `rgba(${INK}, 0.55)`,
    handleStroke: `rgba(${INK}, 0.5)`,
  };
}
