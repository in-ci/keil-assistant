import * as fs from "fs";
import * as node_path from "path";

import type { CppConfiguration } from "../model/cppProperties";
import { isClangdIncompatibleDefine } from "./clangdConfigWriter";

/**
 * compile_commands.json 编译数据库文件名，放置在工作区根目录（.vscode 同级）。
 */
export const COMPILE_COMMANDS_FILE_NAME = "compile_commands.json";

/**
 * compile_commands.json 中的单项条目规范。
 */
export interface CompileCommandEntry {
  /** 编译执行的工作目录（工作区根目录绝对路径） */
  directory: string;
  /** 参与编译的源文件路径（.c / .cpp 等） */
  file: string;
  /** 编译参数列表 */
  arguments: string[];
}

/**
 * 根据构建目标配置和源文件列表，生成 compile_commands.json 的条目数组。
 *
 * @param workspaceRoot 工作区根目录路径
 * @param config 目标的 C/C++ 配置（宏与头文件目录）
 * @param sourceFiles 该 Target 参与编译的源文件绝对路径列表
 * @returns 编译命令条目数组
 */
export function generateCompileCommands(
  workspaceRoot: string,
  config: CppConfiguration,
  sourceFiles: string[],
): CompileCommandEntry[] {
  const normWorkspace = workspaceRoot.replace(/\\/g, "/");
  const commonArgs: string[] = ["clang"];

  const defines = config.defines ?? [];
  const includePaths = config.includePath ?? [];

  // 判断是否为 8051 / C51 工程；非 C51 默认指定 ARM 裸机交叉编译三元组
  const isC51 = defines.some(
    (d) => d.includes("__C51__") || d.includes("__VSCODE_C51__"),
  );
  if (!isC51) {
    commonArgs.push("--target=arm-none-eabi");
  }

  // 抑制嵌入式常见无用警告
  commonArgs.push("-Wno-unknown-attributes");
  commonArgs.push("-Wno-unknown-pragmas");
  commonArgs.push("-Wno-macro-redefined");
  commonArgs.push("-Wno-nonportable-include-path");

  // 添加预处理器宏（过滤掉与 Clang / clangd 不兼容的宏存根）
  for (const def of defines) {
    const trimmed = def.trim();
    if (trimmed.length > 0 && !isClangdIncompatibleDefine(trimmed)) {
      commonArgs.push(`-D${trimmed}`);
    }
  }

  // 添加包含路径（-I...）
  for (const inc of includePaths) {
    const trimmed = inc.trim();
    if (trimmed.length === 0 || trimmed === "${default}") {
      continue;
    }

    let resolved = trimmed.replace(/\$\{workspaceFolder\}/g, workspaceRoot);
    if (!node_path.isAbsolute(resolved)) {
      resolved = node_path.resolve(workspaceRoot, resolved);
    }
    resolved = resolved.replace(/\\/g, "/");
    commonArgs.push(`-I${resolved}`);
  }

  // 为每个参与编译的源文件生成一个独立条目
  const entries: CompileCommandEntry[] = [];
  for (const file of sourceFiles) {
    const normFile = file.replace(/\\/g, "/");
    entries.push({
      directory: normWorkspace,
      file: normFile,
      arguments: [...commonArgs, "-c", normFile],
    });
  }

  return entries;
}

/**
 * 将编译数据库写入工作区根目录的 compile_commands.json。
 *
 * 内容未变时不写盘，避免引起 clangd 频繁重建全局索引。
 *
 * @param workspaceRoot 工作区根目录路径
 * @param config 当前活动目标的 C/C++ 配置
 * @param sourceFiles 参与编译的源文件绝对路径列表
 * @param logger 可选日志输出流
 * @returns 是否发生写盘
 */
export function writeCompileCommands(
  workspaceRoot: string,
  config: CppConfiguration,
  sourceFiles: string[],
  logger?: Console,
): boolean {
  if (sourceFiles.length === 0) {
    return false;
  }

  const entries = generateCompileCommands(workspaceRoot, config, sourceFiles);
  const jsonContent = JSON.stringify(entries, undefined, 2) + "\n";
  const filePath = node_path.join(workspaceRoot, COMPILE_COMMANDS_FILE_NAME);

  try {
    if (fs.existsSync(filePath)) {
      const existing = fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
      if (existing === jsonContent) {
        return false;
      }
    }

    fs.writeFileSync(filePath, jsonContent, "utf8");
    logger?.log(`[info] update ${COMPILE_COMMANDS_FILE_NAME} for '${config.name}'`);
    return true;
  } catch (err: unknown) {
    logger?.log(
      `[Warn] write ${COMPILE_COMMANDS_FILE_NAME} failed: ${String(err)}`,
    );
    return false;
  }
}
