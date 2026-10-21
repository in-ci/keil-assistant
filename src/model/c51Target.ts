import * as node_path from "path";

import { File } from "../../lib/node_utility/File";
import { ResourceManager } from "../ResourceManager";
import {
  XmlNode,
  getXmlNode,
  getXmlNodes,
  getXmlText,
  getXmlValue,
} from "../common/xml";
import { Target } from "./target";

/**
 * C51（8051）工程的目标：宏定义、头文件目录与命令行参数都来自 'Target51/C51' 节点。
 */

/**
 * C51（8051）工程的目标实现：宏定义、头文件目录与命令行参数均映射到 XML 中的 'Target51/C51' 节点。
 */
export class C51Target extends Target {
  /**
   * 校验工程节点是否具备有效的 C51 配置。
   */
  protected checkProject(target: XmlNode): Error | undefined {
    const c51 = getXmlNode(target, "TargetOption", "Target51", "C51");
    if (!c51) {
      return new Error(
        "This uVision project is not a C51 project, but has a 'uvproj' suffix.",
      );
    }
    return undefined;
  }

  /**
   * 解析依赖行；C51 工具链不生成 GNU 格式的 .d 依赖文件，故返回空数组。
   */
  protected parseRefLines(_target: XmlNode, _lines: string[]): string[] {
    return [];
  }

  /**
   * 获取输出目录；C51 不支持基于 .d 文件的源码依赖跟踪。
   */
  protected getOutputFolder(_target: XmlNode): string | undefined {
    return undefined;
  }

  /**
   * 获取 C51 编译器的内置系统宏定义（如 reentrant, data, idata, sfr 等）。
   */
  protected getSysDefines(_target: XmlNode): string[] {
    return [
      "__C51__",
      "__VSCODE_C51__",
      "reentrant=",
      "compact=",
      "small=",
      "large=",
      "data=",
      "idata=",
      "pdata=",
      "bdata=",
      "xdata=",
      "code=",
      "bit=char",
      "sbit=char",
      "sfr=char",
      "sfr16=int",
      "sfr32=int",
      "interrupt=",
      "using=",
      "_at_=",
      "_priority_=",
      "_task_=",
    ];
  }

  /**
   * 获取 Keil 安装目录中 C51 工具链的系统头文件目录（C51/INC）。
   */
  protected getSystemIncludes(_target: XmlNode): string[] | undefined {
    const exeFile = new File(ResourceManager.getInstance().getC51UV4Path());
    if (exeFile.IsFile()) {
      return [
        node_path.dirname(exeFile.dir) + File.sep + "C51" + File.sep + "INC",
      ];
    }
    return undefined;
  }

  /**
   * 从 XML 节点中提取 C51 头文件搜索包含目录字符串。
   */
  protected getIncString(target: XmlNode): string {
    return (
      getXmlText(
        getXmlValue(
          target,
          "TargetOption",
          "Target51",
          "C51",
          "VariousControls",
          "IncludePath",
        ),
      ) ?? ""
    );
  }

  /**
   * 从 XML 节点中提取 C51 用户宏定义字符串。
   */
  protected getDefineString(target: XmlNode): string {
    return (
      getXmlText(
        getXmlValue(
          target,
          "TargetOption",
          "Target51",
          "C51",
          "VariousControls",
          "Define",
        ),
      ) ?? ""
    );
  }

  /**
   * 获取目标下的源码文件分组列表。
   */
  protected getGroups(target: XmlNode): XmlNode[] {
    return getXmlNodes(getXmlValue(target, "Groups", "Group"));
  }

  /**
   * 获取 VS Code 任务的问题匹配器。
   */
  protected getProblemMatcher(): string[] {
    return ["$c51"];
  }

  /**
   * 获取 C51 增量构建命令行。
   */
  protected getBuildCommand(): string[] {
    return [
      "--uv4Path",
      ResourceManager.getInstance().getC51UV4Path(),
      "--prjPath",
      this.project.uvprjFile.path,
      "--targetName",
      this.targetName,
      "-c",
      "${uv4Path} -b ${prjPath} -j0 -t ${targetName}",
    ];
  }

  /**
   * 获取 C51 重新构建命令行。
   */
  protected getRebuildCommand(): string[] {
    return [
      "--uv4Path",
      ResourceManager.getInstance().getC51UV4Path(),
      "--prjPath",
      this.project.uvprjFile.path,
      "--targetName",
      this.targetName,
      "-c",
      "${uv4Path} -r ${prjPath} -j0 -t ${targetName}",
    ];
  }

  /**
   * 获取 C51 程序烧录下载命令行。
   */
  protected getDownloadCommand(): string[] {
    return [
      "--uv4Path",
      ResourceManager.getInstance().getC51UV4Path(),
      "--prjPath",
      this.project.uvprjFile.path,
      "--targetName",
      this.targetName,
      "-c",
      "${uv4Path} -f ${prjPath} -j0 -t ${targetName}",
    ];
  }
}
