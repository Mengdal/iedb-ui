import { useState, useEffect, useCallback } from 'react';

/**
 * 监听目标 DOM 元素宽度的 ResizeObserver hook。
 * 返回当前宽度和 ref 回调，用于需要响应容器宽度变化的场景。
 */
export function useResizeObserver(initialWidth = 1200) {
  const [width, setWidth] = useState(initialWidth);
  const [node, setNode] = useState<HTMLDivElement | null>(null);

  const containerRef = useCallback((el: HTMLDivElement | null) => {
    setNode(el);
  }, []);

  useEffect(() => {
    if (!node) return;
    if (node.offsetWidth > 0) {
      setWidth(node.offsetWidth);
    }
    const observer = new ResizeObserver((entries) => {
      window.requestAnimationFrame(() => {
        if (!Array.isArray(entries) || !entries.length) return;
        const entry = entries[0];
        if (entry.contentRect.width > 0) {
          setWidth(entry.contentRect.width);
        }
      });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  return { width, containerRef };
}
