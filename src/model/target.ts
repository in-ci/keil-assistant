import * as vscode from "vscode";
import * as event from "events";
import * as fs from "fs";
import * as node_path from "path";

import { File } from "../../lib/node_utility/File";
import { ResourceManager } from "../ResourceManager";
import { CmdLineHandler } from "../common/cmdLineHandler";
import { IView, getIconPair } from "../common/tree";
import {
  XmlNode,
  getXmlNode,
  getXmlNodes,
  getXmlText,
  isRecord,
} from "../common/xml";
import type { CppConfiguration } from "./cppProperties";
import type { KeilProjectInfo, uVisonInfo } from "./projectInfo";
import { FileGroup } from "./treeItems";
import { Source } from "./treeItems";

/**
 * Target（Keil 里的构建目标）的公共实现：解析头文件/宏/文件组、刷新依赖、执行构建。
 *
 * C51 与 ARM 的差异集中在子类里：XML 路径、系统宏、命令行参数、依赖文件格式。
 * 基类只保留与编译器无关的流程，避免两种工具链的逻辑互相牵连。
 */

export abstract class Target implements IView {
  prjID: string;
  label: string;
  tooltip?: string | undefined;
  contextVal?: string | undefined = "Target";
  icons?: { light: string; dark: string } = getIconPair("Class_16x");

  //-------------

  readonly targetName: string;

  protected _event: event.EventEmitter;
  protected project: KeilProjectInfo;
  protected cppConfigName: string;
  protected targetDOM: XmlNode;
  protected uvInfo: uVisonInfo;
  protected fGroups: FileGroup[];
  protected includes: Set<string>;
  protected defines: Set<string>;

  /** 刷新依赖列表时最多同时读取的 '.d' 文件数量 */
  private static readonly REFS_CONCURRENCY = 32;

  private sourceRefsUpdating: Promise<void> | undefined;
  private sourceRefsDirty = false;

  /** 是否已经关闭，关闭后不再发起刷新 */
  private isClosed = false;

  constructor(
    prjInfo: KeilProjectInfo,
    uvInfo: uVisonInfo,
    targetDOM: XmlNode,
  ) {
    this._event = new event.EventEmitter();
    this.project = prjInfo;
    this.targetDOM = targetDOM;
    this.uvInfo = uvInfo;
    this.prjID = prjInfo.prjID;

    const targetName = getXmlText(targetDOM["TargetName"]);
    if (!targetName) {
      throw new Error("Invalid uVision project XML: missing TargetName");
    }
    this.targetName = targetName;

    this.label = this.targetName;
    this.tooltip = this.targetName;
    this.cppConfigName = this.targetName;

    this.includes = new Set();
    this.defines = new Set();
    this.fGroups = [];
  }

  on(event: "dataChanged", listener: () => void): this {
    this._event.on(event, listener);
    return this;
  }

  /**
   * 生成该 Target 在 '.vscode/c_cpp_properties.json' 里的配置项。
   *
   * 文件由 KeilProject 在工程加载完成后统一写一次，而不是每个 Target
   * 各读写一遍同一个文件。
   */
  getCppPropertiesConfig(): CppConfiguration {
    return {
      name: this.cppConfigName,
      includePath: Array.from(this.includes).concat(["${default}"]),
      defines: Array.from(this.defines),
      intelliSenseMode: "${default}",
    };
  }

  async load(): Promise<void> {
    // 检查目标是否可用
    const err = this.checkProject(this.targetDOM);
    if (err) {
      throw err;
    }

    const incListStr: string = this.getIncString(this.targetDOM);
    const defineListStr: string = this.getDefineString(this.targetDOM);
    const groups = this.getGroups(this.targetDOM);
    const sysIncludes = this.getSystemIncludes(this.targetDOM);

    // 设置头文件路径
    this.includes.clear();

    let incList = incListStr.split(";");
    if (sysIncludes) {
      incList = incList.concat(sysIncludes);
    }

    incList.forEach((path) => {
      const realPath = path.trim();
      if (realPath !== "") {
        this.includes.add(this.project.toAbsolutePath(realPath));
      }
    });

    // 设置预处理宏
    this.defines.clear();

    // 添加用户自定义宏
    defineListStr.split(/,|\s+/).forEach((define) => {
      if (define.trim() !== "") {
        this.defines.add(define);
      }
    });

    // 添加系统宏
    this.getSysDefines(this.targetDOM).forEach((define) => {
      this.defines.add(define);
    });

    // 构建文件分组
    this.fGroups = [];

    for (const group of groups) {
      const filesValue = group["Files"];

      if (filesValue === undefined) {
        continue;
      }

      let isGroupExcluded = false;

      const groupCommon = getXmlNode(group, "GroupOption", "CommonProperty");

      if (getXmlText(groupCommon?.["IncludeInBuild"]) === "0") {
        isGroupExcluded = true;
      }

      const groupName = getXmlText(group["GroupName"]) ?? "";

      const nGrp = new FileGroup(this.prjID, groupName, isGroupExcluded);

      const fileList: XmlNode[] = [];

      // 兼容 Files 为数组或单个对象的 XML 结构。
      if (Array.isArray(filesValue)) {
        for (const fileContainer of filesValue) {
          if (isRecord(fileContainer)) {
            fileList.push(...getXmlNodes(fileContainer["File"]));
          }
        }
      } else if (isRecord(filesValue)) {
        fileList.push(...getXmlNodes(filesValue["File"]));
      }

      for (const file of fileList) {
        const filePath = getXmlText(file["FilePath"]);

        if (!filePath) {
          continue;
        }

        const f = new File(this.project.toAbsolutePath(filePath));

        let isFileExcluded = isGroupExcluded;

        const fileCommon = getXmlNode(file, "FileOption", "CommonProperty");

        if (
          !isFileExcluded &&
          getXmlText(fileCommon?.["IncludeInBuild"]) === "0"
        ) {
          isFileExcluded = true;
        }

        const nFile = new Source(this.prjID, f, !isFileExcluded);

        this.includes.add(f.dir);
        nGrp.sources.push(nFile);
      }

      this.fGroups.push(nGrp);
    }

    await this.updateSourceRefs();
  }

  private runTask(
    name: string,
    commands: string[],
  ): Thenable<vscode.TaskExecution> | undefined {
    const resManager = ResourceManager.getInstance();
    const builderExe = resManager.getBuilderExe();

    if (!builderExe) {
      // 'bin' 目录缺失时明确报错，而不是拼一个不存在的路径去执行
      vscode.window.showErrorMessage(
        "Uv4Caller.exe not found, please reinstall the Keil Assistant extension !",
      );
      return;
    }

    let args: string[] = [];

    // 编译输出固定写到当前工作区的 '.vscode/uv4.log'：
    // 每次都现取，workspaceRoot 改了也能立刻生效
    args.push("-o", this.project.getRuntimePaths().uv4LogFile.path);
    args = args.concat(commands);

    const commandLine = CmdLineHandler.getCommandLine(builderExe, args);

    // 有工作区时用任务运行
    if (
      vscode.workspace.workspaceFolders &&
      vscode.workspace.workspaceFolders.length > 0
    ) {
      const task = new vscode.Task(
        { type: "keil-task" },
        vscode.TaskScope.Global,
        name,
        "shell",
      );
      task.execution = new vscode.ShellExecution(commandLine);
      task.isBackground = false;
      task.problemMatchers = this.getProblemMatcher();
      task.presentationOptions = {
        echo: false,
        focus: false,
        clear: true,
      };
      return vscode.tasks.executeTask(task);
    } else {
      const index = vscode.window.terminals.findIndex((ter) => {
        return ter.name === name;
      });

      if (index !== -1) {
        vscode.window.terminals[index].hide();
        vscode.window.terminals[index].dispose();
      }

      const terminal = vscode.window.createTerminal(name);
      terminal.show();
      terminal.sendText(commandLine);

      return undefined;
    }
  }

  build() {
    void this.runTask("build", this.getBuildCommand());
  }

  rebuild() {
    void this.runTask("rebuild", this.getRebuildCommand());
  }

  download() {
    void this.runTask("download", this.getDownloadCommand());
  }

  /** 编译进程退出后稍等一会儿再下载，给 uv4.exe 留出真正退出的时间 */
  private static readonly DOWNLOAD_DELAY_MS = 300;

  /**
   * 编译，并在编译成功后立刻下载到开发板。
   *
   * uv4.exe 每次调用都要重新加载一遍工程，编译和下载各启动一次进程是
   * Keil 命令行本身的限制；这里省掉的是两次调用之间的人工等待——
   * 编译任务一结束就自动接着下载，不用盯着输出再手动点下载。
   */
  async buildAndDownload(): Promise<void> {
    const execution = this.runTask("build", this.getBuildCommand());

    // 没有工作区时 'runTask' 只能往终端下发命令，这里感知不到编译结束；
    // 把两条命令硬拼在一起会让下载指令落进正在编译的进程里，
    // 所以这种情况仍然由用户手动下载
    if (execution === undefined) {
      return;
    }

    const runningTask = await execution;

    const subscription = vscode.tasks.onDidEndTaskProcess((event) => {
      if (event.execution !== runningTask) {
        return;
      }

      subscription.dispose();

      // 编译失败时不再下载，避免把上一次生成的 bin 烧进板子
      if (event.exitCode !== 0) {
        return;
      }

      setTimeout(() => {
        void this.runTask("download", this.getDownloadCommand());
      }, Target.DOWNLOAD_DELAY_MS);
    });
  }

  /**
   * 重新解析每个启用源文件的 '.d' 依赖列表。
   *
   * 读取是异步且限并发的，不会阻塞扩展宿主进程；
   * 旧实现是同步的，每个源文件都要 stat 一次再阻塞读一次。
   */
  updateSourceRefs(): Promise<void> {
    if (this.isClosed) {
      return Promise.resolve();
    }

    if (this.sourceRefsUpdating !== undefined) {
      this.sourceRefsDirty = true;
      return this.sourceRefsUpdating;
    }

    const run = (async () => {
      do {
        this.sourceRefsDirty = false;
        await this.doUpdateSourceRefs();
      } while (this.sourceRefsDirty);
    })();

    this.sourceRefsUpdating = run
      .catch((error: unknown) => {
        this.project.logger.log(error);
      })
      .finally(() => {
        this.sourceRefsUpdating = undefined;
      });

    return this.sourceRefsUpdating;
  }

  private async doUpdateSourceRefs(): Promise<void> {
    const rePath = this.getOutputFolder(this.targetDOM);
    if (!rePath) {
      return;
    }

    const outPath = this.project.toAbsolutePath(rePath);
    let changed = false;

    const sourcesToUpdate: Source[] = [];
    for (const group of this.fGroups) {
      for (const source of group.sources) {
        if (source.enable) {
          sourcesToUpdate.push(source);
        }
      }
    }

    if (sourcesToUpdate.length === 0) {
      return;
    }

    const processSource = async (source: Source): Promise<void> => {
      const dPath = node_path.join(outPath, source.file.noSuffixName + ".d");

      let content: string;
      try {
        // 只 stat 一次：编译后大部分 '.d' 都没变，无需重复读取和解析
        const stats = await fs.promises.stat(dPath);
        if (source.refMtimeMs === stats.mtimeMs) {
          return;
        }

        content = await fs.promises.readFile(dPath, "utf8");
        source.refMtimeMs = stats.mtimeMs;
      } catch {
        return; // 该文件还没有被编译过
      }

      const refFileList = this.parseRefLines(
        this.targetDOM,
        content.split(/\r\n|\n/),
      ).map((itemPath) => {
        return this.project.toAbsolutePath(itemPath);
      });

      const signature = refFileList.join("\n");
      if (source.refSig === signature) {
        return; // 依赖列表没有变化，保留现有节点
      }

      source.refSig = signature;
      // 只记录路径，子节点等真正展开该文件时再创建
      source.setRefPaths(refFileList);
      changed = true;
    };

    let cursor = 0;
    const worker = async () => {
      while (cursor < sourcesToUpdate.length) {
        const source = sourcesToUpdate[cursor++];
        if (source) {
          await processSource(source);
        }
      }
    };

    const workerCount = Math.min(
      Target.REFS_CONCURRENCY,
      sourcesToUpdate.length,
    );
    const workers: Promise<void>[] = [];
    for (let i = 0; i < workerCount; i++) {
      workers.push(worker());
    }
    await Promise.all(workers);

    if (changed && !this.isClosed) {
      this._event.emit("dataChanged");
    }
  }

  close() {
    this.isClosed = true;
  }

  getChildViews(): IView[] | undefined {
    return this.fGroups;
  }

  hasChildViews(): boolean {
    return true;
  }

  /**
   * 获取当前 Target 下所有参与编译的源文件绝对路径列表（.c, .cpp, .cxx, .cc 等）。
   * 仅包含所在 Group 未被排除且文件本身未被排除的源码文件。
   */
  getCompileSourceFiles(): string[] {
    const result: string[] = [];
    const sourceSuffixes = new Set([".c", ".cpp", ".cxx", ".cc", ".c++"]);

    for (const group of this.fGroups) {
      for (const source of group.sources) {
        if (!source.enable) {
          continue;
        }
        const ext = node_path.extname(source.file.path).toLowerCase();
        if (sourceSuffixes.has(ext)) {
          result.push(source.file.path);
        }
      }
    }

    return result;
  }

  /** 检查工程 XML 节点结构是否符合当前目标要求 */
  protected abstract checkProject(target: XmlNode): Error | undefined;

  /** 获取头文件搜索路径原始字符串 */
  protected abstract getIncString(target: XmlNode): string;
  /** 获取预编译宏定义原始字符串 */
  protected abstract getDefineString(target: XmlNode): string;
  /** 获取工具链内置系统宏定义列表 */
  protected abstract getSysDefines(target: XmlNode): string[];
  /** 获取分组节点列表 */
  protected abstract getGroups(target: XmlNode): XmlNode[];
  /** 获取系统内置标准库头文件目录 */
  protected abstract getSystemIncludes(target: XmlNode): string[] | undefined;

  /** 获取构建输出中间产物目录（.d 文件所在目录） */
  protected abstract getOutputFolder(target: XmlNode): string | undefined;
  /** 解析 .d 文件中的头文件依赖行 */
  protected abstract parseRefLines(target: XmlNode, lines: string[]): string[];

  /** 获取 VS Code Task 使用的问题匹配器 ID */
  protected abstract getProblemMatcher(): string[];
  /** 获取增量编译构建参数 */
  protected abstract getBuildCommand(): string[];
  /** 获取全部重新构建参数 */
  protected abstract getRebuildCommand(): string[];
  /** 获取烧录下载参数 */
  protected abstract getDownloadCommand(): string[];
}
