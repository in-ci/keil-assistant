import * as fs from "fs";
import * as node_path from "path";

import { File } from "../filesystem";

/**
 * 默认生成的 VS Code 设置文件名。
 */
export const VSCODE_SETTINGS_FILE_NAME = "settings.json";

/**
 * 默认生成的 .vscode/settings.json 内容。
 *
 * 作用与性能优化考量：
 * 1. search.exclude:
 *    - 排除 node_modules、bower_components、.cache、.code-search 等常见大型缓存与依赖目录；
 *    - 排除由本插件生成的巨型编译数据库文件（compile_commands.json）与 .clangd 配置文件，
 *      避免 VS Code 全局搜索时在这些包含海量重复路径或编译标志的文件中消耗大量 CPU 和内存，
 *      显著减轻 VS Code 搜索索引、文件监视与编辑器的后台响应负担；
 * 2. terminal.integrated.defaultProfile.windows:
 *    - 设为 null，保持 Windows 平台遵循 VS Code 默认终端配置或系统缺省设置。
 */
export const DEFAULT_VSCODE_SETTINGS = {
  "terminal.integrated.defaultProfile.windows": null,
  "files.encoding": "gb2312",
  "git-graph.fileEncoding": "gb2312",
  "search.exclude": {
    "**/node_modules": true,
    "**/bower_components": true,
    "**/*.code-search": true,
    "**/*.cache": true,
    "**/compile_commands.json": true,
    "**/.clangd": true,
  },
};

/**
 * 生成并格式化 settings.json 的文本内容。
 *
 * @returns 标准 2 空格缩进的 JSON 字符串（末尾带换行符）
 */
export function generateVscodeSettingsContent(): string {
  return JSON.stringify(DEFAULT_VSCODE_SETTINGS, undefined, 2) + "\n";
}

/**
 * 在工作区根目录的 '.vscode/settings.json' 中生成初始配置。
 *
 * 关键设计原则：
 * 1. **存在即跳过**：若目标 settings.json 已经存在（无论是用户之前自定义的，还是过往打开工程时生成的），
 *    严格跳过不写盘，绝不覆盖用户的已有配置，同时也消除重复打开工程时的无用磁盘 I/O。
 * 2. **按需建目录**：若目标目录（如 .vscode）尚不存在，自动递归创建。
 * 3. **格式合规**：采用标准 JSON 缩进排版，消除末尾逗号，确保各版本 VS Code / JSON 解析器均能零警告解析。
 *
 * @param workspaceRootOrFile 工作区根目录路径，或直接指向目标 settings.json 的路径/File 实例
 * @param logger 可选的控制台日志输出对象
 * @returns 若新建了 settings.json 则返回 true；若文件已存在跳过或写入异常则返回 false
 */
export function writeVscodeSettings(
  workspaceRootOrFile: string | File,
  logger?: Console,
): boolean {
  try {
    let targetPath: string;

    if (workspaceRootOrFile instanceof File) {
      targetPath = workspaceRootOrFile.path;
    } else if (
      workspaceRootOrFile.endsWith(".json") ||
      (workspaceRootOrFile.includes(node_path.sep) &&
        node_path.basename(workspaceRootOrFile).includes("."))
    ) {
      targetPath = workspaceRootOrFile;
    } else {
      targetPath = node_path.join(
        workspaceRootOrFile,
        ".vscode",
        VSCODE_SETTINGS_FILE_NAME,
      );
    }

    // 1. 若 settings.json 已存在，则直接跳过，避免覆盖用户设置与重复写盘
    if (fs.existsSync(targetPath)) {
      return false;
    }

    // 2. 确保父级目录（.vscode）存在
    const dir = node_path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // 3. 写入格式化配置内容
    const content = generateVscodeSettingsContent();
    fs.writeFileSync(targetPath, content, "utf-8");

    if (logger) {
      logger.log(`[info] Created initial settings: ${targetPath}`);
    }

    return true;
  } catch (error) {
    if (logger) {
      logger.log(`[warn] Failed to create vscode settings: ${String(error)}`);
    }
    return false;
  }
}
