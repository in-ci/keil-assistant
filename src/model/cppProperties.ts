import { isRecord } from "../common/xml";

/**
 * '.vscode/c_cpp_properties.json' 的数据结构与合法性校验。
 *
 * 该文件由 C/C++ 插件读取，也可能被用户手工编辑；写回之前必须先校验，
 * 结构不合法时宁可放弃本次写入，也不能覆盖掉用户手写的配置。
 */

export interface CppConfiguration {
  name: string;
  includePath?: string[] | undefined;
  defines?: string[] | undefined;
  intelliSenseMode?: string;
  [key: string]: unknown;
}

export interface CppProperties {
  configurations: CppConfiguration[];
  version: number;
  [key: string]: unknown;
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item: unknown) => typeof item === "string")
  );
}


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


export function isCppProperties(value: unknown): value is CppProperties {
  return (
    isRecord(value) &&
    typeof value["version"] === "number" &&
    Array.isArray(value["configurations"]) &&
    value["configurations"].every(isCppConfiguration)
  );
}
