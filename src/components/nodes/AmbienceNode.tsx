import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CloudLightning, Droplets, Flame, Pause, Play, Snowflake, Volume2, Waves } from 'lucide-react';
import type { NodeContentProps } from './types';
import { isContentBlurPersistenceDisabled } from '../../config/persistence';
import { db } from '../../db';
import { AMBIENCE_SCENES, getAmbienceScene, type AmbienceIconId } from '../../data/ambienceCatalog';
import { getAmbienceMixer } from '../../services/ambienceMixer';
import {
  encodeAmbienceContent,
  parseAmbienceContentOrDefault,
  type AmbiencePayload,
} from '../../utils/ambiencePayload';

function useMixerSnapshot(nodeId: string) {
  const mixer = getAmbienceMixer(nodeId);
  const [, bump] = useState(0);
  useEffect(() => mixer.subscribe(() => bump((n) => n + 1)), [mixer]);
  return mixer;
}

/** Simple wagon / steam-train wheel (rim + hub + spokes). */
function WheelIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="2.25" />
      <path d="M12 3v6.75M12 14.25V21M3 12h6.75M14.25 12H21" />
      <path d="M6.2 6.2l4.2 4.2M13.6 13.6l4.2 4.2M17.8 6.2l-4.2 4.2M10.4 13.6l-4.2 4.2" />
    </svg>
  );
}

function SceneIcon({
  icon,
  className,
}: {
  icon: AmbienceIconId;
  className?: string;
}) {
  if (icon === 'waves') return <Waves className={className} aria-hidden />;
  if (icon === 'audio') return <CloudLightning className={className} aria-hidden />;
  if (icon === 'flame') return <Flame className={className} aria-hidden />;
  if (icon === 'snowflake') return <Snowflake className={className} aria-hidden />;
  if (icon === 'train') return <WheelIcon className={className} />;
  return <Droplets className={className} aria-hidden />;
}

const VIZ_BARS = [8, 14, 11, 18, 12, 7, 16, 10, 15, 9];

export function AmbienceNode({ node }: NodeContentProps) {
  const { t } = useTranslation();
  const mixer = useMixerSnapshot(node.id);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [payload, setPayload] = useState<AmbiencePayload>(() =>
    parseAmbienceContentOrDefault(node.content),
  );

  useEffect(() => {
    const next = parseAmbienceContentOrDefault(node.content);
    setPayload(next);
    mixer.applyState(next);
  }, [node.content, node.id, mixer]);

  useEffect(() => {
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
    };
  }, []);

  const schedulePersist = (next: AmbiencePayload) => {
    setPayload(next);
    mixer.applyState(next);
    if (isContentBlurPersistenceDisabled()) return;
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      void db.nodes.update(node.id, { content: encodeAmbienceContent(next) });
    }, 280);
  };

  const playing = mixer.isPlaying;
  const loading = mixer.isLoading;
  const streamError = mixer.lastError;
  const activeScene = getAmbienceScene(payload.trackId);
  const active = playing || loading;

  const togglePlay = async () => {
    if (playing || loading) {
      mixer.stop();
      return;
    }
    await mixer.play();
  };

  const selectTrack = async (trackId: string) => {
    const next = { ...payload, trackId };
    schedulePersist(next);
    if (!playing && !loading) {
      await mixer.play();
    }
  };

  return (
    <div
      className="w-full h-full bg-white shadow-[0_4px_20px_rgba(0,0,0,0.05),0_1px_3px_rgba(0,0,0,0.02)] border border-[#E6E4DF] flex flex-col overflow-hidden cursor-grab active:cursor-grabbing"
      data-testid="ambience-node"
      style={{ outline: '1px solid transparent' }}
    >
      {/* Compact drag strip + mini visualizer */}
      <div className="relative shrink-0 h-10 bg-[#F7F4F0] border-b border-[#E6E4DF] flex items-center justify-center overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.3] pointer-events-none"
          style={{
            backgroundImage:
              'radial-gradient(circle at 28% 40%, rgba(194,65,12,0.14), transparent 55%)',
          }}
          aria-hidden
        />
        <div
          className={`relative z-[1] flex items-end justify-center gap-[2px] h-5 ${
            active ? 'opacity-90' : 'opacity-40'
          }`}
          data-testid="ambience-visualizer"
          aria-hidden
        >
          {VIZ_BARS.map((h, i) => (
            <div
              key={i}
              className="w-[2px] rounded-full bg-[#C2410C] origin-bottom"
              style={{
                height: `${h}px`,
                animation: active
                  ? `ambience-bar ${0.8 + (i % 4) * 0.08}s ease-in-out ${i * 0.03}s infinite alternate`
                  : undefined,
                transform: active ? undefined : `scaleY(${0.35 + (i % 3) * 0.1})`,
              }}
            />
          ))}
        </div>
      </div>

      {/* Icon tabs + compact transport */}
      <div
        className="flex-1 min-h-0 flex flex-col px-2.5 pt-2 pb-2 gap-2 cursor-default"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div
          className="flex-1 min-h-0 grid grid-cols-3 gap-1.5 content-center"
          role="tablist"
          aria-label={t('ambience.playlist')}
          data-testid="ambience-playlist"
        >
          {AMBIENCE_SCENES.map((scene) => {
            const selected = scene.id === activeScene.id;
            return (
              <button
                key={scene.id}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-label={t(scene.titleKey)}
                title={t(scene.titleKey)}
                data-testid={`ambience-track-${scene.id}`}
                onClick={() => void selectTrack(scene.id)}
                className={`min-h-[44px] rounded-lg flex items-center justify-center transition-colors ${
                  selected
                    ? 'bg-[#C2410C]/12 text-[#C2410C]'
                    : 'text-[#b0ada6] hover:bg-[#F7F4F0] hover:text-[#8c8a84]'
                }`}
              >
                <SceneIcon icon={scene.icon} className="w-6 h-6" />
              </button>
            );
          })}
        </div>

        <div className="shrink-0 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void togglePlay()}
            data-testid="ambience-play"
            aria-label={active ? t('ambience.pause') : t('ambience.play')}
            title={
              streamError
                ? t('ambience.stream_error')
                : loading
                  ? t('ambience.buffering')
                  : playing
                    ? t('ambience.pause')
                    : t('ambience.play')
            }
            className="w-6 h-6 rounded-full bg-[#C2410C] text-white flex items-center justify-center shrink-0 hover:bg-[#a0350a] transition-colors"
          >
            {active ? (
              <Pause className="w-2.5 h-2.5 fill-current" />
            ) : (
              <Play className="w-2.5 h-2.5 fill-current ml-px" />
            )}
          </button>

          <Volume2 className="w-3 h-3 text-[#8c8a84] shrink-0" aria-hidden />
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={payload.muted ? 0 : payload.master}
            onChange={(e) => {
              const master = Number(e.target.value);
              schedulePersist({ ...payload, master, muted: master <= 0.001 });
            }}
            aria-label={t('ambience.master')}
            className="flex-1 min-w-0 accent-[#C2410C] h-1"
          />
        </div>

        {streamError ? (
          <p className="text-[9px] leading-snug text-[#a0350a]/90 text-center -mt-0.5" role="status">
            {t('ambience.stream_error')}
          </p>
        ) : null}
      </div>

      <style>{`
        @keyframes ambience-bar {
          from { transform: scaleY(0.35); opacity: 0.7; }
          to { transform: scaleY(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
