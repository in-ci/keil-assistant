import { File } from "../filesystem";
import { isCppProperties } from "../model/cppProperties";
import type {
  CppConfiguration,
  CppProperties,
} from "../model/cppProperties";

/**
 * 把各 Target 的 include/define 合并写入 '.vscode/c_cpp_properties.json'。
 *
 * 设计要点：
 * - 按 `configurations[].name` 合并，保留用户手写的其它字段；
 * - 内容没有变化时不写盘，比对前归一化 CRLF，避免 C/C++ 插件反复重新加载配置；
 * - 原文件结构不合法时只记录日志并放弃，绝不覆盖用户配置。
 *
 * @param file 目标 c_cpp_properties.json 文件实例
 * @param configurations 各 Target 解析出的最新 CppConfiguration 列表
 * @param logger 用于记录异常日志的控制台实例
 */
export function writeCppProperties(
  file: File,
  configurations: CppConfiguration[],
  logger: Console,
): void {
  let origin: string | undefined;

  let obj: CppProperties = {
    configurations: [],
    version: 4,
  };

  if (file.IsFile()) {
    try {
      origin = file.Read();

      const parsed: unknown = JSON.parse(origin);

      if (!isCppProperties(parsed)) {
        throw new Error("Invalid c_cpp_properties.json structure");
      }

      obj = parsed;
    } catch (error) {
      // 保留用户原来的文件：写坏配置比不写更糟
      logger.log(error);
      return;
    }
  }

  const configList = obj.configurations;

  for (const config of configurations) {
    const index = configList.findIndex((conf) => conf.name === config.name);

    if (index === -1) {
      configList.push(config);
    } else {
      configList[index] = Object.assign({}, configList[index], config);
    }
  }

  const content = JSON.stringify(obj, undefined, 4);
  const normalizedOrigin = origin?.replace(/\r\n/g, "\n");

  if (content !== normalizedOrigin) {
    file.Write(content);
  }
}
