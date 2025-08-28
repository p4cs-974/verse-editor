import { useRef, useCallback } from "react";

/**
 * Simple debounced callback hook used by the editor to avoid frequent saves.
 * Returns a function you call with the latest value; the wrapped callback will
 * be invoked after `delay` ms since the last call.
 */
export function useDebouncedCallback<T extends unknown[]>(
  fn: (...args: T) => void | Promise<void>,
  delay = 500
) {
  const timer = useRef<number | null>(null);

  return useCallback(
    (...args: T) => {
      if (timer.current) {
        window.clearTimeout(timer.current);
      }
      // use window.setTimeout so the return value is number in browsers
      timer.current = window.setTimeout(() => {
        fn(...args);
        timer.current = null;
      }, delay) as unknown as number;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fn, delay]
  );
}
