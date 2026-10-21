import * as node_path from "path";

import { File } from "../../lib/node_utility/File";

/**
 * 工程配置 / 工作区配置共用的文件名，统一放在 `.vscode` 目录下。
 *
 * - 工程文件旁的 `.vscode/keil-assistant.json` 描述“打开该工程时用哪个目录作为工作区”
 * - 工作区根目录的 `.vscode/keil-assistant.json` 描述“本工作区包含哪些 Keil 工程”，
 *   用于切换工作区之后自动重新打开工程
 */
export const PROJECT_CONFIG_FILE_NAME = "keil-assistant.json";

/** 工程配置中描述工作区根目录的字段 */
export const WORKSPACE_ROOT_KEY = "workspaceRoot";

/** 工作区配置中记录工程文件列表的字段 */
export const PROJECT_FILES_KEY = "projectFiles";

/** 工作区根目录的解析结果 */
export interface WorkspaceRootInfo {
  /** 实际使用的工作区根目录 */
  root: string;
  /** 配置文件里写入的原始值（未配置时为 undefined） */
  configured?: string;
  /** 配置了但目录不存在时的原始值 */
  invalid?: string;
}

/**
 * 读取 JSON 配置对象。
 *
 * 配置文件允许用户手工编辑，因此文件不存在、内容不是 JSON 或顶层不是对象时
 * 一律返回 undefined，而不是抛异常让工程加载失败。
 */
export function readConfigObject(
  file: File,
): Record<string, unknown> | undefined {
  if (!file.IsFile()) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(file.Read());

    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // 读取失败或 JSON 非法都按“没有配置”处理
  }

  return undefined;
}

/**
 * 把工作区根目录配置解析为实际目录。
 *
 * 未配置（或配置为空）时回退到工程文件所在目录，保持旧版本的行为；
 * 相对路径以工程文件所在目录为基准；目录不存在时同样回退，并通过 invalid 告知调用方。
 */
export function resolveWorkspaceRoot(
  uvprjDir: string,
  configured: unknown,
): WorkspaceRootInfo {
  if (typeof configured !== "string" || configured.trim() === "") {
    return { root: uvprjDir };
  }

  const value = configured.trim();
  const root = node_path.isAbsolute(value)
    ? node_path.normalize(value)
    : node_path.resolve(uvprjDir, value);

  if (new File(root).IsDir()) {
    return { root, configured: value };
  }

  return { root: uvprjDir, configured: value, invalid: value };
}

/** 判断两个路径是否指向同一个位置（Windows 下路径大小写不敏感） */
export function samePath(a: string, b: string): boolean {
  const left = node_path.resolve(a);
  const right = node_path.resolve(b);

  if (process.platform === "win32") {
    return left.toLowerCase() === right.toLowerCase();
  }

  return left === right;
}

/** 配置文件里统一使用正斜杠，工程整体搬到别的系统后也能解析 */
export function toPosixPath(value: string): string {
  return value.replace(/\\/g, "/");
}

/**
 * 把绝对路径转成相对 baseDir 的配置值。
 * 无法表示成相对路径（例如不同盘符）时保留绝对路径。
 */
export function toConfigPath(baseDir: string, target: string): string {
  const relative = node_path.relative(baseDir, target);

  if (relative === "") {
    return ".";
  }

  return toPosixPath(relative);
}

/** 读取工作区配置中登记的工程文件列表，忽略非法项 */
export function readProjectFiles(config: Record<string, unknown> | undefined): string[] {
  const value = config?.[PROJECT_FILES_KEY];

  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (item): item is string => typeof item === "string" && item.trim() !== "",
  );
}

/** 把配置中登记的工程文件解析为绝对路径（支持相对工作区根目录） */
export function resolveProjectFile(workspaceRoot: string, entry: string): string {
  if (node_path.isAbsolute(entry)) {
    return node_path.normalize(entry);
  }

  return node_path.resolve(workspaceRoot, entry);
}

/** 把工程登记到目标工作区的配置里，返回是否真的写入了文件 */
export function registerProjectInWorkspaceConfig(
  workspaceRoot: string,
  uvprjFile: File,
  log: (message: string) => void,
): boolean {
  // 目标目录就是工程目录时，加载工作区会直接扫描到该工程，无需登记
  if (samePath(workspaceRoot, uvprjFile.dir)) {
    return false;
  }

  try {
    const vscodeDir = new File(workspaceRoot + File.sep + ".vscode");

    if (!vscodeDir.IsDir()) {
      vscodeDir.CreateDir();
    }

    const configFile = new File(
      vscodeDir.path + File.sep + PROJECT_CONFIG_FILE_NAME,
    );
    const config = readConfigObject(configFile) ?? {};
    const entries = readProjectFiles(config);

    // 已经登记过（可能写的是相对路径）就不再重复追加
    const registered = entries.some((entry) =>
      samePath(resolveProjectFile(workspaceRoot, entry), uvprjFile.path),
    );

    if (registered) {
      return false;
    }

    entries.push(toConfigPath(workspaceRoot, uvprjFile.path));
    config[PROJECT_FILES_KEY] = entries;
    configFile.Write(JSON.stringify(config, undefined, 4) + "\n");

    return true;
  } catch (error: unknown) {
    // 登记失败只影响“切换工作区后自动重开工程”，不应阻止用户切换
    log(
      `[Warn] register project to workspace failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}
