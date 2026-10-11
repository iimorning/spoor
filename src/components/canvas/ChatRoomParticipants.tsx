import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UserPlus, X } from 'lucide-react';
import { AgentIcon } from '../AgentIcon';
import type { RoomParticipant } from '../../utils/personaChatRoom';

export type ChatRoomInviteCandidate = {
  /** 画布候选 = 节点 id；角色库候选 = AgentConfig.id。 */
  id: string;
  /** 角色库里的 id，用来取内置图标；缺省时用 id。 */
  agentConfigId?: string;
  name: string;
  coverUrl?: string;
};

export type ChatRoomParticipantsProps = {
  /** 房间全员，主 Agent 恒在首位。 */
  participants: RoomParticipant[];
  /** 房间的主人（主 Agent 卡）。它也能被禁言，所以需要单独的开关。 */
  hostNodeId: string;
  /** 已经占着标题的那个人（当前发言者），chip 里不再重复。 */
  titledNodeId: string;
  /** 画布上已有的其他角色卡。 */
  candidates: ChatRoomInviteCandidate[];
  /** 角色库里还没上画布的角色，选中会先放到画布上再加入。 */
  libraryCandidates: ChatRoomInviteCandidate[];
  maxParticipants: number;
  disabled?: boolean;
  /** 缺省时不给邀请入口，只显示在场角色。 */
  onAdd?: (nodeId: string) => void;
  onAddFromLibrary?: (agentConfigId: string) => void;
  onRemove: (nodeId: string) => void;
  onToggleMuted: (nodeId: string) => void;
  /**
   * 不画"谁在说话"的红灯，也不给答话的人挂「主持」徽章。
   *
   * 画布上需要：那里的主持人是用户自己选的一张卡，红灯是"这间房有人"的信号。
   * 侧栏那条不一样——阿狸本来就有自己的红点标识，再加一颗灯、挂一枚"主持"，
   * 是同一个信息说两遍，还把"谁是主人"讲成了界面元素而不是身份。
   */
  hideCastIndicators?: boolean;
};

function CastLamp({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      data-testid="room-lamp"
      data-lamp={on ? 'on' : 'off'}
      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
        on ? 'bg-[#C2410C] shadow-[0_0_0_2px_rgba(194,65,12,0.2)]' : 'bg-[#d1cfca]'
      }`}
    />
  );
}

/**
 * 侧栏标题右侧的讨论角色：名字后面的红灯表示这间房有人，＋头像按钮拉人进来，
 * 进来的角色也各自点灯（禁言 = 灯灭）。只有主 Agent 且没有别人可拉时整块不渲染，
 * 单人对话的侧栏保持原样。
 */
export function ChatRoomParticipants({
  participants,
  hostNodeId,
  titledNodeId,
  candidates,
  libraryCandidates,
  maxParticipants,
  disabled = false,
  onAdd,
  onAddFromLibrary,
  onRemove,
  onToggleMuted,
  hideCastIndicators = false,
}: ChatRoomParticipantsProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);

  const host = participants.find((p) => p.nodeId === hostNodeId);
  /** 占着标题的那个人：标题后面的红点显示的是它的状态，而不是主角色恒定的那个。 */
  const titled = participants.find((p) => p.nodeId === titledNodeId);  const canInvite = Boolean(onAdd || onAddFromLibrary);
  const canOffer = candidates.length > 0 || libraryCandidates.length > 0;
  const hide = participants.length <= 1 && (!canInvite || !canOffer);
  const full = participants.length - 1 >= maxParticipants;
  const chips = participants.filter((p) => p.nodeId !== titledNodeId);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (hide) setOpen(false);
  }, [hide]);

  if (hide) return null;

  const candidateRow = (
    candidate: ChatRoomInviteCandidate,
    onPick: () => void,
    testId: string,
    title?: string,
  ) => (
    <button
      key={candidate.id}
      type="button"
      data-testid={testId}
      disabled={full || disabled}
      title={title}
      onClick={onPick}
      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-[#2c2c28] transition-colors hover:bg-[#F4F1ED] disabled:opacity-40"
    >
      <AgentIcon
        agentId={candidate.agentConfigId ?? candidate.id}
        coverUrl={candidate.coverUrl}
        className="h-4 w-4 rounded"
      />
      <span className="min-w-0 truncate">{candidate.name}</span>
    </button>
  );

  return (
    <span
      ref={rootRef}
      data-testid="canvas-chat-room"
      className="relative flex min-w-0 items-center gap-1.5"
    >
      {/* 红点跟着占着标题的那个人；标题落到一个已经不在房间里的 id 时（比如发言中卡被删），
          标题会回退成主角色的名字，红点也跟着显示主角色的状态 —— 名字和灯不能各说各话。 */}
      {hideCastIndicators ? null : (
        <CastLamp on={Boolean((titled ?? host) && !(titled ?? host)!.muted)} />
      )}

      {/* 主角色占着标题时，禁言开关就是标题本身（由面板渲染成可点的名字）——
          全房间统一成"点名字"，没有单独的麦克风按钮。主角色退成 chip 时，
          开关跟着 chip 走，同一时刻只会有一处。 */}

      {chips.map((p) => {
        if (p.isHost) {
          return (
            <span
              key={p.nodeId}
              data-testid={`room-chip-${p.nodeId}`}
              data-muted={p.muted ? '1' : '0'}
              className={`inline-flex min-w-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] tracking-[0.04em] ${
                p.muted
                  ? 'bg-[#F4F1ED] text-[#a8a49c]'
                  : 'bg-[#F4F1ED] text-[#2c2c28]'
              }`}
            >
              <button
                type="button"
                data-testid={`room-mute-${p.nodeId}`}
                disabled={disabled}
                aria-pressed={p.muted}
                title={t(p.muted ? 'canvas.v2.room_unmute' : 'canvas.v2.room_mute')}
                aria-label={t(p.muted ? 'canvas.v2.room_unmute' : 'canvas.v2.room_mute')}
                onClick={() => onToggleMuted(p.nodeId)}
                className="inline-flex min-w-0 items-center gap-1 disabled:opacity-50"
              >
                <span className={`min-w-0 truncate ${p.muted ? 'line-through' : ''}`}>
                  {p.name}
                </span>
                {hideCastIndicators ? null : <CastLamp on={!p.muted} />}
              </button>
              {hideCastIndicators ? null : (
                <span className="shrink-0 rounded-full bg-[#C2410C]/10 px-1 text-[10px] text-[#C2410C]">
                  {t('canvas.v2.room_host_badge')}
                </span>
              )}
            </span>
          );
        }
        return (
          <span
            key={p.nodeId}
            data-testid={`room-chip-${p.nodeId}`}
            data-muted={p.muted ? '1' : '0'}
            className={`inline-flex min-w-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] tracking-[0.04em] ${
              p.muted
                ? 'bg-[#F4F1ED] text-[#a8a49c]'
                : 'bg-[#FFF7ED] text-[#C2410C]'
            }`}
          >
            <button
              type="button"
              data-testid={`room-mute-${p.nodeId}`}
              disabled={disabled}
              aria-pressed={p.muted}
              title={t(p.muted ? 'canvas.v2.room_unmute' : 'canvas.v2.room_mute')}
              aria-label={t(p.muted ? 'canvas.v2.room_unmute' : 'canvas.v2.room_mute')}
              onClick={() => onToggleMuted(p.nodeId)}
              className="inline-flex min-w-0 items-center gap-1 disabled:opacity-50"
            >
              <span className={`min-w-0 truncate ${p.muted ? 'line-through' : ''}`}>{p.name}</span>
              {hideCastIndicators ? null : <CastLamp on={!p.muted} />}
            </button>
            <button
              type="button"
              data-testid={`room-remove-${p.nodeId}`}
              disabled={disabled}
              title={t('canvas.v2.room_remove')}
              aria-label={t('canvas.v2.room_remove')}
              onClick={() => onRemove(p.nodeId)}
              className="shrink-0 text-[#b5b1a9] transition-colors hover:text-[#C2410C] disabled:opacity-50"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        );
      })}

      {/* 加入角色在最右边：先看在场的人，再决定要不要再拉一个进来 */}
      {canInvite ? (
        <button
          type="button"
          data-testid="canvas-chat-room-add"
          disabled={disabled || full}
          title={
            full
              ? t('canvas.v2.room_add_full', { count: maxParticipants })
              : t('canvas.v2.room_add')
          }
          aria-label={t('canvas.v2.room_add')}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-dashed border-[#d1cfca] text-[#8a8a82] transition-colors hover:border-[#C2410C]/50 hover:text-[#C2410C] disabled:opacity-40"
        >
          <UserPlus className="h-3 w-3" />
        </button>
      ) : null}

      {open ? (
        <div
          role="dialog"
          data-testid="canvas-chat-room-menu"
          className="absolute left-0 top-full z-30 mt-1 max-h-72 w-60 overflow-y-auto overscroll-contain rounded-xl border border-[#E6E4DF] bg-white p-1 shadow-lg"
        >
          {!canOffer ? (
            <p className="px-2 py-1.5 text-[11px] leading-relaxed text-[#8a8a82]">
              {t('canvas.v2.room_add_empty')}
            </p>
          ) : null}

          {candidates.length > 0 ? (
            <>
              <p className="px-2 pb-0.5 pt-1 text-[10px] tracking-[0.06em] text-[#8c8a84]">
                {t('canvas.v2.room_group_canvas')}
              </p>
              {candidates.map((c) =>
                candidateRow(
                  c,
                  () => {
                    onAdd?.(c.id);
                    setOpen(false);
                  },
                  `canvas-chat-room-candidate-${c.id}`,
                ),
              )}
            </>
          ) : null}

          {libraryCandidates.length > 0 ? (
            <>
              <p className="px-2 pb-0.5 pt-1 text-[10px] tracking-[0.06em] text-[#8c8a84]">
                {t('canvas.v2.room_group_library')}
              </p>
              {libraryCandidates.map((c) =>
                candidateRow(
                  c,
                  () => {
                    onAddFromLibrary?.(c.id);
                    setOpen(false);
                  },
                  `canvas-chat-room-library-${c.id}`,
                  t('canvas.v2.room_add_library'),
                ),
              )}
            </>
          ) : null}

          {full ? (
            <p className="px-2 py-1 text-[10px] text-[#8a8a82]">
              {t('canvas.v2.room_add_full', { count: maxParticipants })}
            </p>
          ) : null}
        </div>
      ) : null}
    </span>
  );
}
