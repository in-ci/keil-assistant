import { File } from "./File";
import * as fs from "fs";
import * as events from "events";

export class FileWatcher {
  readonly file: File;
  private watcher?: fs.FSWatcher;
  private selfWatcher?: fs.FSWatcher;
  private isDir: boolean;
  private recursive: boolean;
  private _event: events.EventEmitter;

  OnRename?: (file: File) => void;
  OnChanged?: (file: File) => void;

  constructor(_file: File, _recursive: boolean = false) {
    this.file = _file;
    this.recursive = _recursive;
    this.isDir = this.file.IsDir();
    this._event = new events.EventEmitter();
  }

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

  Watch(): this {
    if (this.isDir && this.selfWatcher === undefined) {
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

    if (this.watcher === undefined) {
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
    return this;
  }

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
