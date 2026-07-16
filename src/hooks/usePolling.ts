import { useEffect, useRef } from 'react';

interface UsePollingOptions {
  /** 是否启用轮询（默认 true） */
  enabled?: boolean;
  /** 是否在启用时立即执行一次（默认 true） */
  immediate?: boolean;
}

/**
 * 统一轮询 hook。
 * 在 enabled 为 true 时，立即执行一次 callback，然后每隔 interval 毫秒重复执行。
 * 组件卸载或 interval/enabled 变化时自动清理定时器。
 */
export function usePolling(
  callback: () => void,
  interval: number,
  options: UsePollingOptions = {}
) {
  const { enabled = true, immediate = true } = options;
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled || interval <= 0) return;

    const tick = () => savedCallback.current();

    if (immediate) tick();

    const id = setInterval(tick, interval);
    return () => clearInterval(id);
  }, [enabled, interval, immediate]);
}
