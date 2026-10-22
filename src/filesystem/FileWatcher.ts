import { File } from "./File";
import * as fs from "fs";
import * as events from "events";

/**
 * 文件与目录系统变动监视器。
 * 封装 Node 原生 `fs.watch`，提供重命名、内容变更回调与安全错误冒泡。
 */
export class FileWatcher {
  /** 监视的目标文件或目录对象 */
  readonly file: File;
  private watcher?: fs.FSWatcher;
  private selfWatcher?: fs.FSWatcher;
  private isDir: boolean;
  private recursive: boolean;
  private _event: events.EventEmitter;

  /** 文件/目录发生重命名或同名增删时的事件回调 */
  OnRename?: (file: File) => void;
  /** 文件内容发生变更时的事件回调 */
  OnChanged?: (file: File) => void;

  /**
   * 构造文件监视器。
   *
   * @param _file 目标 File 实例
   * @param _recursive 是否递归监视子目录（仅对目录有效）
   */
  constructor(_file: File, _recursive: boolean = false) {
    this.file = _file;
    this.recursive = _recursive;
    this.isDir = this.file.IsDir();
    this._event = new events.EventEmitter();
  }

  /**
   * 注册错误监听器。
   */
  on(event: "error", listener: (err: Error) => void): this {
    this._event.on(event, listener);
    return this;
  }

  /**
   * 转发监视错误。
   * EventEmitter 在 'error' 事件没有监听者时会直接抛出异常，
   * 而工程文件监视这类调用方通常并不关心错误，必须先判断有无监听者。
   */
  private emitError(err: unknown) {
    if (this._event.listenerCount("error") > 0) {
      this._event.emit("error", err);
    }
  }

  /**
   * 启动文件或目录监视。
   * 目录监视时，同时对其父级目录挂载 selfWatcher 以感知目录本身被重命名。
   */
  Watch(): this {
    try {
      if (this.isDir && this.selfWatcher === undefined) {
        if (fs.existsSync(this.file.dir)) {
          this.selfWatcher = fs.watch(
            this.file.dir,
            { recursive: false },
            (event, fname) => {
              if (
                event === "rename" &&
                fname?.toString() === this.file.name &&
                this.OnRename
              ) {
                this.OnRename(this.file);
              }
            },
          );
          this.selfWatcher.on("error", (err) => {
            this.emitError(err);
          });
        }
      }

      if (this.watcher === undefined) {
        if (fs.existsSync(this.file.path)) {
          this.watcher = fs.watch(
            this.file.path,
            { recursive: this.recursive },
            (event, filename) => {
              switch (event) {
                case "rename":
                  if (this.OnRename) {
                    if (this.isDir) {
                      if (filename !== null && filename !== undefined) {
                        this.OnRename(
                          File.fromArray([this.file.path, filename.toString()]),
                        );
                      }
                    } else {
                      this.OnRename(this.file);
                    }
                  }
                  break;

                case "change":
                  if (this.OnChanged) {
                    if (this.isDir) {
                      if (filename !== null && filename !== undefined) {
                        this.OnChanged(
                          File.fromArray([this.file.path, filename.toString()]),
                        );
                      }
                    } else {
                      this.OnChanged(this.file);
                    }
                  }
                  break;
              }
            },
          );
          this.watcher.on("error", (err) => {
            this.emitError(err);
          });
        }
      }
    } catch (err) {
      this.emitError(err);
    }
    return this;
  }

  /**
   * 关闭并注销所有底层文件监视句柄。
   */
  Close() {
    if (this.selfWatcher) {
      this.selfWatcher.close();
      this.selfWatcher = undefined;
    }

    if (this.watcher) {
      this.watcher.close();
      this.watcher = undefined;
    }
  }
}
