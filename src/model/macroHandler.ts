/**
 * 把编译器输出的 '#define' 行转成 C/C++ 插件认识的 'NAME=value' 形式。
 *
 * 函数式宏（如 '#define __align(x) ...'）只保留宏名，避免把形参写进 defines。
 */

export class MacroHandler {
  /** 普通宏与函数式宏的匹配规则 */
  private static readonly NORMAL_MACRO = /^#define (\w+) (.*)$/;
  private static readonly FUNC_MACRO = /^#define (\w+\([^)]*\)) (.*)$/;

  /**
   * 把一行 '#define' 转换成 defines 表达式。
   * 无法识别（例如多行宏的续行）时返回 undefined，由调用方跳过。
   */
  toExpression(macro: string): string | undefined {
    let mList = MacroHandler.NORMAL_MACRO.exec(macro);
    if (mList && mList.length > 2) {
      return `${mList[1]}=${mList[2]}`;
    }

    mList = MacroHandler.FUNC_MACRO.exec(macro);
    if (mList && mList.length > 2) {
      return `${mList[1]}=`;
    }
  }
}
