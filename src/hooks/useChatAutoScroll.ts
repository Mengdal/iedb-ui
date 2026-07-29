import { useCallback, useEffect, useRef, useState, type TouchEvent, type WheelEvent } from 'react';

/**
 * AI 对话列表自动滚底。
 *
 * stick=true  → 内容变高时贴底
 * stick=false → 绝不写 scrollTop
 *
 * re-stick 仅由用户主动动作触发（onWheel 下滚 / onTouchMove 下滑 /
 * jumpToBottom / enableStick），onScroll 只负责 detach。
 * 这样流式内容增长触发的被动 scroll 事件不会偷偷把 stick 开回来。
 */

/** 距底超过此值 = 已离开底部 */
const LEAVE_BOTTOM_PX = 100;
/** 距底小于此值 = 可恢复跟滚（且须已完成「先离开」） */
const ENTER_BOTTOM_PX = 20;

export function useChatAutoScroll(contentKey: unknown) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const rafRef = useRef(0);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const touchYRef = useRef(0);
  /**
   * re-stick 不由 onScroll 触发（防止流式内容增长偷偷开回来），
   * 仅由 onWheel/onTouchMove（用户主动向下滚）或 jumpToBottom/enableStick 显式恢复。
   */

  const getDistanceFromBottom = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return 0;
    return el.scrollHeight - el.scrollTop - el.clientHeight;
  }, []);

  const setStick = useCallback((stick: boolean) => {
    stickToBottomRef.current = stick;
    setShowJumpToBottom((prev) => {
      const next = !stick;
      return prev === next ? prev : next;
    });
    if (!stick && rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
  }, []);

  const writeScrollTop = useCallback(
    (top: number) => {
      const el = scrollerRef.current;
      if (!el) return;
      el.scrollTop = top;
    },
    []
  );

  /** 仅 stick 时贴底 */
  const followBottomIfNeeded = useCallback(() => {
    if (!stickToBottomRef.current) return;
    const el = scrollerRef.current;
    if (!el) return;

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      if (!stickToBottomRef.current) return;
      const box = scrollerRef.current;
      if (!box) return;
      writeScrollTop(box.scrollHeight);
    });
  }, [writeScrollTop]);

  const jumpToBottom = useCallback(() => {
    setStick(true);
    const el = scrollerRef.current;
    if (!el) return;
    writeScrollTop(el.scrollHeight);
  }, [setStick, writeScrollTop]);

  const enableStick = useCallback(() => {
    setStick(true);
  }, [setStick]);

  /** 用户明确要离开底部 */
  const detachFromBottom = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    setStick(false);
  }, [setStick]);

  const onWheel = useCallback(
    (e: WheelEvent<HTMLDivElement>) => {
      if (e.deltaY < 0) {
        // 向上：立刻停跟滚
        detachFromBottom();
      } else if (e.deltaY > 0 && !stickToBottomRef.current) {
        // 向下滚且已贴底 → 恢复跟滚（用户主动往回看最新）
        const dist = getDistanceFromBottom();
        if (dist <= ENTER_BOTTOM_PX) {
          setStick(true);
        }
      }
    },
    [detachFromBottom, getDistanceFromBottom, setStick]
  );

  const onTouchStart = useCallback((e: TouchEvent<HTMLDivElement>) => {
    touchYRef.current = e.touches[0]?.clientY ?? 0;
  }, []);

  const onTouchMove = useCallback(
    (e: TouchEvent<HTMLDivElement>) => {
      const y = e.touches[0]?.clientY ?? 0;
      const dy = y - touchYRef.current;
      touchYRef.current = y;
      if (dy > 4) {
        // 手指下移 = 内容上滑
        detachFromBottom();
      } else if (dy < -4 && !stickToBottomRef.current) {
        const dist = getDistanceFromBottom();
        if (dist <= ENTER_BOTTOM_PX) {
          setStick(true);
        }
      }
    },
    [detachFromBottom, getDistanceFromBottom, setStick]
  );

  const onScroll = useCallback(() => {
    const dist = getDistanceFromBottom();

    if (stickToBottomRef.current) {
      // 跟滚中：明显离开 → 停
      if (dist > LEAVE_BOTTOM_PX) {
        setStick(false);
      }
    }
  }, [getDistanceFromBottom, setStick]);

  useEffect(() => {
    followBottomIfNeeded();
  }, [contentKey, followBottomIfNeeded]);

  const setContentNode = useCallback(
    (node: HTMLDivElement | null) => {
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      if (!node) return;
      const ro = new ResizeObserver(() => {
        // stick=false 时 follow 内部直接 return，不碰滚动
        followBottomIfNeeded();
      });
      ro.observe(node);
      resizeObserverRef.current = ro;
    },
    [followBottomIfNeeded]
  );

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      resizeObserverRef.current?.disconnect();
    };
  }, []);

  return {
    scrollerRef,
    setContentNode,
    showJumpToBottom,
    onScroll,
    onWheel,
    onTouchStart,
    onTouchMove,
    jumpToBottom,
    enableStick,
  };
}
