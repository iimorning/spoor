import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
} from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Folder, Inbox } from 'lucide-react';
import { ArchiveFolderPicker } from './ArchiveFolderPicker';

/**
 * 「哪个菜单开着」存成一个外部 store，而不是组件 state。
 *
 * 放进 ArchiveLibrary 的 state 会让点一下按钮重渲染整棵卡片树——每张卡的正文
 * 都要重新解析一遍 markdown，几十张卡就是几百毫秒的主线程长任务；放进普通
 * Context 也一样：value 一变，所有按钮都跟着渲染。
 *
 * 这里 Context 只传一个**引用永远不变**的 store 实例，按钮用
 * useSyncExternalStore 按自己的 id 订阅，快照会挡掉没变化的那 40 个。
 */
type Listener = () => void;

interface MoveMenuStore {
  subscribe: (listener: Listener) => () => void;
  isOpen: (cardId: string) => boolean;
  open: (cardId: string) => void;
  close: (cardId: string) => void;
}

function createMoveMenuStore(): MoveMenuStore {
  const listeners = new Set<Listener>();
  let openId: string | null = null;
  const emit = () => {
    for (const listener of listeners) listener();
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    isOpen: (cardId) => openId === cardId,
    open(cardId) {
      if (openId === cardId) return;
      openId = cardId;
      emit();
    },
    close(cardId) {
      if (openId !== cardId) return;
      openId = null;
      emit();
    },
  };
}

const MoveMenuStoreContext = createContext<MoveMenuStore | null>(null);

export function ArchiveMoveMenuProvider({ children }: { children: React.ReactNode }) {
  const storeRef = useRef<MoveMenuStore | null>(null);
  if (storeRef.current === null) storeRef.current = createMoveMenuStore();
  return <MoveMenuStoreContext.Provider value={storeRef.current}>{children}</MoveMenuStoreContext.Provider>;
}

export interface ArchiveMoveToButtonProps {
  cardId: string;
  folderId: string | null;
  folderName: string | null;
  disabled?: boolean;
  onMove: (folderId: string | null) => void;
}

export function ArchiveMoveToButton({
  cardId,
  folderId,
  folderName,
  disabled,
  onMove,
}: ArchiveMoveToButtonProps) {
  const { t } = useTranslation();
  const store = useContext(MoveMenuStoreContext);
  const subscribe = useCallback(
    (listener: Listener) => (store ? store.subscribe(listener) : () => {}),
    [store],
  );
  const open = useSyncExternalStore(
    subscribe,
    () => (store ? store.isOpen(cardId) : false),
    () => false,
  );

  useEffect(() => {
    if (!open || !store) return;
    const close = (e: Event) => {
      if (e.type === 'keydown' && (e as KeyboardEvent).key !== 'Escape') return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.(`[data-archive-move-menu="${cardId}"]`)) return;
      store.close(cardId);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open, cardId, store]);

  return (
    <div className="relative shrink-0" data-archive-move-menu={cardId}>
      <button
        type="button"
        data-testid={`archive-move-${cardId}`}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t('archive.move_to')}
        aria-label={t('archive.move_to')}
        onClick={(e) => {
          e.stopPropagation();
          if (!store) return;
          if (open) store.close(cardId);
          else store.open(cardId);
        }}
        className={`inline-flex items-center gap-1.5 h-8 px-2 rounded-lg text-[11px] font-sans font-medium transition-colors disabled:opacity-40 ${
          open ? 'bg-[#F4F1ED] text-[#C2410C]' : 'text-[#5a5a54] hover:bg-[#F4F1ED] hover:text-[#3a3a34]'
        }`}
      >
        {folderId ? (
          <Folder className="w-3.5 h-3.5 shrink-0" aria-hidden />
        ) : (
          <Inbox className="w-3.5 h-3.5 shrink-0" aria-hidden />
        )}
        <span className="max-w-[7.5rem] truncate">{folderName ?? t('archive.unfiled')}</span>
        <ChevronDown className="w-3 h-3 shrink-0 opacity-60" aria-hidden />
      </button>
      {open ? (
        <ArchiveFolderPicker
          className="absolute bottom-full left-0 mb-1.5"
          title={t('archive.move_to')}
          showNewFolder={false}
          activeFolderId={folderId}
          onPick={(next) => {
            store?.close(cardId);
            onMove(next);
          }}
        />
      ) : null}
    </div>
  );
}