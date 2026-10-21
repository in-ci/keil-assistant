/**
 * 数组去重工具函数。
 *
 * @param arr 原始泛型数组
 * @returns 去重后的新数组
 */
export function ArrayDelRepetition<T>(arr: T[]): T[] {
  return Array.from(new Set<T>(arr));
}
