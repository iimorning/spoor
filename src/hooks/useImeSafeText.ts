import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, CompositionEvent, FormEvent } from 'react';

type TextElement = HTMLInputElement | HTMLTextAreaElement;

function eventValue(e: { target: EventTarget | null }): string {
  return (e.target as TextElement).value;
}

function isComposingEvent(e: ChangeEvent<TextElement> | FormEvent<TextElement>): boolean {
  const native = e.nativeEvent as { isComposing?: boolean };
  return !!native.isComposing;
}

/**
 * Controlled text that can survive IME composition even if `sourceValue`
 * lags (e.g. IndexedDB liveQuery echoing an older snapshot).
 */
export function useImeSafeText(
  sourceKey: string,
  sourceValue: string,
  onPersist: (value: string) => void,
) {
  const [draft, setDraft] = useState<string | null>(null);
  const composingRef = useRef(false);
  const persistRef = useRef(onPersist);
  persistRef.current = onPersist;
  const draftRef = useRef<string | null>(null);
  draftRef.current = draft;

  useEffect(() => {
    setDraft(null);
    composingRef.current = false;
  }, [sourceKey]);

  const persist = useCallback((next: string) => {
    persistRef.current(next);
  }, []);

  const onChange = useCallback(
    (e: ChangeEvent<TextElement>) => {
      const next = eventValue(e);
      setDraft(next);
      if (composingRef.current || isComposingEvent(e)) return;
      persist(next);
    },
    [persist],
  );

  const onCompositionStart = useCallback(() => {
    composingRef.current = true;
  }, []);

  const onCompositionUpdate = useCallback((e: CompositionEvent<TextElement>) => {
    composingRef.current = true;
    setDraft(eventValue(e));
  }, []);

  const onCompositionEnd = useCallback(
    (e: CompositionEvent<TextElement>) => {
      composingRef.current = false;
      const next = eventValue(e);
      setDraft(next);
      persist(next);
    },
    [persist],
  );

  const onBlur = useCallback(() => {
    if (composingRef.current) return;
    const next = draftRef.current;
    if (next !== null) persist(next);
  }, [persist]);

  const replace = useCallback(
    (next: string) => {
      composingRef.current = false;
      setDraft(next);
      persist(next);
    },
    [persist],
  );

  const value = draft ?? sourceValue;

  return {
    value,
    replace,
    bind: {
      value,
      onChange,
      onCompositionStart,
      onCompositionUpdate,
      onCompositionEnd,
      onBlur,
    },
  };
}
