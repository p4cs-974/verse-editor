import { useRef, useCallback, useEffect } from "react";

/**
 * Robust debounced callback with:
 * - Stable function reference (no stale closures)
 * - Pending/flush/cancel controls
 * - Safe cleanup (no setState-after-unmount warnings)
 */
export type DebouncedHandle<T extends unknown[]> = {
  call: (...args: T) => void;
  flush: () => void;
  cancel: () => void;
  pending: () => boolean;
};

export function useDebouncedCallback<T extends unknown[]>(
  fn: (...args: T) => void | Promise<void>,
  delay = 500
): DebouncedHandle<T> {
  const timerRef = useRef<number | null>(null);
  const latestArgsRef = useRef<T | null>(null);
  const fnRef = useRef(fn);
  const pendingRef = useRef(false);
  const mountedRef = useRef(true);

  // Keep the latest fn without re-creating callbacks
  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);

  // Track mount status to avoid post-unmount effects
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const cancel = useCallback(() => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingRef.current = false;
  }, []);

  const call = useCallback(
    (...args: T) => {
      latestArgsRef.current = args;
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
      }
      pendingRef.current = true;
      timerRef.current = window.setTimeout(async () => {
        timerRef.current = null;
        if (!mountedRef.current) return;
        pendingRef.current = false;
        const latest = latestArgsRef.current;
        // Guard: if no latest args (shouldn't happen), do nothing
        if (!latest) return;
        await fnRef.current(...latest);
      }, delay) as unknown as number;
    },
    [delay]
  );

  const flush = useCallback(() => {
    if (!mountedRef.current) return;
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const latest = latestArgsRef.current;
    pendingRef.current = false;
    if (latest) {
      void fnRef.current(...latest);
    }
  }, []);

  const pending = useCallback(() => pendingRef.current, []);

  return { call, flush, cancel, pending };
}
