import type { XmlNode } from "../common/xml";
import type { KeilProjectInfo, uVisonInfo } from "./projectInfo";
import { ArmTarget } from "./armTarget";
import { C51Target } from "./c51Target";
import type { Target } from "./target";

/**
 * 根据工程文件后缀创建对应的 Target 实现。
 *
 * 工厂单独成文件，让 KeilProject 不必直接依赖 C51Target / ArmTarget，
 * 新增工具链时只需要改这里。
 */
export function createTarget(
  prjInfo: KeilProjectInfo,
  uvInfo: uVisonInfo,
  targetDOM: XmlNode,
): Target {
  if (prjInfo.uvprjFile.suffix.toLowerCase() === ".uvproj") {
    return new C51Target(prjInfo, uvInfo, targetDOM);
  }

  return new ArmTarget(prjInfo, uvInfo, targetDOM);
}


