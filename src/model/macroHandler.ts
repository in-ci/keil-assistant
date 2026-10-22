/**
 * 把编译器输出的 '#define' 行转成 C/C++ 插件与 Clang 认识的 'NAME=value' 或 'NAME' 形式。
 *
 * 处理策略：
 * 1. 对象式宏（如 '#define STM32F407xx 1'）：转换为 'STM32F407xx=1'；
 * 2. 标志位宏（如 '#define USE_HAL_DRIVER'）：转换为 'USE_HAL_DRIVER'；
 * 3. 函数式宏（如 '#define __align(x) ...'）：仅保留宏名与形参存根（'__align(x)='），避免把复杂实现体写进宏定义；
 * 4. 无法解析或多行续行宏返回 undefined，调用方可安全忽略。
 */
export class MacroHandler {
  /** 普通对象式宏匹配规则（值部分可选） */
  private static readonly OBJECT_MACRO =
    /^#define\s+([A-Za-z_]\w*)(?:\s+(.*))?$/;
  /** 函数式宏匹配规则（形参部分包裹在圆括号内） */
  private static readonly FUNC_MACRO =
    /^#define\s+([A-Za-z_]\w*\([^)]*\))(?:\s+(.*))?$/;

  /**
   * 把一行 '#define' 转换成 defines 表达式。
   *
   * @param macro 原始宏定义文本
   * @returns 规范化的宏定义表达式，无法识别时返回 undefined
   */
  toExpression(macro: string): string | undefined {
    const trimmed = macro.trim();
    if (!trimmed.startsWith("#define")) {
      return undefined;
    }

    const funcMatch = MacroHandler.FUNC_MACRO.exec(trimmed);
    if (funcMatch) {
      return `${funcMatch[1]}=`;
    }

    const objMatch = MacroHandler.OBJECT_MACRO.exec(trimmed);
    if (objMatch) {
      const name = objMatch[1];
      const val = objMatch[2];
      return val !== undefined && val.trim().length > 0
        ? `${name}=${val.trim()}`
        : name;
    }

    return undefined;
  }
}
