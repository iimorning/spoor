import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { MessagesSquare } from 'lucide-react';
import { db } from '../db';
import { buildAskPersona } from '../utils/askPersona';
import { ChatRoomParticipants } from './canvas/ChatRoomParticipants';
import {
  addSurfacePersona,
  buildSurfaceRoomParticipants,
  hasSurfaceGuestVoices,
  listSurfaceLibraryCandidates,
  removeSurfacePersona,
  surfaceAnswerer,
  SURFACE_ROOM_MAX_PARTICIPANTS,
  toggleSurfacePersonaMuted,
  type SurfaceRoomState,
} from '../utils/surfacePersonaRoom';

export interface SurfacePersonaStripProps {
  room: SurfaceRoomState;
  onRoomChange: (room: SurfaceRoomState) => void;
  disabled?: boolean;
  /** 让房间里除答话者以外的人依次接一句。没人可接时按钮不出现。 */
  onDiscuss?: () => void;
  discussing?: boolean;
  /**
   * 「历史 / 新建」两颗按钮的空位。
   *
   * 它们由 ChatPanel 自己拥有（翻哪段历史、新建前的确认都在它那边），这里只给一个
   * 容器让它 portal 进来。曾经这两颗按钮挂在顶栏对话按钮的悬停浮层里，但那意味着
   * 它们和房间里的人在两个地方——现在和它们的对象并排放在同一行右边。
   */
  controlsHostRef?: (node: HTMLElement | null) => void;
}

/**
 * 侧栏顶部的角色条。
 *
 * 直接复用画布那间房的邀请菜单（`ChatRoomParticipants`）——它只认一个标识符和一个名字，
 * "画布上的角色"那一组在这里传空数组：书和长文是打开着的全屏面板，不存在"这个角色在
 * 不在这张画布上"这个问题，角色库就是全部候选。
 *
 * 徽章（主持）跟着这一轮真正答话的人走，所以 `hostNodeId` 要传当前答话者而不是名单首位；
 * `titledNodeId` 故意传空串——画布那边主角是占着面板标题的、所以要从 chip 里滤掉，
 * 而这里没有标题行，所有人（包括答话的那个）都得露出来。
 */
export function SurfacePersonaStrip({
  room,
  onRoomChange,
  disabled = false,
  onDiscuss,
  discussing = false,
  controlsHostRef,
}: SurfacePersonaStripProps) {
  const { t } = useTranslation();
  // undefined = 还在查，别和"角色库本来就是空的"混为一谈：查的过程中先画一条空条子，
  // 会在每次打开全屏时闪一下。
  const agentsQuery = useLiveQuery(() => db.agents.toArray(), []);
  const agents = agentsQuery ?? [];

  // 阿狸常驻主持：这条栏永远至少有他一个 chip，不选任何角色时就是他一个人。
  const askPersona = useMemo(() => buildAskPersona(t), [t]);
  const participants = useMemo(
    () => buildSurfaceRoomParticipants(room, agents, askPersona),
    [room, agents, askPersona],
  );
  const answerer = useMemo(
    () => surfaceAnswerer(room, agents, askPersona),
    [room, agents, askPersona],
  );
  const libraryCandidates = useMemo(
    () => listSurfaceLibraryCandidates(room, agents),
    [room, agents],
  );
  const canDiscuss = hasSurfaceGuestVoices(room, agents);

  if (!agentsQuery) return null;
  // 房里没人、也没有人可邀：整块不渲染。只剩一条空边框的话看上去像出了故障，
  // 而角色库为空本来就是合法的起点（用户还没建过任何角色）。
  if (participants.length === 0 && libraryCandidates.length === 0) return null;

  return (
    <div
      data-testid="surface-persona-strip"
      className="flex h-9 shrink-0 items-center gap-2 border-b border-[#E6E4DF]/70 px-3"
    >
      <ChatRoomParticipants
        participants={participants}
        hostNodeId={answerer?.id ?? ''}
        titledNodeId=""
        candidates={[]}
        libraryCandidates={libraryCandidates}
        // 菜单内部按 `participants.length - 1 >= maxParticipants` 算满员，也就是它把
        // 主持人当成不占名额的常驻那位。这边人人平等、总数封顶 3，所以传 2。
        maxParticipants={SURFACE_ROOM_MAX_PARTICIPANTS - 1}
        disabled={disabled || discussing}
        // 阿狸本来就有自己的红点标识，这里再挂一颗"谁在说话"的灯和一枚「主持」，
        // 是同一个信息说两遍。
        hideCastIndicators
        onAddFromLibrary={(id) => onRoomChange(addSurfacePersona(room, id))}
        onRemove={(id) => onRoomChange(removeSurfacePersona(room, id))}
        onToggleMuted={(id) => onRoomChange(toggleSurfacePersonaMuted(room, id))}
      />
      {/* 右边：先"让他们都说说"，再是历史 / 新建。历史和新建贴在最右，符合它是
          "这一栏的其它入口"而不是房间里的一员。 */}
      {onDiscuss && canDiscuss ? (
        <button
          type="button"
          data-testid="surface-persona-discuss"
          disabled={disabled || discussing}
          onClick={onDiscuss}
          title={discussing ? t('reference.persona_room_discussing') : t('reference.persona_room_discuss')}
          aria-label={discussing ? t('reference.persona_room_discussing') : t('reference.persona_room_discuss')}
          className="ml-auto inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] tracking-[0.04em] text-[#C2410C] transition-colors hover:bg-[#FFF7ED] disabled:opacity-40"
        >
          <MessagesSquare className="h-3 w-3" aria-hidden />
          <span className="truncate">
            {discussing ? t('reference.persona_room_discussing') : t('reference.persona_room_discuss')}
          </span>
        </button>
      ) : null}
      <div
        ref={controlsHostRef}
        data-testid="surface-persona-controls"
        className="ml-auto flex shrink-0 items-center"
      />
    </div>
  );
}
