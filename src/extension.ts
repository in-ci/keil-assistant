import * as vscode from "vscode";
import * as crypto from "crypto";
import * as xml2js from "xml2js";
import * as event from "events";
import * as fs from "fs";
import * as node_path from "path";
import * as child_process from "child_process";
// import * as vscodeVariables from 'vscode-variables';
import vscodeVariablesModule = require("vscode-variables");

const vscodeVariables = vscodeVariablesModule as unknown as (
  value: string,
  recursive?: boolean,
) => string;

import { File } from "../lib/node_utility/File";
import { ResourceManager } from "./ResourceManager";
import { FileWatcher } from "../lib/node_utility/FileWatcher";
import { Time } from "../lib/node_utility/Time";
import { CmdLineHandler } from "./CmdLineHandler";

export function activate(context: vscode.ExtensionContext) {
  console.log("---- keil-assistant actived ----");

  // 初始化插件资源
  ResourceManager.getInstance(context);

  const prjExplorer = new ProjectExplorer(context);
  const subscriber = context.subscriptions;

  subscriber.push(
    vscode.commands.registerCommand("explorer.open", async () => {
      const uri = await vscode.window.showOpenDialog({
        openLabel: "Open a keil project",
        canSelectFolders: false,
        canSelectMany: false,
        filters: {
          "keil project xml": ["uvproj", "uvprojx"],
        },
      });

      try {
        if (uri && uri.length > 0) {
          // 打开工程
          const uvPrjPath = uri[0].fsPath;
          await prjExplorer.openProject(uvPrjPath);

          // 切换工作区到工程所在目录
          const result = await vscode.window.showInformationMessage(
            "keil project load done !, switch workspace ?",
            "Ok",
            "Later",
          );
          if (result === "Ok") {
            openWorkspace(new File(node_path.dirname(uvPrjPath)));
          }
        }
      } catch (error) {
        vscode.window.showErrorMessage(
          `open project failed !, msg: ${(<Error>error).message}`,
        );
      }
    }),
  );

  subscriber.push(
    vscode.commands.registerCommand("project.close", (item: IView) =>
      prjExplorer.closeProject(item.prjID),
    ),
  );

  subscriber.push(
    vscode.commands.registerCommand("project.build", (item: IView) =>
      prjExplorer.getTarget(item)?.build(),
    ),
  );

  subscriber.push(
    vscode.commands.registerCommand("project.rebuild", (item: IView) =>
      prjExplorer.getTarget(item)?.rebuild(),
    ),
  );

  subscriber.push(
    vscode.commands.registerCommand("project.download", (item: IView) =>
      prjExplorer.getTarget(item)?.download(),
    ),
  );

  subscriber.push(
    vscode.commands.registerCommand(
      "project.buildAndDownload",
      (item: IView) => {
        void prjExplorer.getTarget(item)?.buildAndDownload();
      },
    ),
  );

  subscriber.push(
    vscode.commands.registerCommand("item.copyValue", (item: IView) =>
      vscode.env.clipboard.writeText(item.tooltip || ""),
    ),
  );

  subscriber.push(
    vscode.commands.registerCommand("project.switch", (item: IView) =>
      prjExplorer.switchTargetByProject(item),
    ),
  );

  subscriber.push(
    vscode.commands.registerCommand("project.active", (item: IView) =>
      prjExplorer.activeProject(item),
    ),
  );

  void prjExplorer.loadWorkspace().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to load Keil workspace: ${message}`);
  });
}

export function deactivate() {
  console.log("---- keil-assistant closed ----");
}

//==================== Global Func===========================

/** 当前是否有 keil 编译/下载任务正在运行 */
function isKeilTaskRunning(): boolean {
  return vscode.tasks.taskExecutions.some(
    (execution) => execution.task.definition.type === "keil-task",
  );
}

function getMD5(data: string): string {
  const md5 = crypto.createHash("md5");
  md5.update(data);
  return md5.digest("hex");
}

function openWorkspace(wsFile: File) {
  vscode.commands.executeCommand(
    "vscode.openFolder",
    vscode.Uri.parse(wsFile.ToUri()),
  );
}

//===============================

interface IView {
  label: string;
  prjID: string;
  icons?: { light: string; dark: string };
  tooltip?: string;
  contextVal?: string;
  getChildViews(): IView[] | undefined;
  /** 是否可能还有子节点；用于计算折叠状态，不必真的构造子节点 */
  hasChildViews(): boolean;
}

/**
 * xml2js 解析得到的 XML 节点。
 * XML 子节点可能是对象、数组、字符串或其他基本类型。
 */
/** 复用的图标对象：同一图标的 { light, dark } 只创建一次 */
const iconPairCache = new Map<string, { light: string; dark: string }>();

/**
 * 取得图标对象。
 * 工程树里可能有上万个节点，每个节点都新建一个对象没有意义。
 */
function getIconPair(name: string): { light: string; dark: string } {
  let pair = iconPairCache.get(name);
  if (pair === undefined) {
    pair = { light: name, dark: name };
    iconPairCache.set(name, pair);
  }
  return pair;
}

type XmlNode = Record<string, unknown>;

function isRecord(value: unknown): value is XmlNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 读取 XML 指定路径上的值。
 *
 * 示例：
 * getXmlValue(target, 'TargetOption', 'Target51', 'C51')
 */
function getXmlValue(value: unknown, ...keys: string[]): unknown {
  let current: unknown = value;

  for (const key of keys) {
    if (!isRecord(current)) {
      return undefined;
    }

    current = current[key];
  }

  return current;
}

/**
 * 获取 XML 对象节点。
 */
function getXmlNode(value: unknown, ...keys: string[]): XmlNode | undefined {
  const result = getXmlValue(value, ...keys);
  return isRecord(result) ? result : undefined;
}

/**
 * 兼容 xml2js 的显式单个对象和多个对象数组。
 */
function getXmlNodes(value: unknown): XmlNode[] {
  const values: unknown[] = Array.isArray(value)
    ? value
    : value === undefined || value === null
      ? []
      : [value];

  return values.filter(isRecord);
}

/**
 * 读取 XML 文本。
 */
function getXmlText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return undefined;
}

interface CppConfiguration {
  name: string;
  includePath?: string[] | undefined;
  defines?: string[] | undefined;
  intelliSenseMode?: string;
  [key: string]: unknown;
}

interface CppProperties {
  configurations: CppConfiguration[];
  version: number;
  [key: string]: unknown;
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item: unknown) => typeof item === "string")
  );
}

function isCppConfiguration(value: unknown): value is CppConfiguration {
  if (!isRecord(value) || typeof value["name"] !== "string") {
    return false;
  }

  const includePath = value["includePath"];
  const defines = value["defines"];

  return (
    (includePath === undefined || isStringArray(includePath)) &&
    (defines === undefined || isStringArray(defines))
  );
}

function isCppProperties(value: unknown): value is CppProperties {
  return (
    isRecord(value) &&
    typeof value["version"] === "number" &&
    Array.isArray(value["configurations"]) &&
    value["configurations"].every(isCppConfiguration)
  );
}

//===============================================

class Source implements IView {
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
    if (this._icons === undefined) {
      let iconName: string;

      if (!this.enable) {
        iconName = "FileExclude_16x";
      } else if (this.checkExists && !this.file.IsFile()) {
        iconName = "FileWarning_16x";
      } else {
        iconName = this.getIconBySuffix(this.file.suffix.toLowerCase());
      }

      this._icons = getIconPair(iconName);
    }

    return this._icons;
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

class FileGroup implements IView {
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

interface KeilProjectInfo {
  prjID: string;

  vscodeDir: File;

  uvprjFile: File;

  logger: Console;

  toAbsolutePath(rePath: string): string;
}

interface uVisonInfo {
  schemaVersion: string | undefined;
}

class KeilProject implements IView, KeilProjectInfo {
  prjID: string;
  label: string;
  tooltip?: string | undefined;
  contextVal?: string | undefined = "Project";
  icons?: { light: string; dark: string } = getIconPair(
    "DeactiveApplication_16x",
  );

  //-------------

  vscodeDir: File;
  uvprjFile: File;
  logger: Console;

  // uVision 工程信息
  uVsionFileInfo: uVisonInfo;

  private activeTargetName: string | undefined;
  private prevUpdateTime: number | undefined;

  /** 防止工程文件被连续保存时并发重载 */
  private isReloading = false;
  private reloadAgain = false;

  /** 上一次成功加载时的工程文件内容，用于跳过没有实际变化的重载 */
  private lastRawContent: string | undefined;

  /** '.vscode/keil-assistant.log' 的写入流，close() 时关闭，避免每次打开工程泄漏文件句柄 */
  private logStream: fs.WriteStream;

  /** 整个工程共用一个 '.vscode' 目录监视器，用于感知 'uv4.log.lock' 变化 */
  private uv4LogWatcher?: FileWatcher;
  private uv4LogFileWatcher?: FileWatcher;
  private uv4LogTimer?: NodeJS.Timeout;

  /** 是否已经关闭，关闭后不再响应监视事件 */
  private isClosed = false;

  protected _event: event.EventEmitter;
  protected watcher: FileWatcher;
  protected targetList: Target[];

  constructor(_uvprjFile: File) {
    this._event = new event.EventEmitter();
    this.uVsionFileInfo = <uVisonInfo>{};
    this.targetList = [];
    this.vscodeDir = new File(_uvprjFile.dir + File.sep + ".vscode");
    this.vscodeDir.CreateDir();
    const logPath = this.vscodeDir.path + File.sep + "keil-assistant.log";
    this.logStream = fs.createWriteStream(logPath, { flags: "a+" });
    this.logger = new console.Console(this.logStream);
    this.uvprjFile = _uvprjFile;
    this.watcher = new FileWatcher(this.uvprjFile);
    this.prjID = getMD5(_uvprjFile.path);
    this.label = _uvprjFile.noSuffixName;
    this.tooltip = _uvprjFile.path;
    this.logger.log(
      "[info] Log at : " + Time.GetInstance().GetTimeStamp() + "\r\n",
    );
    this.watcher.OnChanged = () => {
      if (this.isClosed) {
        return;
      }

      if (
        this.prevUpdateTime === undefined ||
        this.prevUpdateTime + 2000 < Date.now()
      ) {
        this.prevUpdateTime = Date.now(); // reset update time
        setTimeout(() => this.onReload(), 300);
      }
    };
    this.watcher.Watch();

    // 原先每个 Target 各自监视同一个 'uv4.log.lock'：N 个 Target 就占 N 个句柄、
    // 编译后触发 N 次刷新。这里改为整个工程只监视一次 '.vscode' 目录。
    const lockFile = new File(this.vscodeDir.path + File.sep + "uv4.log.lock");
    if (!lockFile.IsFile()) {
      lockFile.Write("");
    }

    const uv4LogWatcher = new FileWatcher(this.vscodeDir);
    uv4LogWatcher.OnChanged = (file) => {
      if (file.name === "uv4.log.lock") {
        this.scheduleSourceRefsUpdate();
      }
    };
    uv4LogWatcher.OnRename = (file) => {
      if (file.name === "uv4.log.lock") {
        this.scheduleSourceRefsUpdate();
      }
    };
    uv4LogWatcher.Watch();
    this.uv4LogWatcher = uv4LogWatcher;

    // 再直接监视锁文件本身：个别文件系统上目录监视可能漏报
    const lockWatcher = new FileWatcher(lockFile);
    lockWatcher.OnChanged = () => this.scheduleSourceRefsUpdate();
    lockWatcher.OnRename = () => this.scheduleSourceRefsUpdate();
    lockWatcher.Watch();
    this.uv4LogFileWatcher = lockWatcher;
  }

  on(event: "dataChanged", listener: () => void): this {
    this._event.on(event, listener);
    return this;
  }

  private async onReload() {
    if (this.isClosed) {
      return;
    }

    if (this.isReloading) {
      // 已经在重载中：记录下来，等本次结束后再跑一次
      this.reloadAgain = true;
      return;
    }

    this.isReloading = true;

    try {
      const rawContent = this.uvprjFile.Read();

      // 工程文件内容没有变化时不必整树重载。
      // uv4.exe 在编译、下载过程中经常只是刷新了工程文件的时间戳，
      // 真正变化的内容（Target/文件组）并没有变，此时重新解析 XML、
      // 重建所有 Target 会白白占用 CPU，还会让侧边栏闪一下。
      if (rawContent === this.lastRawContent) {
        for (const target of this.targetList) {
          void target.updateSourceRefs();
        }

        return;
      }

      await this.load(rawContent);
      this.notifyUpdateView();
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      const errorCode =
        typeof err === "object" && err !== null && "code" in err
          ? (err as NodeJS.ErrnoException).code
          : undefined;

      if (errorCode === "EBUSY") {
        this.logger.log(
          `[Warn] uVision project file '${this.uvprjFile.name}' is locked !, delay 500 ms and retry !`,
        );

        setTimeout(() => this.onReload(), 500);
      } else {
        vscode.window.showErrorMessage(
          `reload project failed !, msg: ${errorMessage}`,
        );
      }
    } finally {
      this.isReloading = false;

      if (this.reloadAgain) {
        this.reloadAgain = false;
        setTimeout(() => this.onReload(), 300);
      }
    }
  }

  async load(rawContent?: string): Promise<void> {
    const xmlText = rawContent ?? this.uvprjFile.Read();
    const parser = new xml2js.Parser({ explicitArray: false });

    const doc: unknown = await parser.parseStringPromise({
      toString: () => xmlText,
    });

    const project = getXmlNode(doc, "Project");

    if (!project) {
      throw new Error("Invalid uVision project XML: missing Project node");
    }

    const targetNodes = getXmlNodes(getXmlValue(project, "Targets", "Target"));

    // 初始化 uVision 信息
    this.uVsionFileInfo.schemaVersion = getXmlText(project["SchemaVersion"]);

    if (targetNodes.length === 0) {
      throw new Error("Invalid uVision project XML: no Target nodes found");
    }

    // 重新加载时先释放上一批 Target 的监视器，否则每次重载都会泄漏句柄
    this.targetList.forEach((target) => target.close());
    this.targetList = [];

    for (const target of targetNodes) {
      this.targetList.push(
        Target.getInstance(this, this.uVsionFileInfo, target),
      );
    }

    // Target 之间没有依赖，并行加载可以缩短大工程的打开时间；
    // 'c_cpp_properties.json' 在全部 Target 就绪后统一写一次。
    await Promise.all(
      this.targetList.map(async (target) => {
        await target.load();
        target.on("dataChanged", () => this.notifyUpdateView());
      }),
    );

    // 目标可能被重命名或删除，清掉已经失效的活动目标，
    // 否则编译命令会拿到 undefined 而毫无提示
    if (
      this.activeTargetName !== undefined &&
      this.getTargetByName(this.activeTargetName) === undefined
    ) {
      this.activeTargetName = undefined;
    }

    this.updateCppProperties();

    // 只有完整加载成功后才会记住文件内容，解析失败时不更新，
    // 这样下次文件变化仍会触发一次完整重载
    this.lastRawContent = xmlText;
  }

  /**
   * 一次性把所有 Target 的 include/define 写入
   * '.vscode/c_cpp_properties.json'。
   *
   * 以前是每个 Target 都读取、解析、重写同一个文件，而且无条件写回，
   * 即使内容没有变化也会让 C/C++ 插件重新加载配置。
   */
  private updateCppProperties(): void {
    const proFile = new File(
      this.vscodeDir.path + File.sep + "c_cpp_properties.json",
    );

    let origin: string | undefined;
    let obj: CppProperties = {
      configurations: [],
      version: 4,
    };

    if (proFile.IsFile()) {
      try {
        origin = proFile.Read();

        const parsed: unknown = JSON.parse(origin);

        if (!isCppProperties(parsed)) {
          throw new Error("Invalid c_cpp_properties.json structure");
        }

        obj = parsed;
      } catch (error) {
        // 文件内容不合法时只记录日志并放弃本次写入，
        // 否则会把用户手写的 C/C++ 配置整体覆盖掉。
        this.logger.log(error);
        return;
      }
    }

    const configList = obj.configurations;

    for (const target of this.targetList) {
      const config = target.getCppPropertiesConfig();

      const index = configList.findIndex((conf) => conf.name === config.name);

      if (index === -1) {
        configList.push(config);
      } else {
        configList[index] = Object.assign({}, configList[index], config);
      }
    }

    const content = JSON.stringify(obj, undefined, 4);
    if (content !== origin) {
      proFile.Write(content);
    }
  }

  notifyUpdateView() {
    this._event.emit("dataChanged");
  }

  /**
   * 防抖后刷新所有 Target 的 '.d' 依赖列表。
   * 一次编译过程中 'uv4.log.lock' 可能被反复改写，而每次刷新都要读取大量
   * '.d' 文件，必须合并为一次。
   */
  private scheduleSourceRefsUpdate() {
    if (this.uv4LogTimer !== undefined) {
      clearTimeout(this.uv4LogTimer);
    }

    this.uv4LogTimer = setTimeout(() => {
      this.uv4LogTimer = undefined;

      if (this.isClosed) {
        return;
      }

      // 编译/下载期间 uv4.exe 会不断改写锁文件和 '.d' 文件，
      // 这时刷新依赖列表既没有意义，还会和编译器抢磁盘；
      // 推迟到任务结束后再刷新一次
      if (isKeilTaskRunning()) {
        this.scheduleSourceRefsUpdate();
        return;
      }

      for (const target of this.targetList) {
        void target.updateSourceRefs();
      }
    }, 500);
  }

  close() {
    if (this.isClosed) {
      return;
    }

    this.isClosed = true;

    if (this.uv4LogTimer !== undefined) {
      clearTimeout(this.uv4LogTimer);
      this.uv4LogTimer = undefined;
    }

    this.uv4LogWatcher?.Close();
    this.uv4LogWatcher = undefined;
    this.uv4LogFileWatcher?.Close();
    this.uv4LogFileWatcher = undefined;

    this.watcher.Close();
    this.targetList.forEach((target) => target.close());
    this.targetList = [];

    this.logger.log("[info] project closed: " + this.label);

    // 结束日志流，否则反复打开/关闭工程会不断累积文件句柄
    this.logStream.end();
  }

  toAbsolutePath(rePath: string): string {
    const path = rePath.replace(/\//g, File.sep);
    if (/^[a-z]:/i.test(path)) {
      return node_path.normalize(path);
    }
    return node_path.normalize(this.uvprjFile.dir + File.sep + path);
  }

  active() {
    this.icons = getIconPair("ActiveApplication_16x");
  }

  deactive() {
    this.icons = getIconPair("DeactiveApplication_16x");
  }

  getTargetByName(name: string): Target | undefined {
    const index = this.targetList.findIndex((t) => {
      return t.targetName === name;
    });
    if (index !== -1) {
      return this.targetList[index];
    }
  }

  setActiveTarget(tName: string) {
    if (tName !== this.activeTargetName) {
      this.activeTargetName = tName;
      this.notifyUpdateView(); // notify data changed
    }
  }

  getActiveTarget(): Target | undefined {
    if (this.activeTargetName) {
      return this.getTargetByName(this.activeTargetName);
    } else if (this.targetList.length > 0) {
      return this.targetList[0];
    }
  }

  getChildViews(): IView[] | undefined {
    if (this.activeTargetName) {
      const target = this.getTargetByName(this.activeTargetName);
      if (target) {
        return [target];
      }
    }

    if (this.targetList.length > 0) {
      return [this.targetList[0]];
    }

    return undefined;
  }

  getTargets(): Target[] {
    return this.targetList;
  }

  hasChildViews(): boolean {
    return this.targetList.length > 0;
  }
}

abstract class Target implements IView {
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

  private uv4LogFile: File;

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
    this.uv4LogFile = new File(
      this.project.vscodeDir.path + File.sep + "uv4.log",
    );
  }

  on(event: "dataChanged", listener: () => void): this {
    this._event.on(event, listener);
    return this;
  }

  static getInstance(
    prjInfo: KeilProjectInfo,
    uvInfo: uVisonInfo,
    targetDOM: XmlNode,
  ): Target {
    if (prjInfo.uvprjFile.suffix.toLowerCase() === ".uvproj") {
      return new C51Target(prjInfo, uvInfo, targetDOM);
    } else {
      return new ArmTarget(prjInfo, uvInfo, targetDOM);
    }
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

  private quoteString(str: string, quote: string = '"'): string {
    return str.includes(" ") ? quote + str + quote : str;
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

    args.push("-o", this.uv4LogFile.path);
    args = args.concat(commands);

    const isCmd = /cmd.exe$/i.test(vscode.env.shell);
    const quote = isCmd ? '"' : "'";
    const invokePrefix = isCmd ? "" : "& ";
    const cmdPrefixSuffix = isCmd ? '"' : "";

    let commandLine = invokePrefix + this.quoteString(builderExe, quote) + " ";
    commandLine += args
      .map((arg) => {
        return this.quoteString(arg, quote);
      })
      .join(" ");

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
      task.execution = new vscode.ShellExecution(
        cmdPrefixSuffix + commandLine + cmdPrefixSuffix,
      );
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
    const tasks: (() => Promise<void>)[] = [];
    let changed = false;

    for (const group of this.fGroups) {
      for (const source of group.sources) {
        if (!source.enable) {
          // 跳过被禁用的源文件
          continue;
        }

        tasks.push(async () => {
          const dPath = File.fromArray([
            outPath,
            source.file.noSuffixName + ".d",
          ]).path;

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
          ).map((rePath) => {
            return this.project.toAbsolutePath(rePath);
          });

          const signature = refFileList.join("\n");
          if (source.refSig === signature) {
            return; // 依赖列表没有变化，保留现有节点
          }

          source.refSig = signature;
          // 只记录路径，子节点等真正展开该文件时再创建
          source.setRefPaths(refFileList);
          changed = true;
        });
      }
    }

    for (let i = 0; i < tasks.length; i += Target.REFS_CONCURRENCY) {
      await Promise.all(
        tasks.slice(i, i + Target.REFS_CONCURRENCY).map((task) => task()),
      );
    }

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

  protected abstract checkProject(target: XmlNode): Error | undefined;

  protected abstract getIncString(target: XmlNode): string;
  protected abstract getDefineString(target: XmlNode): string;
  protected abstract getSysDefines(target: XmlNode): string[];
  protected abstract getGroups(target: XmlNode): XmlNode[];
  protected abstract getSystemIncludes(target: XmlNode): string[] | undefined;

  protected abstract getOutputFolder(target: XmlNode): string | undefined;
  protected abstract parseRefLines(target: XmlNode, lines: string[]): string[];

  protected abstract getProblemMatcher(): string[];
  protected abstract getBuildCommand(): string[];
  protected abstract getRebuildCommand(): string[];
  protected abstract getDownloadCommand(): string[];
}

//===============================================

class C51Target extends Target {
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

class MacroHandler {
  private regMatchers = {
    normal_macro: /^#define (\w+) (.*)$/,
    func_macro: /^#define (\w+\([^)]*\)) (.*)$/,
  };

  toExpression(macro: string): string | undefined {
    let mList = this.regMatchers["normal_macro"].exec(macro);
    if (mList && mList.length > 2) {
      return `${mList[1]}=${mList[2]}`;
    }

    mList = this.regMatchers["func_macro"].exec(macro);
    if (mList && mList.length > 2) {
      return `${mList[1]}=`;
    }
  }
}

class ArmTarget extends Target {
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

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const _line = lines[lineIndex];

      const line =
        _line[_line.length - 1] === "\\"
          ? _line.substring(0, _line.length - 1)
          : _line; // remove char '\'
      const subLines = line.trim().split(/(?<![\\:]) /);

      if (lineIndex === 0) // first line
      {
        for (
          let i = 1;
          i < subLines.length;
          i++ // skip first sub line
        ) {
          resultList.add(subLines[i].trim().replace(/\\ /g, " "));
        }
      } else // other lines, first char is whitespace
      {
        subLines.forEach((item) => {
          resultList.add(item.trim().replace(/\\ /g, " "));
        });
      }
    }

    return Array.from(resultList);
  }

  private ac5_parseRefLines(lines: string[], startIndex: number = 1): string[] {
    const resultList: Set<string> = new Set<string>();

    for (let i = startIndex; i < lines.length; i++) {
      const sepIndex = lines[i].indexOf(": ");
      if (sepIndex > 0) {
        const line: string = lines[i].substring(sepIndex + 1).trim();
        resultList.add(line);
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

      const lines = child_process
        .execSync(cmdLine, {
          timeout: 20000,
          windowsHide: true,
          maxBuffer: 4 * 1024 * 1024,
        })
        .toString()
        .split(/\r\n|\n/);
      const resList: string[] = [];
      const mHandler = new MacroHandler();

      lines
        .filter((line) => {
          return line.trim() !== "";
        })
        .forEach((line) => {
          const value = mHandler.toExpression(line);
          if (value) {
            resList.push(value);
          }
        });

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

  protected getGroups(target: XmlNode): XmlNode[] {
    return getXmlNodes(getXmlValue(target, "Groups", "Group"));
  }

  protected getProblemMatcher(): string[] {
    return ["$armcc", "$gcc"];
  }

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

//================================================

class ProjectExplorer
  implements vscode.TreeDataProvider<IView>, vscode.Disposable
{
  private ItemClickCommand: string = "Item.Click";

  onDidChangeTreeData: vscode.Event<IView | IView[] | undefined | null | void>;
  private viewEvent: vscode.EventEmitter<
    IView | IView[] | undefined | null | void
  >;

  private prjList: Map<string, KeilProject>;
  private currentActiveProject: KeilProject | undefined;

  /** 树视图刷新防抖计时器：一轮加载里会触发很多次 dataChanged */
  private updateViewTimer?: NodeJS.Timeout;

  constructor(context: vscode.ExtensionContext) {
    this.prjList = new Map();
    this.viewEvent = new vscode.EventEmitter<
      IView | IView[] | undefined | null | void
    >();
    this.onDidChangeTreeData = this.viewEvent.event;
    context.subscriptions.push(
      vscode.window.registerTreeDataProvider("project", this),
    );
    context.subscriptions.push(
      vscode.commands.registerCommand(this.ItemClickCommand, (item) =>
        this.onItemClick(item),
      ),
    );
    context.subscriptions.push(this);
  }

  async loadWorkspace() {
    if (
      vscode.workspace.workspaceFolders &&
      vscode.workspace.workspaceFolders.length > 0
    ) {
      const wsFilePath: string =
        vscode.workspace.workspaceFile &&
        vscode.workspace.workspaceFile.scheme === "file"
          ? node_path.dirname(vscode.workspace.workspaceFile.fsPath)
          : vscode.workspace.workspaceFolders[0].uri.fsPath;

      const workspace = new File(wsFilePath);
      if (workspace.IsDir()) {
        const excludeList =
          ResourceManager.getInstance().getProjectExcludeList();

        // const uvList = workspace.GetList([/\.uvproj[x]?$/i], File.EMPTY_FILTER).concat(ResourceManager.getInstance().getProjectFileLocationList())
        //     .filter((file) => { return !excludeList.includes(file.name); });

        const uvList: File[] = workspace
          .GetList([/\.uvproj[x]?$/i], File.EMPTY_FILTER)
          .map((file) => file.path)
          .concat(ResourceManager.getInstance().getProjectFileLocationList())
          .map((path) => new File(vscodeVariables(path)))
          .filter((file) => !excludeList.includes(file.name));

        for (const uvFile of uvList) {
          try {
            await this.openProject(uvFile.path);
          } catch (error) {
            vscode.window.showErrorMessage(
              `open project: '${uvFile.name}' failed !, msg: ${(<Error>error).message}`,
            );
          }
        }
      }
    }
  }

  async openProject(path: string): Promise<KeilProject | undefined> {
    // 先按路径判重：重复打开时不再创建新的 KeilProject，
    // 否则会白白创建一个文件监视器和一个日志写入流，然后被丢弃。
    const prjID = getMD5(path);
    const opened = this.prjList.get(prjID);
    if (opened) {
      return opened;
    }

    const nPrj = new KeilProject(new File(path));

    try {
      await nPrj.load();
    } catch (error) {
      // 加载失败也要立刻释放已创建的资源，避免失败一次泄漏一批句柄
      nPrj.close();
      throw error;
    }

    nPrj.on("dataChanged", () => this.updateView());
    this.prjList.set(nPrj.prjID, nPrj);

    if (this.currentActiveProject === undefined) {
      this.currentActiveProject = nPrj;
      this.currentActiveProject.active();
    }

    this.updateView();

    return nPrj;
  }

  async closeProject(pID: string) {
    const prj = this.prjList.get(pID);
    if (prj) {
      // 关闭的是当前活动工程时要清空引用，否则后续命令会操作已释放的工程
      if (this.currentActiveProject === prj) {
        this.currentActiveProject = undefined;

        // 还有别的工程打开时自动切换过去，避免编译命令找不到活动工程
        for (const other of this.prjList.values()) {
          if (other !== prj) {
            this.currentActiveProject = other;
            other.active();
            break;
          }
        }
      }

      prj.deactive();
      prj.close();
      this.prjList.delete(pID);
      this.updateView();
    }
  }

  async activeProject(view: IView) {
    const project = this.prjList.get(view.prjID);
    if (project) {
      this.currentActiveProject?.deactive();
      this.currentActiveProject = project;
      this.currentActiveProject?.active();
      this.updateView();
    }
  }

  async switchTargetByProject(view: IView) {
    const prj = this.prjList.get(view.prjID);
    if (prj) {
      const tList = prj.getTargets();
      const targetName = await vscode.window.showQuickPick(
        tList.map((ele) => {
          return ele.targetName;
        }),
        {
          canPickMany: false,
          placeHolder: "please select a target name for keil project",
        },
      );
      if (targetName) {
        prj.setActiveTarget(targetName);
      }
    }
  }

  getTarget(view?: IView): Target | undefined {
    if (view) {
      const prj = this.prjList.get(view.prjID);
      if (prj) {
        const targets = prj.getTargets();
        const index = targets.findIndex((target) => {
          return target.targetName === view.label;
        });
        if (index !== -1) {
          return targets[index];
        }
      }
    } else {
      // 取当前活动工程的当前活动目标
      if (this.currentActiveProject) {
        const target = this.currentActiveProject.getActiveTarget();

        if (target === undefined) {
          vscode.window.showWarningMessage("Not found any active target !");
        }

        return target;
      } else {
        vscode.window.showWarningMessage("Not found any active project !");
      }
    }
  }

  /**
   * 合并同一时间窗口内的刷新请求：打开工程时每个 Target 都会触发一次
   * dataChanged，逐次 fire 会让树视图反复重建。
   */
  updateView() {
    if (this.updateViewTimer !== undefined) {
      return;
    }

    this.updateViewTimer = setTimeout(() => {
      this.updateViewTimer = undefined;
      this.viewEvent.fire();
    }, 30);
  }

  dispose() {
    if (this.updateViewTimer !== undefined) {
      clearTimeout(this.updateViewTimer);
      this.updateViewTimer = undefined;
    }

    this.prjList.forEach((prj) => prj.close());
    this.prjList.clear();
    this.currentActiveProject = undefined;
    this.viewEvent.dispose();
  }

  //----------------------------------

  private itemClickInfo: { name: string; time: number } | undefined;

  private async onItemClick(item: IView) {
    switch (item.contextVal) {
      case "Source":
        {
          const source = <Source>item;
          const file = new File(node_path.normalize(source.file.path));

          if (file.IsFile()) {
            // 文件存在，直接打开

            let isPreview: boolean = true;

            if (
              this.itemClickInfo &&
              this.itemClickInfo.name === file.path &&
              this.itemClickInfo.time + 260 > Date.now()
            ) {
              isPreview = false;
            }

            // 重置上一次点击记录
            this.itemClickInfo = {
              name: file.path,
              time: Date.now(),
            };

            vscode.window.showTextDocument(vscode.Uri.parse(file.ToUri()), {
              preview: isPreview,
            });
          } else {
            vscode.window.showWarningMessage(
              `Not found file: ${source.file.path}`,
            );
          }
        }
        break;
      default:
        break;
    }
  }

  getTreeItem(element: IView): vscode.TreeItem | Thenable<vscode.TreeItem> {
    const res = new vscode.TreeItem(element.label);

    res.contextValue = element.contextVal;
    res.tooltip = element.tooltip;
    res.collapsibleState = element.hasChildViews()
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None;

    if (element instanceof Source) {
      res.command = {
        title: element.label,
        command: this.ItemClickCommand,
        arguments: [element],
      };
    }

    const icons = element.icons;
    if (icons) {
      const resources = ResourceManager.getInstance();
      const lightUri = resources.getIconUri(icons.light);
      const darkUri = resources.getIconUri(icons.dark);

      if (lightUri && darkUri) {
        res.iconPath = {
          light: lightUri,
          dark: darkUri,
        };
      }
    }

    return res;
  }

  getChildren(element?: IView): vscode.ProviderResult<IView[]> {
    if (element === undefined) {
      return Array.from(this.prjList.values());
    } else {
      return element.getChildViews();
    }
  }
}
