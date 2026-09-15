import type { CanvasWorkZone } from '../../db';
import type { CanvasRect } from '../../utils/canvas';
import { workZoneRegionPaint } from '../../utils/workZoneRegionPaint';
import {
  WORK_ZONE_RESIZE_HANDLES,
  workZoneHandleCenters,
  workZoneHandleSizeWorld,
} from '../../utils/workZoneGeometry';

type WorkZoneRegionsLayerProps = {
  zones: CanvasWorkZone[];
  scale: number;
  draftRect?: CanvasRect | null;
  selectedZoneId?: string | null;
  zoneLabel: (zone: CanvasWorkZone) => string;
  onSelectZone?: (zoneId: string) => void;
  showResizeHandles?: boolean;
  resizePreview?: { id: string; rect: CanvasRect } | null;
};

export function WorkZoneRegionsLayer({
  zones,
  scale,
  draftRect,
  selectedZoneId,
  zoneLabel,
  onSelectZone,
  showResizeHandles = false,
  resizePreview = null,
}: WorkZoneRegionsLayerProps) {
  const safeScale = scale > 0 ? scale : 1;
  const labelSize = 11 / safeScale;
  const handleSize = workZoneHandleSizeWorld(safeScale);

  const renderRect = (
    rect: CanvasRect,
    key: string,
    opts: {
      zoneId?: string;
      label?: string;
      selected?: boolean;
      draft?: boolean;
    },
  ) => {
    const selected = opts.selected ?? false;
    const draft = opts.draft ?? false;
    const paint = workZoneRegionPaint({ selected, draft, scale: safeScale });
    const centers = workZoneHandleCenters(rect);
    return (
      <g key={key} data-testid={draft ? 'work-zone-draft' : `work-zone-${opts.zoneId}`}>
        <rect
          x={rect.x}
          y={rect.y}
          width={rect.width}
          height={rect.height}
          rx={paint.rx}
          ry={paint.ry}
          fill={paint.fill}
          stroke={paint.stroke}
          strokeWidth={paint.strokeWidth}
          strokeDasharray={paint.strokeDasharray}
          pointerEvents="none"
        />
        {opts.zoneId && onSelectZone && !draft && !showResizeHandles ? (
          <rect
            x={rect.x}
            y={rect.y}
            width={rect.width}
            height={Math.min(28 / safeScale, rect.height)}
            fill="transparent"
            className="pointer-events-auto cursor-pointer"
            data-testid={`work-zone-select-${opts.zoneId}`}
            onPointerDown={(e) => {
              e.stopPropagation();
              onSelectZone(opts.zoneId!);
            }}
          />
        ) : null}
        {opts.label && !draft ? (
          <text
            x={rect.x + 8 / safeScale}
            y={rect.y + 16 / safeScale}
            fill={paint.labelFill}
            fontSize={labelSize}
            fontFamily="ui-sans-serif, system-ui, sans-serif"
            fontWeight={600}
            pointerEvents="none"
          >
            {opts.label}
          </text>
        ) : null}
        {showResizeHandles && !draft
          ? WORK_ZONE_RESIZE_HANDLES.map((handle) => {
              const center = centers[handle];
              return (
                <rect
                  key={handle}
                  data-testid={opts.zoneId ? `work-zone-handle-${opts.zoneId}-${handle}` : undefined}
                  x={center.x - handleSize / 2}
                  y={center.y - handleSize / 2}
                  width={handleSize}
                  height={handleSize}
                  fill="#fff"
                  stroke={paint.handleStroke}
                  strokeWidth={1.5 / safeScale}
                  pointerEvents="none"
                />
              );
            })
          : null}
      </g>
    );
  };

  return (
    <svg
      className="absolute inset-0 z-[5] overflow-visible pointer-events-none"
      aria-hidden={zones.length === 0 && !draftRect}
      data-testid="work-zone-regions-layer"
    >
      {zones.map((zone) => {
        const preview = resizePreview?.id === zone.id ? resizePreview.rect : zone;
        return renderRect(preview, zone.id, {
          zoneId: zone.id,
          label: zoneLabel(zone),
          selected: selectedZoneId === zone.id,
        });
      })}
      {draftRect ? renderRect(draftRect, 'draft', { draft: true }) : null}
    </svg>
  );
}
