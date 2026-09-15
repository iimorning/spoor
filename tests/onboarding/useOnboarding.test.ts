import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOnboarding, ONBOARDING_STORAGE_KEY, type OnboardingStep } from '../../src/onboarding/useOnboarding';

const STEPS: OnboardingStep[] = [
  { id: 's1', targetTestId: 't1', copy: { titleKey: 'a', bodyKey: 'b' } },
  { id: 's2', targetTestId: 't2', copy: { titleKey: 'a', bodyKey: 'b' } },
  { id: 's3', targetTestId: 't3', copy: { titleKey: 'a', bodyKey: 'b' } },
];

describe('useOnboarding', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts inactive when the storage flag is already true', () => {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, 'true');
    const { result } = renderHook(() => useOnboarding(STEPS));
    expect(result.current.isActive).toBe(false);
  });

  it('starts active when storage is empty (first launch)', () => {
    const { result } = renderHook(() => useOnboarding(STEPS));
    expect(result.current.isActive).toBe(true);
    expect(result.current.currentIndex).toBe(0);
    expect(result.current.currentStep?.id).toBe('s1');
    expect(result.current.totalSteps).toBe(3);
  });

  it('start() resets to step 0 and reopens', () => {
    const { result } = renderHook(() => useOnboarding(STEPS));
    act(() => result.current.skip());
    expect(result.current.isActive).toBe(false);
    act(() => result.current.start());
    expect(result.current.isActive).toBe(true);
    expect(result.current.currentIndex).toBe(0);
  });

  it('next() advances and finishing the last step writes done + closes', () => {
    const { result } = renderHook(() => useOnboarding(STEPS));
    act(() => result.current.next()); // 0 → 1
    expect(result.current.currentIndex).toBe(1);
    act(() => result.current.next()); // 1 → 2
    expect(result.current.currentIndex).toBe(2);
    act(() => result.current.next()); // beyond end → close + write
    expect(result.current.isActive).toBe(false);
    expect(localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBe('true');
  });

  it('skip() closes immediately and writes done', () => {
    const { result } = renderHook(() => useOnboarding(STEPS));
    act(() => result.current.skip());
    expect(result.current.isActive).toBe(false);
    expect(localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBe('true');
  });

  it('restart() clears the flag and reopens at step 0', () => {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, 'true');
    const { result } = renderHook(() => useOnboarding(STEPS));
    expect(result.current.isActive).toBe(false);
    act(() => result.current.restart());
    expect(result.current.isActive).toBe(true);
    expect(result.current.currentIndex).toBe(0);
    expect(localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBeNull();
  });

  it('startIfUnseen() stamps storage and does not replay after skip', () => {
    const { result } = renderHook(() =>
      useOnboarding(STEPS, { storageKey: 'tour_canvas_test', initialActive: false }),
    );
    expect(result.current.isActive).toBe(false);
    act(() => result.current.startIfUnseen());
    expect(result.current.isActive).toBe(true);
    expect(localStorage.getItem('tour_canvas_test')).toBe('true');
    act(() => result.current.skip());
    expect(result.current.isActive).toBe(false);
    act(() => result.current.startIfUnseen());
    expect(result.current.isActive).toBe(false);
  });

  it('startIfUnseen() does not reset the current step on a second call', () => {
    const { result } = renderHook(() =>
      useOnboarding(STEPS, { storageKey: 'tour_canvas_once', initialActive: false }),
    );
    act(() => result.current.startIfUnseen());
    act(() => result.current.next());
    expect(result.current.currentIndex).toBe(1);
    act(() => result.current.startIfUnseen());
    expect(result.current.isActive).toBe(true);
    expect(result.current.currentIndex).toBe(1);
  });
});
