import * as node_path from "path";

import { File } from "../../lib/node_utility/File";
import {
  PROJECT_CONFIG_FILE_NAME,
  WORKSPACE_ROOT_KEY,
  readConfigObject,
  resolveWorkspaceRoot,
  toConfigPath,
} from "./workspaceConfig";
import type { WorkspaceRootInfo } from "./workspaceConfig";

/** 工作区 / 工程里存放插件产物的目录名 */
export const VSCODE_DIR_NAME = ".vscode";

/** 运行日志文件名（放在工作区根目录的 .vscode 下） */
export const RUNTIME_LOG_FILE_NAME = "keil-assistant.log";

/** Uv4Caller 的输出日志文件名 */
export const RUNTIME_UV4_LOG_FILE_NAME = "uv4.log";

/** 编译锁文件名：uVision 改写它时说明一次编译/下载刚刚结束 */
export const RUNTIME_LOCK_FILE_NAME = "uv4.log.lock";

/** C/C++ 插件读取的配置文件 */
export const CPP_PROPERTIES_FILE_NAME = "c_cpp_properties.json";

/**
 * 与“当前工程”相关的运行期路径。
 *
 * 这些文件全部跟随 workspaceRoot：默认就是工程文件所在目录，
 * 用户把 workspaceRoot 指到项目根目录后，它们会生成到项目根的 '.vscode' 下，
 * 而不是继续堆在 MDK 工程目录里。
 */
export interface RuntimePaths {
  /** '.vscode' 目录（保证已存在） */
  dir: File;
  /** 插件运行日志 */
  logFile: File;
  /** Uv4Caller 的编译输出 */
  uv4LogFile: File;
  /** 编译锁文件 */
  lockFile: File;
  /** C/C++ 插件配置 */
  cppPropertiesFile: File;
}

/**
 * 工程级配置：读取/保存 workspaceRoot，并据此推导运行期文件位置。
 *
 * 配置文件固定放在工程文件旁的 '.vscode/keil-assistant.json'：
 * 它是“这个工程应该用哪个目录当工作区”的唯一来源，必须跟着工程文件走，
 * 不能跟着 workspaceRoot 走，否则切换工作区后就再也读不到自己的配置了。
 */
export class ProjectConfig {
  /** 工程文件所在目录（默认工作区根目录） */
  readonly projectDir: File;

  /** '<工程目录>/.vscode/keil-assistant.json' */
  readonly configFile: File;

  constructor(uvprjFile: File) {
    this.projectDir = new File(uvprjFile.dir);
    this.configFile = new File(
      uvprjFile.dir +
        File.sep +
        VSCODE_DIR_NAME +
        File.sep +
        PROJECT_CONFIG_FILE_NAME,
    );
  }

  /**
   * 首次打开工程时写入默认配置（workspaceRoot = "."）。
   *
   * 已存在时绝不覆盖：用户可能已经把工作区指到项目根目录，
   * 覆盖会让插件下次又退回到 MDK 目录。
   */
  ensureFile(): { created: boolean; error?: string } {
    if (this.configFile.IsFile()) {
      return { created: false };
    }

    try {
      const dir = new File(this.configFile.dir);

      if (!dir.IsDir()) {
        dir.CreateDir();
      }

      this.configFile.Write(
        JSON.stringify({ [WORKSPACE_ROOT_KEY]: "." }, undefined, 4) + "\n",
      );

      return { created: true };
    } catch (error: unknown) {
      // 创建失败只影响“记住工作区位置”，工程本身仍应正常打开
      return {
        created: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** 读取配置对象；文件不存在或内容不合法时返回 undefined */
  read(): Record<string, unknown> | undefined {
    return readConfigObject(this.configFile);
  }

  /** 解析后的工作区根目录（含默认值与非法值回退信息） */
  getWorkspaceRootInfo(): WorkspaceRootInfo {
    return resolveWorkspaceRoot(
      this.projectDir.path,
      this.read()?.[WORKSPACE_ROOT_KEY],
    );
  }

  /** 当前实际生效的工作区根目录 */
  getWorkspaceRoot(): string {
    return this.getWorkspaceRootInfo().root;
  }

  /**
   * 保存工作区根目录。
   *
   * 配置里优先写相对路径（如 "../.."），这样整个项目目录换盘符/换机器后
   * 仍然可用；只有跨盘符无法表示相对路径时才写绝对路径。
   */
  setWorkspaceRoot(root: string): void {
    const config = this.read() ?? {};

    config[WORKSPACE_ROOT_KEY] = toConfigPath(this.projectDir.path, root);
    this.configFile.Write(JSON.stringify(config, undefined, 4) + "\n");
  }

  /**
   * 计算运行期文件位置，并确保 '.vscode' 目录存在。
   *
   * 每次调用都重新解析 workspaceRoot，这样用户在设置里改完目录后，
   * 下一次生成 c_cpp_properties.json / 编译日志时立刻生效，无需重载窗口。
   */
  getRuntimePaths(): RuntimePaths {
    const dir = new File(
      this.getWorkspaceRoot() + File.sep + VSCODE_DIR_NAME,
    );

    if (!dir.IsDir()) {
      dir.CreateDir();
    }

    return {
      dir,
      logFile: new File(dir.path + File.sep + RUNTIME_LOG_FILE_NAME),
      uv4LogFile: new File(dir.path + File.sep + RUNTIME_UV4_LOG_FILE_NAME),
      lockFile: new File(dir.path + File.sep + RUNTIME_LOCK_FILE_NAME),
      cppPropertiesFile: new File(
        dir.path + File.sep + CPP_PROPERTIES_FILE_NAME,
      ),
    };
  }

  /**
   * 编译时传给 Uv4Caller 的 'uv4.log' 路径。
   *
   * 单独抽出来是为了让 Target 不必知道 '.vscode' 的具体拼法。
   */
  getUv4LogPath(): string {
    return node_path.join(
      this.getRuntimePaths().dir.path,
      RUNTIME_UV4_LOG_FILE_NAME,
    );
  }
}
