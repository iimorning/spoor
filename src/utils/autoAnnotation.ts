import { readLocalStorage, writeLocalStorage } from './safeStorage';

/**
 * 「AI 自己动起来」的三族开关。每一族一个按钮，但按钮是**全局**的：
 * 在任何一篇长文上关掉自动标注，所有长文都跟着关。
 *
 * 之前这三个开关各存各的 IndexedDB 字段（`essayFocusEnabled` / `bookFocusEnabled` /
 * `proactiveChatEnabled`），语义是「这一篇/这一本/这个房间」。结果是每篇都得自己
 * 记得去关一次——关了一篇，另一篇照样在半夜自己读你写的东西。用户说的就是这个：
 * 「关掉长文的自动标注按钮，其他的长文都会默认关闭」。
 *
 * 存 localStorage 而不是 IndexedDB，有两个理由：这三族开关是**用户偏好**不是内容，
 * 不该跟着某台设备同步；而且正文那页开着的时候要能立刻看到别处的改动——
 * `AUTO_ANNOTATION_EVENT` 就是干这个的，已经挂载的面板自己会重渲染。
 */

/** 三个族。注意这是 `settings.auto_annotation_*` 的 key，不是 DB 字段。 */
export type AutoAnnotationFamily = 'essay' | 'book' | 'room';

const STORAGE_KEYS: Record<AutoAnnotationFamily, string> = {
  essay: 'spoor_auto_annotation_essay',
  book: 'spoor_auto_annotation_book',
  room: 'spoor_auto_annotation_room',
};

/** 任一族开关变化时派发；`detail` 是刚被改的那一族。 */
export const AUTO_ANNOTATION_EVENT = 'spoor:auto-annotation';

/**
 * 这一族开没开。**缺省即开启**——写进去之前开关一直是自动的，
 * 老用户不该因为升了版本就突然发现 AI 不读了。
 */
export function isAutoAnnotationEnabled(family: AutoAnnotationFamily): boolean {
  return readLocalStorage(STORAGE_KEYS[family]) !== '0';
}

/**
 * 改某一族的全局开关。落盘之后广播一次：长文页、读书页、画布房间可能都开着，
 * 它们各订一份，改一处三处立刻同步，不用刷新。
 */
export function setAutoAnnotationEnabled(family: AutoAnnotationFamily, enabled: boolean): void {
  writeLocalStorage(STORAGE_KEYS[family], enabled ? '1' : '0');
  window.dispatchEvent(new CustomEvent(AUTO_ANNOTATION_EVENT, { detail: family }));
}