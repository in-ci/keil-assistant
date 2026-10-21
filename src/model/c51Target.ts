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

export class C51Target extends Target {
  protected checkProject(target: XmlNode): Error | undefined {
    const c51 = getXmlNode(target, "TargetOption", "Target51", "C51");
    if (!c51) {
      return new Error(
        "This uVision project is not a C51 project, but has a 'uvproj' suffix.",
      );
    }
    return undefined;
  }

  protected parseRefLines(_target: XmlNode, _lines: string[]): string[] {
    return [];
  }

  protected getOutputFolder(_target: XmlNode): string | undefined {
    return undefined;
  }

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

  protected getSystemIncludes(_target: XmlNode): string[] | undefined {
    const exeFile = new File(ResourceManager.getInstance().getC51UV4Path());
    if (exeFile.IsFile()) {
      return [
        node_path.dirname(exeFile.dir) + File.sep + "C51" + File.sep + "INC",
      ];
    }
    return undefined;
  }

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

  protected getGroups(target: XmlNode): XmlNode[] {
    return getXmlNodes(getXmlValue(target, "Groups", "Group"));
  }

  protected getProblemMatcher(): string[] {
    return ["$c51"];
  }

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
