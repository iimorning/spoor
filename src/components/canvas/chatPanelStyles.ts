/** Shared typography/spacing for canvas + essay AI chat sidebars. */
export const CHAT_PANEL_LIST_CLASS = 'flex-1 min-h-0 overflow-y-auto px-5 py-5 space-y-6';

export const CHAT_BUBBLE_BODY_CLASS =
  'min-w-0 select-text rounded-2xl py-3.5 pr-4 pl-4 text-[15px] leading-[1.85] tracking-[0.04em] [&_p]:mb-3.5 [&_p:last-child]:mb-0 [&_ul]:my-3 [&_ol]:my-3 [&_li]:my-1.5 [&_h1]:mb-3 [&_h2]:mb-3 [&_h3]:mb-2.5';

export const CHAT_COMPOSER_WRAP_CLASS = 'min-w-0 flex-1 cursor-text px-1 pb-1.5 pt-2';

export const CHAT_COMPOSER_INPUT_CLASS =
  'w-full cursor-text resize-none bg-transparent px-0.5 font-sans text-[15px] leading-7 tracking-[0.02em] text-[#2c2c28] placeholder:text-[#aaa] focus:outline-none disabled:opacity-50';

/** Match canvas ComposerInlineInput initial height; grows when typing. */
export const CHAT_COMPOSER_TEXTAREA_CLASS = `${CHAT_COMPOSER_INPUT_CLASS} min-h-[2.75rem] max-h-40 overflow-y-auto`;

/** Hover-only drag handle outside the bubble; red when visible. */
export const CHAT_REPLY_DRAG_HANDLE_CLASS =
  'absolute -left-3 top-1/2 z-10 flex h-4 w-4 -translate-y-1/2 cursor-grab items-center justify-center rounded bg-[#FFF7ED] text-[#C2410C] opacity-0 shadow-sm transition-opacity hover:bg-[#C2410C]/15 group-hover/message:opacity-100 group-focus-within/message:opacity-100 active:cursor-grabbing';
