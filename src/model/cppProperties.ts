import { isRecord } from "../common/xml";

/**
 * '.vscode/c_cpp_properties.json' 的数据结构与合法性校验。
 *
 * 该文件由 C/C++ 插件读取，也可能被用户手工编辑；写回之前必须先校验，
 * 结构不合法时宁可放弃本次写入，也不能覆盖掉用户手写的配置。
 */

/**
 * 单个构建目标的 C/C++ 语言服务配置项。
 */
export interface CppConfiguration {
  /** 配置名称，通常对应 Keil 的 TargetName */
  name: string;
  /** 头文件搜索路径列表（包含绝对路径与变量如 ${default}） */
  includePath?: string[] | undefined;
  /** 宏定义列表（格式如 USE_HAL_DRIVER, __align(x)= 等） */
  defines?: string[] | undefined;
  /** IntelliSense 解析模式 */
  intelliSenseMode?: string;
  [key: string]: unknown;
}

/**
 * c_cpp_properties.json 根对象数据结构。
 */
export interface CppProperties {
  /** 目标配置数组 */
  configurations: CppConfiguration[];
  /** 格式版本号，通常为 4 */
  version: number;
  [key: string]: unknown;
}

/**
 * 校验未知类型值是否为字符串数组。
 */
function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item: unknown) => typeof item === "string")
  );
}

/**
 * 校验对象是否符合 CppConfiguration 配置项结构规范。
 */
export function isCppConfiguration(value: unknown): value is CppConfiguration {
  if (!isRecord(value) || typeof value["name"] !== "string") {
    return false;
  }

  const includePath = value["includePath"];
  const defines = value["defines"];

  return (
    (includePath === undefined || isStringArray(includePath)) &&
    (defines === undefined || isStringArray(defines))
  );
}

/**
 * 校验对象是否为合法的 CppProperties 配置文件对象。
 */
export function isCppProperties(value: unknown): value is CppProperties {
  return (
    isRecord(value) &&
    typeof value["version"] === "number" &&
    Array.isArray(value["configurations"]) &&
    value["configurations"].every(isCppConfiguration)
  );
}
