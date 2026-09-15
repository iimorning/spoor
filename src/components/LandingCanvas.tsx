import React, { useMemo, useState } from 'react';
import type { CanvasNode } from '../db';
import { NodeRenderer } from './nodes/NodeRenderer';
import hallwayImg from '../assets/landing/hallway.jpg';
import seaImg from '../assets/landing/sea.jpg';
import forestImg from '../assets/landing/forest.jpg';
import volcanoImg from '../assets/landing/volcano.jpg';
import {
  detectLandingAmbiance,
  type LandingAmbiance,
} from '../utils/landingAmbience';

/**
 * LandingCanvas — three real canvas cards (Note / Theme / Image).
 * The note is editable; theme keywords swap the image and signal ambiance.
 */

type Locale = 'en' | 'zh';

type Note = { body: string; placeholder: string };
type Theme = { title: string; description: string; tag: string };
type Image = { title: string };

const COPY: Record<
  Locale,
  {
    note: Note;
    theme: Theme;
    themeSea: Theme;
    themeForest: Theme;
    themeVolcano: Theme;
    image: Image;
    imageSea: Image;
    imageForest: Image;
    imageVolcano: Image;
  }
> = {
  en: {
    note: {
      body: '',
      placeholder: 'Write “sea”, “forest”, or “volcano”…',
    },
    theme: {
      title: 'Let thoughts grow freely',
      description:
        'A canvas without hierarchies — where thinking flows like water, and structure emerges on its own.',
      tag: 'Spatial Encoding',
    },
    themeSea: {
      title: 'Where the tide meets thought',
      description: 'Words about the sea pull the canvas toward shore — image and sound follow.',
      tag: 'Ambience',
    },
    themeForest: {
      title: 'Under the canopy of mind',
      description: 'Name the forest and the canvas fills with green hush — birdsong in the leaves.',
      tag: 'Ambience',
    },
    themeVolcano: {
      title: 'Heat at the edge of thought',
      description: 'Write of volcanoes and the canvas glows — magma and crackle rise together.',
      tag: 'Ambience',
    },
    image: {
      title: 'Study for the Grand Reading Room',
    },
    imageSea: {
      title: 'Shore study — waves at noon',
    },
    imageForest: {
      title: 'Forest study — light through leaves',
    },
    imageVolcano: {
      title: 'Volcano study — lava at dusk',
    },
  },
  zh: {
    note: {
      body: '',
      placeholder: '写下「海」「森林」或「火山」…',
    },
    theme: {
      title: '让念头自由生长',
      description: '没有层级的画布 — 让思维像水一样流动，结构自然浮现。',
      tag: '空间编码',
    },
    themeSea: {
      title: '潮水与念头相遇',
      description: '写到海，画布便靠岸——影像与声音随之而来。',
      tag: '氛围',
    },
    themeForest: {
      title: '林冠下的念头',
      description: '写到森林，画布便覆上绿荫——鸟鸣在叶间响起。',
      tag: '氛围',
    },
    themeVolcano: {
      title: '念头边缘的热度',
      description: '写到火山，画布便燃起——岩浆与噼啪声一同涌来。',
      tag: '氛围',
    },
    image: {
      title: '为「大阅览室」所作研究',
    },
    imageSea: {
      title: '海岸速写 — 正午的浪',
    },
    imageForest: {
      title: '林间速写 — 叶隙的光',
    },
    imageVolcano: {
      title: '火山速写 — 黄昏的熔岩',
    },
  },
};

const POSITIONS = [
  { top: '6%', left: '1%', width: '28%', height: '60%', rot: -2 },
  { top: '0%', left: '36%', width: '28%', height: '66%', rot: 1.5 },
  { top: '10%', left: '71%', width: '28%', height: '62%', rot: -1.5 },
];

const EDGE_1 = { x1: 29, y1: 36, x2: 36, y2: 50 };
const EDGE_2 = { x1: 64, y1: 52, x2: 71, y2: 38 };

const AMBIANCE_VISUALS = {
  default: {
    themeKey: 'theme' as const,
    imageKey: 'image' as const,
    imageSrc: hallwayImg,
  },
  sea: {
    themeKey: 'themeSea' as const,
    imageKey: 'imageSea' as const,
    imageSrc: seaImg,
  },
  forest: {
    themeKey: 'themeForest' as const,
    imageKey: 'imageForest' as const,
    imageSrc: forestImg,
  },
  volcano: {
    themeKey: 'themeVolcano' as const,
    imageKey: 'imageVolcano' as const,
    imageSrc: volcanoImg,
  },
};

type LandingCanvasProps = {
  locale: Locale;
  ambiance: LandingAmbiance;
  onAmbianceChange: (next: LandingAmbiance) => void;
  onUserGesture: () => void;
};

export function LandingCanvas({
  locale,
  ambiance,
  onAmbianceChange,
  onUserGesture,
}: LandingCanvasProps) {
  const copy = COPY[locale];
  const [noteText, setNoteText] = useState(copy.note.body);

  const visuals = AMBIANCE_VISUALS[ambiance];
  const theme = copy[visuals.themeKey];
  const imageMeta = copy[visuals.imageKey];

  const themeNode: CanvasNode = useMemo(
    () => ({
      id: 'demo-theme',
      type: 'theme',
      content: theme.title,
      description: theme.description,
      themeTag: theme.tag,
      layout: 0,
      x: 0,
      y: 0,
    }),
    [theme],
  );

  const imageLayers: { id: LandingAmbiance; src: string }[] = [
    { id: 'default', src: hallwayImg },
    { id: 'sea', src: seaImg },
    { id: 'forest', src: forestImg },
    { id: 'volcano', src: volcanoImg },
  ];

  const handleNoteChange = (value: string) => {
    setNoteText(value);
    onAmbianceChange(detectLandingAmbiance(value));
  };

  return (
    <div className="lp-canvas-row">
      <div
        className="lp-demo-card"
        style={
          {
            top: POSITIONS[0].top,
            left: POSITIONS[0].left,
            width: POSITIONS[0].width,
            height: POSITIONS[0].height,
            '--lp-rot': `${POSITIONS[0].rot}deg`,
          } as React.CSSProperties
        }
      >
        <div className="lp-demo-note note-surface-standard relative w-full h-full border-2 flex flex-col rounded-none p-5 bg-white border-[#E6E4DF] shadow-lg">
          <label className="sr-only" htmlFor="landing-demo-note">
            {copy.note.placeholder}
          </label>
          <textarea
            id="landing-demo-note"
            className="lp-demo-note-input flex-1 w-full resize-none bg-transparent border-none outline-none focus:ring-0 text-2xl font-serif leading-snug text-[#4a4a44] placeholder:text-[#8c8a84]"
            placeholder={copy.note.placeholder}
            value={noteText}
            onChange={(e) => handleNoteChange(e.target.value)}
            onFocus={onUserGesture}
            onPointerDown={onUserGesture}
          />
        </div>
      </div>

      <div
        className="lp-demo-card"
        style={
          {
            top: POSITIONS[1].top,
            left: POSITIONS[1].left,
            width: POSITIONS[1].width,
            height: POSITIONS[1].height,
            '--lp-rot': `${POSITIONS[1].rot}deg`,
          } as React.CSSProperties
        }
      >
        <NodeRenderer
          node={themeNode}
          editingNodeId={null}
          setEditingNodeId={() => {
            /* read-only */
          }}
          agentConfigs={[]}
          analyzingAgentNodeId={null}
        />
      </div>

      <div
        className="lp-demo-card"
        style={
          {
            top: POSITIONS[2].top,
            left: POSITIONS[2].left,
            width: POSITIONS[2].width,
            height: POSITIONS[2].height,
            '--lp-rot': `${POSITIONS[2].rot}deg`,
          } as React.CSSProperties
        }
      >
        <div
          className="w-full h-full bg-white p-2 shadow-lg border-2 border-[#E6E4DF] flex flex-col"
          style={{ outline: '1px solid transparent' }}
        >
          <div className="lp-demo-image-stack">
            {imageLayers.map((layer) => (
              <img
                key={layer.id}
                src={layer.src}
                alt=""
                className={ambiance === layer.id ? 'is-on' : undefined}
                draggable={false}
              />
            ))}
          </div>
          <p
            className="lp-demo-image-caption mt-1.5 min-w-0 px-0.5 text-[10px] font-sans text-[#8c8a84] truncate"
            title={imageMeta.title}
          >
            {imageMeta.title}
          </p>
        </div>
      </div>

      <svg
        className="lp-edges"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden
      >
        <line
          className="node-connector"
          x1={EDGE_1.x1}
          y1={EDGE_1.y1}
          x2={EDGE_1.x2}
          y2={EDGE_1.y2}
        />
        <line
          className="node-connector"
          x1={EDGE_2.x1}
          y1={EDGE_2.y1}
          x2={EDGE_2.x2}
          y2={EDGE_2.y2}
        />
      </svg>
    </div>
  );
}
