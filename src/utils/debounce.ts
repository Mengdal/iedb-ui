/**
 * 创建一个防抖函数：在最后一次调用后的 wait 毫秒才执行原函数。
 * 适合 resize、scroll、输入等高频事件。
 */
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  wait = 300
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      fn(...args);
    }, wait);
  };
}

/** 节流函数：在指定间隔内最多执行一次原函数。 */
export function throttle<T extends (...args: any[]) => any>(
  fn: T,
  wait = 300
): (...args: Parameters<T>) => void {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    const now = Date.now();
    const remaining = wait - (now - last);
    if (remaining <= 0) {
      if (timer) clearTimeout(timer);
      last = now;
      fn(...args);
    } else if (!timer) {
      timer = setTimeout(() => {
        last = Date.now();
        timer = null;
        fn(...args);
      }, remaining);
    }
  };
}
