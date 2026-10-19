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

  // init resource
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
          // load project
          const uvPrjPath = uri[0].fsPath;
          await prjExplorer.openProject(uvPrjPath);

          // switch workspace
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
}

/**
 * xml2js 解析得到的 XML 节点。
 * XML 子节点可能是对象、数组、字符串或其他基本类型。
 */
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

  children: Source[] | undefined;

  /** signature of the last parsed '.d' dependency list, used to skip needless view refreshes */
  refSig?: string;

  private _icons?: { light: string; dark: string };

  // The icon depends on whether the file exists on disk. Resolving it lazily
  // keeps the (potentially thousands of) dependency nodes created after a build
  // from doing a filesystem stat each, and only visible nodes are ever rendered.
  get icons(): { light: string; dark: string } {
    if (this._icons === undefined) {
      const iconName = !this.file.IsFile()
        ? "FileWarning_16x"
        : !this.enable
          ? "FileExclude_16x"
          : this.getIconBySuffix(this.file.suffix.toLowerCase());

      this._icons = { dark: iconName, light: iconName };
    }

    return this._icons;
  }

  constructor(pID: string, f: File, _enable: boolean = true) {
    this.prjID = pID;
    this.enable = _enable;
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
    this.icons = { light: iconName, dark: iconName };
  }

  getChildViews(): IView[] | undefined {
    return this.sources;
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
  icons?: { light: string; dark: string } = {
    light: "DeactiveApplication_16x",
    dark: "DeactiveApplication_16x",
  };

  //-------------

  vscodeDir: File;
  uvprjFile: File;
  logger: Console;

  // uVison info
  uVsionFileInfo: uVisonInfo;

  private activeTargetName: string | undefined;
  private prevUpdateTime: number | undefined;

  /** guards against overlapping reloads triggered by rapid project-file saves */
  private isReloading = false;
  private reloadAgain = false;

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
    this.logger = new console.Console(
      fs.createWriteStream(logPath, { flags: "a+" }),
    );
    this.uvprjFile = _uvprjFile;
    this.watcher = new FileWatcher(this.uvprjFile);
    this.prjID = getMD5(_uvprjFile.path);
    this.label = _uvprjFile.noSuffixName;
    this.tooltip = _uvprjFile.path;
    this.logger.log(
      "[info] Log at : " + Time.GetInstance().GetTimeStamp() + "\r\n",
    );
    this.watcher.OnChanged = () => {
      if (
        this.prevUpdateTime === undefined ||
        this.prevUpdateTime + 2000 < Date.now()
      ) {
        this.prevUpdateTime = Date.now(); // reset update time
        setTimeout(() => this.onReload(), 300);
      }
    };
    this.watcher.Watch();
  }

  on(event: "dataChanged", listener: () => void): this {
    this._event.on(event, listener);
    return this;
  }

  private async onReload() {
    if (this.isReloading) {
      // a reload is already scanning the project, run one more when it is done
      this.reloadAgain = true;
      return;
    }

    this.isReloading = true;

    try {
      this.targetList.forEach((target) => target.close());
      this.targetList = [];
      await this.load();
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

  async load(): Promise<void> {
    const parser = new xml2js.Parser({ explicitArray: false });

    const doc: unknown = await parser.parseStringPromise({
      toString: () => this.uvprjFile.Read(),
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

    for (const target of targetNodes) {
      this.targetList.push(
        Target.getInstance(this, this.uVsionFileInfo, target),
      );
    }

    for (const target of this.targetList) {
      await target.load();
      target.on("dataChanged", () => this.notifyUpdateView());
    }

    this.updateCppProperties();
  }

  /**
   * Writes the include/define settings of every target into
   * '.vscode/c_cpp_properties.json' in one go.
   *
   * It used to be rewritten once per target (read + parse + write of the same
   * file each time), and unconditionally, so the C/C++ extension reloaded its
   * configuration even when nothing had changed.
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
        this.logger.log(error);
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

  close() {
    this.watcher.Close();
    this.targetList.forEach((target) => target.close());
    this.logger.log("[info] project closed: " + this.label);
  }

  toAbsolutePath(rePath: string): string {
    const path = rePath.replace(/\//g, File.sep);
    if (/^[a-z]:/i.test(path)) {
      return node_path.normalize(path);
    }
    return node_path.normalize(this.uvprjFile.dir + File.sep + path);
  }

  active() {
    this.icons = {
      light: "ActiveApplication_16x",
      dark: "ActiveApplication_16x",
    };
  }

  deactive() {
    this.icons = {
      light: "DeactiveApplication_16x",
      dark: "DeactiveApplication_16x",
    };
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
}

abstract class Target implements IView {
  prjID: string;
  label: string;
  tooltip?: string | undefined;
  contextVal?: string | undefined = "Target";
  icons?: { light: string; dark: string } = {
    light: "Class_16x",
    dark: "Class_16x",
  };

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
  private uv4LogLockFileWatcher: FileWatcher;

  /** max number of '.d' files read at the same time when refreshing source refs */
  private static readonly REFS_CONCURRENCY = 32;

  private sourceRefsUpdating: Promise<void> | undefined;
  private sourceRefsDirty = false;
  private sourceRefsTimer?: NodeJS.Timeout;

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
    this.uv4LogLockFileWatcher = new FileWatcher(
      new File(this.uv4LogFile.path + ".lock"),
    );

    if (!this.uv4LogLockFileWatcher.file.IsFile()) {
      // create file if not existed
      this.uv4LogLockFileWatcher.file.Write("");
    }

    this.uv4LogLockFileWatcher.Watch();
    this.uv4LogLockFileWatcher.OnChanged = () =>
      this.scheduleSourceRefsUpdate();
    this.uv4LogLockFileWatcher.on("error", () => {
      this.uv4LogLockFileWatcher.Close();

      if (!this.uv4LogLockFileWatcher.file.IsFile()) {
        // create file if not existed
        this.uv4LogLockFileWatcher.file.Write("");
      }

      this.uv4LogLockFileWatcher.Watch();
    });
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
   * Builds this target's entry for '.vscode/c_cpp_properties.json'.
   *
   * The file itself is written once per project load (see KeilProject), instead
   * of once per target, which used to mean read+parse+write of the same file
   * for every target of the project.
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
    // check target is valid
    const err = this.checkProject(this.targetDOM);
    if (err) {
      throw err;
    }

    const incListStr: string = this.getIncString(this.targetDOM);
    const defineListStr: string = this.getDefineString(this.targetDOM);
    const groups = this.getGroups(this.targetDOM);
    const sysIncludes = this.getSystemIncludes(this.targetDOM);

    // set includes
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

    // set defines
    this.defines.clear();

    // add user macros
    defineListStr.split(/,|\s+/).forEach((define) => {
      if (define.trim() !== "") {
        this.defines.add(define);
      }
    });

    // add system macros
    this.getSysDefines(this.targetDOM).forEach((define) => {
      this.defines.add(define);
    });

    // set file groups
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

  private runTask(name: string, commands: string[]) {
    const resManager = ResourceManager.getInstance();
    let args: string[] = [];

    args.push("-o", this.uv4LogFile.path);
    args = args.concat(commands);

    const isCmd = /cmd.exe$/i.test(vscode.env.shell);
    const quote = isCmd ? '"' : "'";
    const invokePrefix = isCmd ? "" : "& ";
    const cmdPrefixSuffix = isCmd ? '"' : "";

    let commandLine =
      invokePrefix + this.quoteString(resManager.getBuilderExe(), quote) + " ";
    commandLine += args
      .map((arg) => {
        return this.quoteString(arg, quote);
      })
      .join(" ");

    // use task
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
      vscode.tasks.executeTask(task);
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
    }
  }

  build() {
    this.runTask("build", this.getBuildCommand());
  }

  rebuild() {
    this.runTask("rebuild", this.getRebuildCommand());
  }

  download() {
    this.runTask("download", this.getDownloadCommand());
  }

  /**
   * Coalesces '.d' refresh requests: the lock file may change many times during
   * a single build, and concurrent refreshes would read the same files twice.
   */
  private scheduleSourceRefsUpdate() {
    if (this.sourceRefsTimer !== undefined) {
      clearTimeout(this.sourceRefsTimer);
    }

    this.sourceRefsTimer = setTimeout(() => {
      this.sourceRefsTimer = undefined;
      void this.updateSourceRefs();
    }, 500);
  }

  /**
   * Rebuilds the dependency ('*.d') children of every enabled source file.
   *
   * Reads are asynchronous and bounded, so the extension host is not blocked
   * while a build produces them (the previous sync implementation issued a stat
   * and a blocking read per source file).
   */
  updateSourceRefs(): Promise<void> {
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
          // if source not disabled
          continue;
        }

        tasks.push(async () => {
          let content: string;
          try {
            content = await fs.promises.readFile(
              File.fromArray([outPath, source.file.noSuffixName + ".d"]).path,
              "utf8",
            );
          } catch {
            return; // the file has not been built yet
          }

          const refFileList = this.parseRefLines(
            this.targetDOM,
            content.split(/\r\n|\n/),
          ).map((rePath) => {
            return this.project.toAbsolutePath(rePath);
          });

          const signature = refFileList.join("\n");
          if (source.refSig === signature) {
            return; // dependency list unchanged, keep the current nodes
          }

          source.refSig = signature;
          source.children = refFileList.map((refFilePath) => {
            return new Source(source.prjID, new File(refFilePath));
          });
          changed = true;
        });
      }
    }

    for (let i = 0; i < tasks.length; i += Target.REFS_CONCURRENCY) {
      await Promise.all(
        tasks.slice(i, i + Target.REFS_CONCURRENCY).map((task) => task()),
      );
    }

    if (changed) {
      this._event.emit("dataChanged");
    }
  }

  close() {
    if (this.sourceRefsTimer !== undefined) {
      clearTimeout(this.sourceRefsTimer);
      this.sourceRefsTimer = undefined;
    }

    this.uv4LogLockFileWatcher.Close();
  }

  getChildViews(): IView[] | undefined {
    return this.fGroups;
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
      // ARMClang
      return this.gnu_parseRefLines(lines);
    } else {
      // ARMCC
      return this.ac5_parseRefLines(lines);
    }
  }

  /**
   * Probes the built-in macros of armclang.
   *
   * This spawns a compiler process, so it is done on first use (an ARMCC only
   * workspace never pays for it) and the result is cached for the session.
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
      // ARMClang
      ArmTarget.initArmclangMacros();

      return ArmTarget.armclangMacros.concat(
        ArmTarget.armclangBuildinMacros || [],
      );
    } else {
      // ARMCC
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

class ProjectExplorer implements vscode.TreeDataProvider<IView> {
  private ItemClickCommand: string = "Item.Click";

  onDidChangeTreeData: vscode.Event<IView | IView[] | undefined | null | void>;
  private viewEvent: vscode.EventEmitter<
    IView | IView[] | undefined | null | void
  >;

  private prjList: Map<string, KeilProject>;
  private currentActiveProject: KeilProject | undefined;

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
    const nPrj = new KeilProject(new File(path));
    if (!this.prjList.has(nPrj.prjID)) {
      await nPrj.load();
      nPrj.on("dataChanged", () => this.updateView());
      this.prjList.set(nPrj.prjID, nPrj);

      if (
        this.currentActiveProject === undefined ||
        this.currentActiveProject === null
      ) {
        this.currentActiveProject = nPrj;
        this.currentActiveProject.active();
      }

      this.updateView();

      return nPrj;
    }
  }

  async closeProject(pID: string) {
    const prj = this.prjList.get(pID);
    if (prj) {
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
      // get active target
      if (this.currentActiveProject) {
        return this.currentActiveProject.getActiveTarget();
      } else {
        vscode.window.showWarningMessage("Not found any active project !");
      }
    }
  }

  updateView() {
    this.viewEvent.fire();
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
            // file exist, open it

            let isPreview: boolean = true;

            if (
              this.itemClickInfo &&
              this.itemClickInfo.name === file.path &&
              this.itemClickInfo.time + 260 > Date.now()
            ) {
              isPreview = false;
            }

            // reset prev click info
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
    res.collapsibleState =
      element.getChildViews() === undefined
        ? vscode.TreeItemCollapsibleState.None
        : vscode.TreeItemCollapsibleState.Collapsed;

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
