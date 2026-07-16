/**
 * 生成一个尽量唯一、简短的 ID。
 * 优先使用浏览器原生 crypto.randomUUID()；在非安全上下文或不可用
 * 时回退到时间戳 + 随机数组合，避免自己散落实现。
 */
export function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return crypto.randomUUID();
    } catch {
      // fallback
    }
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

/** 兼容旧命名的别名，语义与 generateId 相同。 */
export const uid = generateId;
