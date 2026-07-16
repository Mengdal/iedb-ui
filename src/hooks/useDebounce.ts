import { useState, useEffect } from 'react';

/**
 * React 状态防抖 hook。
 * 传入 value，返回在 delay 毫秒内无变化后的值，常用于搜索输入等场景。
 */
export function useDebounce<T>(value: T, delay = 300): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}
