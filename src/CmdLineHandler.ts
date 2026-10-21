/**
 * 命令行参数拼接与引用处理工具类。
 *
 * 负责根据当前使用的 Shell（CMD 或 PowerShell）生成符合其语法转义规则的命令行字符串。
 */
export class CmdLineHandler {
  private constructor() {}

  /**
   * 拼接完整的可执行命令行。
   *
   * 处理规则：
   * - PowerShell: 使用单引号包裹包含空格的路径，使用 `& ` 作为调用前缀，如 `& 'path/to/exe' 'arg1'`
   * - CMD: 使用双引号包裹包含空格的参数，整个命令外层视情况添加双引号，如 `""path/to/exe" "arg1""`
   *
   * @param callerFile 可执行文件路径
   * @param args 命令行参数列表
   * @param isPowershell 是否为 PowerShell 环境
   * @param noQuote 是否跳过参数引号包裹
   * @returns 格式化后的命令行文本
   */
  static getCommandLine(
    callerFile: string,
    args: string[],
    isPowershell?: boolean,
    noQuote: boolean = false,
  ): string {
    const quote = isPowershell ? "'" : '"';
    const callerHeader = isPowershell ? "& " : "";
    const cmdPrefixSuffix = isPowershell ? "" : '"';

    const commandLine: string =
      cmdPrefixSuffix +
      callerHeader +
      this.quoteString(callerFile, quote) +
      " " +
      args
        .map((arg) => {
          return noQuote ? arg : this.quoteString(arg, quote);
        })
        .join(" ") +
      cmdPrefixSuffix;

    return commandLine;
  }

  /**
   * 移除命令行首尾多余的双引号。
   *
   * 示例：
   * 输入: `""a b.exe" -a -b -c"`
   * 输出: `"a b.exe" -a -b -c`
   *
   * @param cmdLine 原始命令行字符串
   * @returns 去除首尾最外层引号后的命令行
   */
  static DeleteCmdPrefix(cmdLine: string): string {
    return cmdLine.replace(/^"|"$/g, "");
  }

  /**
   * 当字符串包含空格且尚未被目标引号包裹时，用指定引号包裹它。
   *
   * @param str 目标字符串
   * @param quote 使用的引号字符（双引号或单引号）
   * @returns 处理后的安全参数字符串
   */
  static quoteString(str: string, quote: string): string {
    return str.includes(" ") && !str.includes(quote)
      ? quote + str + quote
      : str;
  }
}
