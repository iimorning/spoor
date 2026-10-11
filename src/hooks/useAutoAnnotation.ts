import { useCallback, useSyncExternalStore } from 'react';
import {
  AUTO_ANNOTATION_EVENT,
  isAutoAnnotationEnabled,
  setAutoAnnotationEnabled,
  type AutoAnnotationFamily,
} from '../utils/autoAnnotation';

/**
 * 订阅某一族的全局开关。
 *
 * 开关是全局的，所以面板必须跟着别处改动的方向走：用户在 A 篇文章上关掉标注，
 * 正开着 B 篇的那个标签页也得立刻停下来——不然他看到的是"我明明关了，它还在标"。
 * `useSyncExternalStore` 就是干这个的，订阅的是 `localStorage` 之上的那一层广播。
 */
export function useAutoAnnotation(family: AutoAnnotationFamily): [boolean, (next: boolean) => void] {
  const subscribe = useCallback(
    (onChange: () => void) => {
      window.addEventListener(AUTO_ANNOTATION_EVENT, onChange);
      return () => window.removeEventListener(AUTO_ANNOTATION_EVENT, onChange);
    },
    [],
  );
  const enabled = useSyncExternalStore(
    subscribe,
    () => isAutoAnnotationEnabled(family),
    () => true,
  );
  const setEnabled = useCallback(
    (next: boolean) => setAutoAnnotationEnabled(family, next),
    [family],
  );
  return [enabled, setEnabled];
}