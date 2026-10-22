import { File } from "../filesystem";
import type { RuntimePaths } from "../config/projectConfig";

/**
 * KeilProject 对 Target 暴露的只读接口。
 *
 * Target 只需要“工程路径 + 运行期目录 + 日志 + 相对路径解析”这几项能力，
 * 依赖接口而不是 KeilProject 具体类，可以避免 model 内部出现循环依赖。
 */
export interface KeilProjectInfo {
  prjID: string;

  uvprjFile: File;

  logger: Console;

  toAbsolutePath(rePath: string): string;

  /**
   * 当前工作区对应的运行期文件位置。
   *
   * 每次都重新解析而不是缓存：workspaceRoot 可能在运行期间被修改，
   * 编译日志、C/C++ 配置都要立刻跟着新目录走。
   */
  getRuntimePaths(): RuntimePaths;
}

/** '.uvprojx' 里与 uVision 版本相关的最小信息 */
export interface uVisonInfo {
  schemaVersion: string | undefined;
}
