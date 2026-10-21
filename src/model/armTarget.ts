import * as node_path from "path";
import * as child_process from "child_process";

import { File } from "../../lib/node_utility/File";
import { ResourceManager } from "../ResourceManager";
import { CmdLineHandler } from "../CmdLineHandler";
import {
  XmlNode,
  getXmlNodes,
  getXmlText,
  getXmlValue,
} from "../common/xml";
import { MacroHandler } from "./macroHandler";
import { Target } from "./target";

/**
 * ARM（MDK）工程的目标：区分 ARMCC（AC5）与 ARMClang（AC6）两套宏和命令行。
 *
 * ARMClang 的内置宏需要启动一次 armclang.exe 才能拿到，因此延迟到第一次
 * 真正需要时再探测，并在进程内缓存结果。
 */

export class ArmTarget extends Target {
  private static readonly armccMacros: string[] = [
    "__CC_ARM",
    "__arm__",
    "__align(x)=",
    "__ALIGNOF__(x)=",
    "__alignof__(x)=",
    "__asm(x)=",
    "__forceinline=",
    "__restrict=",
    "__global_reg(n)=",
    "__inline=",
    "__int64=long long",
    "__INTADDR__(expr)=0",
    "__irq=",
    "__packed=",
    "__pure=",
    "__smc(n)=",
    "__svc(n)=",
    "__svc_indirect(n)=",
    "__svc_indirect_r7(n)=",
    "__value_in_regs=",
    "__weak=",
    "__writeonly=",
    "__declspec(x)=",
    "__attribute__(x)=",
    "__nonnull__(x)=",
    "__register=",

    "__breakpoint(x)=",
    "__cdp(x,y,z)=",
    "__clrex()=",
    "__clz(x)=0U",
    "__current_pc()=0U",
    "__current_sp()=0U",
    "__disable_fiq()=",
    "__disable_irq()=",
    "__dmb(x)=",
    "__dsb(x)=",
    "__enable_fiq()=",
    "__enable_irq()=",
    "__fabs(x)=0.0",
    "__fabsf(x)=0.0f",
    "__force_loads()=",
    "__force_stores()=",
    "__isb(x)=",
    "__ldrex(x)=0U",
    "__ldrexd(x)=0U",
    "__ldrt(x)=0U",
    "__memory_changed()=",
    "__nop()=",
    "__pld(...)=",
    "__pli(...)=",
    "__qadd(x,y)=0",
    "__qdbl(x)=0",
    "__qsub(x,y)=0",
    "__rbit(x)=0U",
    "__rev(x)=0U",
    "__return_address()=0U",
    "__ror(x,y)=0U",
    "__schedule_barrier()=",
    "__semihost(x,y)=0",
    "__sev()=",
    "__sqrt(x)=0.0",
    "__sqrtf(x)=0.0f",
    "__ssat(x,y)=0",
    "__strex(x,y)=0U",
    "__strexd(x,y)=0",
    "__strt(x,y)=",
    "__swp(x,y)=0U",
    "__usat(x,y)=0U",
    "__wfe()=",
    "__wfi()=",
    "__yield()=",
    "__vfp_status(x,y)=0",
  ];

  private static readonly armclangMacros: string[] = [
    "__alignof__(x)=",
    "__asm(x)=",
    "__asm__(x)=",
    "__forceinline=",
    "__restrict=",
    "__volatile__=",
    "__inline=",
    "__inline__=",
    "__declspec(x)=",
    "__attribute__(x)=",
    "__nonnull__(x)=",
    "__unaligned=",
    "__promise(x)=",
    "__irq=",
    "__swi=",
    "__weak=",
    "__register=",
    "__pure=",
    "__value_in_regs=",

    "__breakpoint(x)=",
    "__current_pc()=0U",
    "__current_sp()=0U",
    "__disable_fiq()=",
    "__disable_irq()=",
    "__enable_fiq()=",
    "__enable_irq()=",
    "__force_stores()=",
    "__memory_changed()=",
    "__schedule_barrier()=",
    "__semihost(x,y)=0",
    "__vfp_status(x,y)=0",

    "__builtin_arm_nop()=",
    "__builtin_arm_wfi()=",
    "__builtin_arm_wfe()=",
    "__builtin_arm_sev()=",
    "__builtin_arm_sevl()=",
    "__builtin_arm_yield()=",
    "__builtin_arm_isb(x)=",
    "__builtin_arm_dsb(x)=",
    "__builtin_arm_dmb(x)=",

    "__builtin_bswap32(x)=0U",
    "__builtin_bswap16(x)=0U",
    "__builtin_arm_rbit(x)=0U",

    "__builtin_clz(x)=0U",
    "__builtin_arm_ldrex(x)=0U",
    "__builtin_arm_strex(x,y)=0U",
    "__builtin_arm_clrex()=",
    "__builtin_arm_ssat(x,y)=0U",
    "__builtin_arm_usat(x,y)=0U",
    "__builtin_arm_ldaex(x)=0U",
    "__builtin_arm_stlex(x,y)=0U",
  ];

  private static armclangBuildinMacros: string[] | undefined;

  protected checkProject(_target: XmlNode): Error | undefined {
    return undefined;
  }

  protected getOutputFolder(target: XmlNode): string | undefined {
    return getXmlText(
      getXmlValue(
        target,
        "TargetOption",
        "TargetCommonOption",
        "OutputDirectory",
      ),
    );
  }

  private gnu_parseRefLines(lines: string[]): string[] {
    const resultList: Set<string> = new Set();
    const len = lines.length;
    if (len === 0) {
      return [];
    }

    // 第一行去掉目标文件前缀（如 "main.o:"）
    let firstLine = lines[0];
    const colonIndex = firstLine.indexOf(":");
    if (colonIndex !== -1) {
      firstLine = firstLine.substring(colonIndex + 1);
    }

    for (let lineIndex = 0; lineIndex < len; lineIndex++) {
      let line = lineIndex === 0 ? firstLine : lines[lineIndex];
      if (!line) {
        continue;
      }

      line = line.trim();
      if (line.length === 0) {
        continue;
      }

      // 去掉行尾续行反斜杠
      if (line.charCodeAt(line.length - 1) === 92 /* '\\' */) {
        line = line.substring(0, line.length - 1).trimEnd();
      }

      if (line.length === 0) {
        continue;
      }

      // 按未转义的空格切分，保留包含转义空格的路径（"\\ "）
      const subLines = line.split(/(?<!\\) +/);
      for (const item of subLines) {
        const trimmed = item.trim();
        if (trimmed.length > 0) {
          resultList.add(trimmed.replace(/\\ /g, " "));
        }
      }
    }

    return Array.from(resultList);
  }

  private ac5_parseRefLines(lines: string[], startIndex: number = 1): string[] {
    const resultList: Set<string> = new Set<string>();

    for (let i = startIndex; i < lines.length; i++) {
      const sepIndex = lines[i].indexOf(": ");
      if (sepIndex > 0) {
        const line: string = lines[i].substring(sepIndex + 2).trim();
        if (line.length > 0) {
          resultList.add(line);
        }
      }
    }

    return Array.from(resultList);
  }

  protected parseRefLines(target: XmlNode, lines: string[]): string[] {
    const isArmClang = getXmlText(target["uAC6"]) === "1";

    if (isArmClang) {
      // ARMClang 编译器
      return this.gnu_parseRefLines(lines);
    } else {
      // ARMCC 编译命令
      return this.ac5_parseRefLines(lines);
    }
  }

  /**
   * 探测 armclang 的内置宏。
   *
   * 这里会拉起一个编译器进程，所以推迟到真正用到时再做（只用 ARMCC 的
   * 工程完全不会付出这个代价），结果在本次会话内缓存。
   */
  private static initArmclangMacros() {
    if (ArmTarget.armclangBuildinMacros === undefined) {
      const armClangPath =
        node_path.dirname(
          node_path.dirname(ResourceManager.getInstance().getArmUV4Path()),
        ) +
        File.sep +
        "ARM" +
        File.sep +
        "ARMCLANG" +
        File.sep +
        "bin" +
        File.sep +
        "armclang.exe";
      ArmTarget.armclangBuildinMacros = new File(armClangPath).IsFile()
        ? ArmTarget.getArmClangMacroList(armClangPath)
        : ["__GNUC__=4", "__GNUC_MINOR__=2", "__GNUC_PATCHLEVEL__=1"];
    }
  }

  protected getSysDefines(target: XmlNode): string[] {
    const isArmClang = getXmlText(target["uAC6"]) === "1";
    if (isArmClang) {
      // ARMClang 编译命令
      ArmTarget.initArmclangMacros();

      return ArmTarget.armclangMacros.concat(
        ArmTarget.armclangBuildinMacros || [],
      );
    } else {
      // ARMCC 编译命令
      return ArmTarget.armccMacros;
    }
  }

  private static getArmClangMacroList(armClangPath: string): string[] {
    try {
      const cmdLine =
        CmdLineHandler.quoteString(armClangPath, '"') +
        " " +
        ["--target=arm-arm-none-eabi", "-E", "-dM", "-", "<nul"].join(" ");

      const output = child_process
        .execSync(cmdLine, {
          timeout: 20000,
          windowsHide: true,
          maxBuffer: 4 * 1024 * 1024,
        })
        .toString();
      const lines = output.split(/\r\n|\n/);
      const resList: string[] = [];
      const mHandler = new MacroHandler();

      for (const line of lines) {
        if (line.trim().length === 0) {
          continue;
        }
        const value = mHandler.toExpression(line);
        if (value) {
          resList.push(value);
        }
      }

      return resList;
    } catch {
      return ["__GNUC__=4", "__GNUC_MINOR__=2", "__GNUC_PATCHLEVEL__=1"];
    }
  }

  protected getSystemIncludes(target: XmlNode): string[] | undefined {
    const exeFile = new File(ResourceManager.getInstance().getArmUV4Path());
    if (exeFile.IsFile()) {
      const isArmClang = getXmlText(target["uAC6"]) === "1";
      const toolName = isArmClang ? "ARMCLANG" : "ARMCC";

      const incDir = new File(
        `${node_path.dirname(exeFile.dir)}${File.sep}ARM${File.sep}${toolName}${File.sep}include`,
      );

      if (incDir.IsDir()) {
        return [incDir.path].concat(
          incDir.GetList(File.EMPTY_FILTER).map((dir) => {
            return dir.path;
          }),
        );
      }
      return [incDir.path];
    }
    return undefined;
  }

  /**
   * 从 XML 中提取 TargetArmAds 节点配置的头文件包含目录。
   */
  protected getIncString(target: XmlNode): string {
    return (
      getXmlText(
        getXmlValue(
          target,
          "TargetOption",
          "TargetArmAds",
          "Cads",
          "VariousControls",
          "IncludePath",
        ),
      ) ?? ""
    );
  }

  /**
   * 从 XML 中提取 TargetArmAds 节点配置的用户宏定义。
   */
  protected getDefineString(target: XmlNode): string {
    return (
      getXmlText(
        getXmlValue(
          target,
          "TargetOption",
          "TargetArmAds",
          "Cads",
          "VariousControls",
          "Define",
        ),
      ) ?? ""
    );
  }

  /**
   * 获取 ARM 工程中的源码分组节点列表。
   */
  protected getGroups(target: XmlNode): XmlNode[] {
    return getXmlNodes(getXmlValue(target, "Groups", "Group"));
  }

  /**
   * 获取支持 ARMCC 与 GCC (ARMClang) 报错格式的问题匹配器。
   */
  protected getProblemMatcher(): string[] {
    return ["$armcc", "$gcc"];
  }

  /**
   * 构造 ARM 增量构建命令参数。
   */
  protected getBuildCommand(): string[] {
    return [
      "--uv4Path",
      ResourceManager.getInstance().getArmUV4Path(),
      "--prjPath",
      this.project.uvprjFile.path,
      "--targetName",
      this.targetName,
      "-c",
      "${uv4Path} -b ${prjPath} -j0 -t ${targetName}",
    ];
  }

  /**
   * 构造 ARM 全量重新构建命令参数。
   */
  protected getRebuildCommand(): string[] {
    return [
      "--uv4Path",
      ResourceManager.getInstance().getArmUV4Path(),
      "--prjPath",
      this.project.uvprjFile.path,
      "--targetName",
      this.targetName,
      "-c",
      "${uv4Path} -r ${prjPath} -j0 -t ${targetName}",
    ];
  }

  /**
   * 构造 ARM 固件烧录下载命令参数。
   */
  protected getDownloadCommand(): string[] {
    return [
      "--uv4Path",
      ResourceManager.getInstance().getArmUV4Path(),
      "--prjPath",
      this.project.uvprjFile.path,
      "--targetName",
      this.targetName,
      "-c",
      "${uv4Path} -f ${prjPath} -j0 -t ${targetName}",
    ];
  }
}
