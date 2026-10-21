/**
 * 简单的防抖器。
 *
 * 编译完成时 uVision 会连续改写锁文件、'.d' 依赖、工程文件，
 * 如果每次事件都立刻刷新，会重复读取大量文件并造成侧边栏闪烁。
 * 这里把一段时间内的多次触发合并为最后一次。
 */
export class Debouncer {
  private timer: NodeJS.Timeout | undefined;

  private readonly delayMs: number;

  private readonly action: () => void;

  constructor(delayMs: number, action: () => void) {
    this.delayMs = delayMs;
    this.action = action;
  }

  /** 重新计时；已有等待中的任务会被取消 */
  schedule(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
    }

    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.action();
    }, this.delayMs);
  }

  /** 取消尚未执行的任务（关闭工程时调用，避免回调碰到已释放的资源） */
  cancel(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  /** 是否有等待中的任务 */
  get pending(): boolean {
    return this.timer !== undefined;
  }
}
