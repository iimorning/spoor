import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { Folder, FolderPlus, Inbox } from 'lucide-react';
import { db } from '../db';
import {
  createArchiveFolder,
  readLastArchiveFolderId,
} from '../utils/archiveFolders';

export interface ArchiveFolderPickerProps {
  onPick: (folderId: string | null) => void;
}

export function ArchiveFolderPicker({ onPick }: ArchiveFolderPickerProps) {
  const { t } = useTranslation();
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('');
  const folders =
    useLiveQuery(() => db.archiveFolders.orderBy('sortOrder').toArray(), []) ?? [];
  const lastId = readLastArchiveFolderId();

  const pick = (folderId: string | null) => {
    onPick(folderId);
  };

  const submitNew = async () => {
    const name = draft.trim();
    if (!name) return;
    const folder = await createArchiveFolder(name);
    setCreating(false);
    setDraft('');
    pick(folder.id);
  };

  const rowClass = (active: boolean) =>
    `w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-xs font-sans transition-colors ${
      active ? 'bg-[#F4F1ED] text-[#C2410C]' : 'text-[#3a3a34] hover:bg-[#F4F1ED]'
    }`;

  return (
    <div
      data-testid="archive-folder-picker"
      className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 w-52 bg-white border border-[#E6E4DF] rounded-xl shadow-2xl p-1 z-50"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="px-2.5 py-1.5 text-[10px] font-bold text-[#8c8a84] uppercase tracking-wider font-mono border-b border-[#F4F1ED] mb-1">
        {t('archive.pick_folder')}
      </div>
      <div className="max-h-56 overflow-y-auto">
        <button
          type="button"
          data-testid="archive-folder-pick-unfiled"
          className={rowClass(lastId === null)}
          onPointerDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
            pick(null);
          }}
        >
          <Inbox className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{t('archive.unfiled')}</span>
        </button>
        {folders.map((folder) => (
          <button
            key={folder.id}
            type="button"
            data-testid={`archive-folder-pick-${folder.id}`}
            className={rowClass(lastId === folder.id)}
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              pick(folder.id);
            }}
          >
            <Folder className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{folder.name}</span>
          </button>
        ))}
      </div>
      <div className="border-t border-[#F4F1ED] mt-1 pt-1">
        {creating ? (
          <form
            className="px-1 py-0.5"
            onSubmit={(e) => {
              e.preventDefault();
              void submitNew();
            }}
          >
            <input
              autoFocus
              data-testid="archive-folder-picker-name"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  setCreating(false);
                  setDraft('');
                }
              }}
              placeholder={t('archive.folder_name_placeholder')}
              className="w-full bg-white border border-[#C2410C] rounded-md px-2 py-1 text-xs text-[#1a1a1a] outline-none"
            />
          </form>
        ) : (
          <button
            type="button"
            data-testid="archive-folder-picker-new"
            className={rowClass(false)}
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setCreating(true);
            }}
          >
            <FolderPlus className="w-3.5 h-3.5 shrink-0" />
            {t('archive.new_folder')}
          </button>
        )}
      </div>
    </div>
  );
}
