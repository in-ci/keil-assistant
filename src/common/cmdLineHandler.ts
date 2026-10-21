import * as vscode from "vscode";

/**
 * 命令行参数拼接与引用处理工具类。
 *
 * 负责根据当前运行的 Shell（PowerShell、CMD 或 POSIX Shell）统一生成
 * 符合其语法转义规则的安全命令行调用字符串。
 */
export class CmdLineHandler {
  private constructor() {}

  /**
   * 判断目标 shell 是否为 PowerShell 环境。
   */
  static isPowerShell(shellPath?: string): boolean {
    const shell = shellPath ?? vscode.env.shell;
    return /powershell|pwsh/i.test(shell);
  }

  /**
   * 判断目标 shell 是否为 Windows CMD 环境。
   */
  static isCmd(shellPath?: string): boolean {
    const shell = shellPath ?? vscode.env.shell;
    return /cmd\.exe$/i.test(shell);
  }

  /**
   * 拼接完整的可执行命令行。
   *
   * 处理规则：
   * - PowerShell: 包含空格的路径使用单引号包裹，并使用 `& ` 作为调用前缀；
   * - CMD: 包含空格的路径使用双引号包裹，整体首尾增加双引号以兼容 cmd /c；
   * - POSIX / 其他: 单引号包裹转义。
   *
   * @param callerFile 可执行文件路径
   * @param args 命令行参数列表
   * @param isPowershell 是否为 PowerShell 环境（不传时自动检测）
   * @param noQuote 是否跳过参数引号包裹
   * @returns 格式化后的安全命令行文本
   */
  static getCommandLine(
    callerFile: string,
    args: string[],
    isPowershell?: boolean,
    noQuote: boolean = false,
  ): string {
    const isPs =
      isPowershell !== undefined
        ? isPowershell
        : CmdLineHandler.isPowerShell();
    const isCmd =
      isPowershell !== undefined ? !isPowershell : CmdLineHandler.isCmd();
    const quote = isPs ? "'" : '"';
    const callerHeader = isPs ? "& " : "";
    const cmdPrefixSuffix = isCmd ? '"' : "";

    const quotedCaller = this.quoteString(callerFile, quote);
    const quotedArgs = args
      .map((arg) => (noQuote ? arg : this.quoteString(arg, quote)))
      .join(" ");

    return (
      cmdPrefixSuffix +
      callerHeader +
      quotedCaller +
      (quotedArgs.length > 0 ? " " + quotedArgs : "") +
      cmdPrefixSuffix
    );
  }

  /**
   * 移除命令行首尾多余的双引号。
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
  static quoteString(str: string, quote: string = '"'): string {
    return str.includes(" ") && !str.includes(quote)
      ? quote + str + quote
      : str;
  }
}
