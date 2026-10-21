import { File } from "../../lib/node_utility/File";
import { IView, getIconPair } from "../common/tree";

/**
 * 树视图里的叶子节点：源文件（Source）与文件组（FileGroup）。
 *
 * 这两类节点只负责展示，不持有工程级状态；它们的父子关系由 Target 组装。
 * 依赖文件（'.d' 中列出的头文件）也用 Source 表示，但只在展开时才创建。
 */

export class Source implements IView {
  label: string;
  prjID: string;
  tooltip?: string | undefined;
  contextVal?: string | undefined = "Source";

  //---
  readonly file: File;
  readonly enable: boolean;

  /** 依赖文件路径；子节点在展开时才真正创建 */
  private refPaths?: string[];
  private _children?: Source[];

  /** 上一次解析出的 '.d' 依赖列表签名，用于跳过没有变化的刷新 */
  refSig?: string;

  /** 上一次读取的 '.d' 文件修改时间；文件未变时不必再读 */
  refMtimeMs?: number;

  /**
   * 依赖列表按需构造：一个工程的依赖项可能有几千个，
   * 全部提前构造会让每次编译后的刷新都分配大量对象。
   */
  get children(): Source[] | undefined {
    if (this._children === undefined && this.refPaths !== undefined) {
      this._children = this.refPaths.map((refFilePath) => {
        // 依赖项来自 '.d'，刚刚才被编译器写出，不必再做存在性检查
        return new Source(this.prjID, new File(refFilePath), true, false);
      });
      this.refPaths = undefined;
    }

    return this._children;
  }

  set children(value: Source[] | undefined) {
    this._children = value;
    this.refPaths = undefined;
  }

  /** 更新依赖文件路径（不立即创建子节点） */
  setRefPaths(paths: string[]) {
    this.refPaths = paths;
    this._children = undefined;
  }

  private _icons?: { light: string; dark: string };

  /** 是否需要检查文件是否真实存在（依赖项不必检查） */
  private readonly checkExists: boolean;

  // 图标依赖文件是否存在，这里惰性求值：
  // 编译后产生的依赖节点可能有几千个，只有真正渲染出来的才需要算。
  get icons(): { light: string; dark: string } {
    // 用局部变量承接，避免 getter 里对 this._icons 的窄化被函数调用打断
    let icons = this._icons;

    if (icons === undefined) {
      let iconName: string;

      if (!this.enable) {
        iconName = "FileExclude_16x";
      } else if (this.checkExists && !this.file.IsFile()) {
        iconName = "FileWarning_16x";
      } else {
        iconName = this.getIconBySuffix(this.file.suffix.toLowerCase());
      }

      icons = getIconPair(iconName);
      this._icons = icons;
    }

    return icons;
  }

  constructor(
    pID: string,
    f: File,
    _enable: boolean = true,
    _checkExists: boolean = true,
  ) {
    this.prjID = pID;
    this.enable = _enable;
    this.checkExists = _checkExists;
    this.file = f;
    this.label = this.file.name;
    this.tooltip = f.path;
  }

  private getIconBySuffix(suffix: string): string {
    switch (suffix) {
      case ".c":
        return "CFile_16x";
      case ".h":
      case ".hpp":
      case ".hxx":
      case ".inc":
        return "CPPHeaderFile_16x";
      case ".cpp":
      case ".c++":
      case ".cxx":
      case ".cc":
        return "CPP_16x";
      case ".s":
      case ".a51":
      case ".asm":
        return "AssemblerSourceFile_16x";
      case ".lib":
      case ".a":
        return "Library_16x";
      default:
        return "Text_16x";
    }
  }

  getChildViews(): IView[] | undefined {
    return this.children;
  }

  hasChildViews(): boolean {
    return this._children !== undefined || this.refPaths !== undefined;
  }
}

export class FileGroup implements IView {
  label: string;
  prjID: string;
  tooltip?: string | undefined;
  contextVal?: string | undefined = "FileGroup";
  icons?: { light: string; dark: string };

  //----
  sources: Source[];

  constructor(pID: string, gName: string, disabled: boolean) {
    this.label = gName;
    this.prjID = pID;
    this.sources = [];
    this.tooltip = gName;
    const iconName = disabled ? "FolderExclude_32x" : "Folder_32x";
    this.icons = getIconPair(iconName);
  }

  getChildViews(): IView[] | undefined {
    return this.sources;
  }

  hasChildViews(): boolean {
    return true;
  }
}
