/**
 * uVision 工程文件（XML）的读取辅助。
 *
 * xml2js 解析出来的节点形状并不稳定：只有一个子节点时是对象，多个子节点时是数组，
 * 文本节点可能是字符串/数字/布尔值。这里集中做类型收窄，避免每个调用点重复判断。
 */

export type XmlNode = Record<string, unknown>;


export function isRecord(value: unknown): value is XmlNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 读取 XML 指定路径上的值。
 *
 * 示例：
 * getXmlValue(target, 'TargetOption', 'Target51', 'C51')
 */

export function getXmlValue(value: unknown, ...keys: string[]): unknown {
  let current: unknown = value;

  for (const key of keys) {
    if (!isRecord(current)) {
      return undefined;
    }

    current = current[key];
  }

  return current;
}

/**
 * 获取 XML 对象节点。
 */

export function getXmlNode(value: unknown, ...keys: string[]): XmlNode | undefined {
  const result = getXmlValue(value, ...keys);
  return isRecord(result) ? result : undefined;
}

/**
 * 兼容 xml2js 的显式单个对象和多个对象数组。
 */

export function getXmlNodes(value: unknown): XmlNode[] {
  const values: unknown[] = Array.isArray(value)
    ? value
    : value === undefined || value === null
      ? []
      : [value];

  return values.filter(isRecord);
}

/**
 * 读取 XML 文本。
 */

export function getXmlText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return undefined;
}
