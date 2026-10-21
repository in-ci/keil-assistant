import * as fs from "fs";
import * as node_path from "path";

import { File } from "../../lib/node_utility/File";
import type { CppConfiguration } from "../model/cppProperties";
import { isCppProperties } from "../model/cppProperties";

/**
 * clangd 配置文件名，固定放在工作区根目录下（与 .vscode 目录同级）。
 */
export const CLANGD_CONFIG_FILE_NAME = ".clangd";

/**
 * 判断某个宏定义是否与 clangd 不兼容，需要从 .clangd 的 CompileFlags 中过滤剔除。
 *
 * 原因说明：
 * 1. 在 armTarget.ts 中，为兼容 VS Code C/C++ 扩展（ms-vscode.cpptools）的 IntelliSense，
 *    注入了大量伪宏（如 __enable_irq()=、__disable_irq()=、__attribute__(x)=、__asm(x)= 等）。
 * 2. clangd 底层是真正的 LLVM Clang 编译器：
 *    - 当包含 CMSIS 头文件（如 cmsis_armclang.h）时，CMSIS 将 __enable_irq 等声明为真实函数：
 *      `__STATIC_FORCEINLINE void __enable_irq(void)`
 *      若存在预处理器宏 `-D__enable_irq()=`，Clang 预处理器会因 `(void)` 带参调用了无参宏而报错：
 *      `error: too many arguments provided to function-like macro invocation`
 *    - Clang 原生内置了 `__attribute__((...))`、`__declspec(...)`、`__alignof__`、`__asm` 等语法与关键字，
 *      重定义它们会破坏结构体对齐（如 T_UINT16_WRITE 的 packed/aligned）、内联汇编及编译器内置属性。
 *    - Clang 原生内置了 `__builtin_*` 系列函数，重定义会导致严重冲突。
 *
 * @param defineStr 待判断的宏定义字符串（如 "__enable_irq()=" 或 "STM32F407xx"）
 * @returns 若该宏定义对 clangd 有害或不兼容则返回 true，应予以过滤
 */
export function isClangdIncompatibleDefine(defineStr: string): boolean {
  const trimmed = defineStr.trim();
  if (trimmed.length === 0) {
    return true;
  }

  // 1. 过滤所有仿函数宏存根（形如 `name(...)` 或 `name(...)=val`）
  // 例如：__enable_irq()=, __disable_irq()=, __attribute__(x)=, __asm(x)=, __breakpoint(x)=
  const namePart = trimmed.split("=")[0].trim();
  if (namePart.includes("(") && namePart.includes(")")) {
    return true;
  }

  // 2. 过滤 Clang 原生内置函数（__builtin_*）
  if (trimmed.startsWith("__builtin_")) {
    return true;
  }

  // 3. 过滤 Clang 原生关键字/属性重定义（无论是否带参数或等号）
  const blockedKeywords = new Set([
    "__attribute__",
    "__declspec",
    "__alignof__",
    "__alignof",
    "__asm",
    "__asm__",
    "__inline",
    "__inline__",
    "__volatile__",
    "__restrict",
  ]);

  if (blockedKeywords.has(namePart)) {
    return true;
  }

  return false;
}

/**
 * 根据单个目标配置生成 clangd 的 YAML 格式配置文本。
 *
 * @param workspaceRoot 工作区根目录绝对路径（.vscode 所在的父级目录）
 * @param config C/C++ 目标配置对象（包含 includePath 与 defines）
 * @returns 符合 clangd 规范的 YAML 配置字符串
 */
export function generateClangdContent(
  workspaceRoot: string,
  config: CppConfiguration,
): string {
  const flags: string[] = [];

  const defines = config.defines ?? [];
  const includePaths = config.includePath ?? [];

  // 判断是否为 8051 / C51 工程；非 C51 嵌入式工程默认指定 ARM 裸机交叉编译三元组
  const isC51 = defines.some(
    (d) => d.includes("__C51__") || d.includes("__VSCODE_C51__"),
  );
  if (!isC51) {
    flags.push("--target=arm-none-eabi");
  }

  // 抑制 Keil 特有扩展语法、Pragma 与宏重定义产生的无用警告
  flags.push("-Wno-unknown-attributes");
  flags.push("-Wno-unknown-pragmas");
  flags.push("-Wno-macro-redefined");
  flags.push("-Wno-nonportable-include-path");

  // 添加预处理器宏定义（-D...），过滤与 clangd / Clang 不兼容的宏存根
  for (const def of defines) {
    const trimmed = def.trim();
    if (trimmed.length > 0 && !isClangdIncompatibleDefine(trimmed)) {
      flags.push(`-D${trimmed}`);
    }
  }

  // 添加头文件搜索目录（-I...）
  for (const inc of includePaths) {
    const trimmed = inc.trim();
    // 忽略空目录和 VS Code 内部变量 ${default}
    if (trimmed.length === 0 || trimmed === "${default}") {
      continue;
    }

    // 展开 ${workspaceFolder} 变量
    let resolved = trimmed.replace(/\$\{workspaceFolder\}/g, workspaceRoot);

    // 相对路径解析为相对于工作区根目录的绝对路径
    if (!node_path.isAbsolute(resolved)) {
      resolved = node_path.resolve(workspaceRoot, resolved);
    }

    // 统一转换为正斜杠，避免 Windows 反斜杠在 YAML 字符串中的转义问题
    resolved = resolved.replace(/\\/g, "/");
    flags.push(`-I${resolved}`);
  }

  // 构建 .clangd 的 YAML 内容
  const lines: string[] = [
    "# 由 Keil Assistant 自动生成，基于 c_cpp_properties.json 配置",
    "# 用于 clangd 语言服务提供高效的代码补全、定义跳转与诊断分析",
    `# 关联目标: ${config.name}`,
    "CompileFlags:",
    "  Add:",
  ];

  for (const flag of flags) {
    // 使用 JSON.stringify 保证 YAML 双引号字符串标量的正确转义
    lines.push(`    - ${JSON.stringify(flag)}`);
  }

  return lines.join("\n") + "\n";
}

/**
 * 根据 c_cpp_properties.json 的内容或配置对象集合，将 .clangd 文件写入工作区根目录（.vscode 同级）。
 *
 * @param workspaceRoot 工作区根目录路径（.vscode 同级目录）
 * @param source c_cpp_properties.json 对应的 File 对象，或直接传入 CppConfiguration 数组
 * @param activeTargetName 当前活动目标名称（若提供则优先选用对应配置；未提供则默认选用首个配置）
 * @param logger 可选的日志输出流
 * @returns 是否实际写盘（内容未变时不重复写盘，避免引起 clangd 频繁重建索引）
 */
export function writeClangdConfig(
  workspaceRoot: string,
  source: File | CppConfiguration[],
  activeTargetName?: string,
  logger?: Console,
): boolean {
  let configurations: CppConfiguration[];

  if (Array.isArray(source)) {
    configurations = source;
  } else {
    // 从 c_cpp_properties.json 文件中读取解析
    if (!source.IsFile()) {
      return false;
    }

    try {
      const parsed: unknown = JSON.parse(source.Read());
      if (!isCppProperties(parsed)) {
        logger?.log("[Warn] invalid c_cpp_properties.json, skip .clangd generation");
        return false;
      }
      configurations = parsed.configurations;
    } catch (err: unknown) {
      logger?.log(`[Warn] read c_cpp_properties.json failed: ${String(err)}`);
      return false;
    }
  }

  if (configurations.length === 0) {
    return false;
  }

  // 优先选取与活动 Target 匹配的配置项，未匹配时回退到第一个目标配置
  let selectedConfig: CppConfiguration | undefined;
  if (activeTargetName !== undefined) {
    selectedConfig = configurations.find((c) => c.name === activeTargetName);
  }
  if (!selectedConfig) {
    selectedConfig = configurations[0];
  }

  const clangdPath = node_path.join(workspaceRoot, CLANGD_CONFIG_FILE_NAME);
  const newContent = generateClangdContent(workspaceRoot, selectedConfig);

  // 检查现有文件，如果内容未发生改变则跳过写盘，避免触发 clangd 频繁重启和重构索引
  try {
    if (fs.existsSync(clangdPath)) {
      const existing = fs.readFileSync(clangdPath, "utf8").replace(/\r\n/g, "\n");
      if (existing === newContent) {
        return false;
      }
    }

    fs.writeFileSync(clangdPath, newContent, "utf8");
    logger?.log(`[info] .clangd generated at: ${clangdPath}`);
    return true;
  } catch (err: unknown) {
    logger?.log(`[Warn] write .clangd failed: ${String(err)}`);
    return false;
  }
}
