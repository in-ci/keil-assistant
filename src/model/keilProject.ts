import * as vscode from "vscode";
import * as xml2js from "xml2js";
import * as event from "events";
import * as fs from "fs";
import * as node_path from "path";

import { File } from "../../lib/node_utility/File";
import { FileWatcher } from "../../lib/node_utility/FileWatcher";
import { Time } from "../../lib/node_utility/Time";
import { ProjectConfig } from "../config/projectConfig";
import type { RuntimePaths } from "../config/projectConfig";
import type { WorkspaceRootInfo } from "../config/workspaceConfig";
import { RUNTIME_LOCK_FILE_NAME } from "../config/projectConfig";
import { Debouncer } from "../common/debounce";
import { getMD5, isKeilTaskRunning } from "../common/util";
import { IView, getIconPair } from "../common/tree";
import {
  getXmlNode,
  getXmlValue,
  getXmlNodes,
  getXmlText,
} from "../common/xml";
import { writeCppProperties } from "../services/cppPropertiesWriter";
import type { KeilProjectInfo, uVisonInfo } from "./projectInfo";
import { createTarget } from "./targetFactory";
import type { Target } from "./target";

/**
 * 一个 uVision 工程：解析 '.uvprojx'，维护工程配置、运行期文件与目标集合。
 *
 * 每个工程只打开一次（ProjectExplorer 按工程路径去重）；工程文件变化时
 * 重新解析并原地更新树，而不是新建对象，避免泄漏文件监视器与日志句柄。
 */

export class KeilProject implements IView, KeilProjectInfo {
  prjID: string;
  label: string;
  tooltip?: string | undefined;
  contextVal?: string | undefined = "Project";
  // 工程节点图标：浅色窗口轮廓（与源码文件图标同一套调色板），活动工程额外用暖橙标题栏区分
  icons?: { light: string; dark: string } = getIconPair(
    "DeactiveApplication_16x",
  );

  //-------------

  /** 工程配置：workspaceRoot 及由它派生的运行期路径 */
  config: ProjectConfig;

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

  /** 运行期目录（'.vscode'）的监视器，用来感知 'uv4.log.lock' 变化 */
  private runtimeDirWatcher?: FileWatcher;

  /** 锁文件自身的监视器：个别文件系统上目录监视会漏报 */
  private lockFileWatcher?: FileWatcher;

  /** 工程配置文件监视器：workspaceRoot 修改后切换运行期目录 */
  private configWatcher?: FileWatcher;

  /** 依赖列表刷新的防抖器 */
  private readonly sourceRefsDebouncer: Debouncer;

  /** 'c_cpp_properties.json' 重新生成的防抖器 */
  private readonly cppPropertiesDebouncer: Debouncer;

  /** 是否已经关闭，关闭后不再响应监视事件 */
  private isClosed = false;

  /** 路径解析缓存，避免解析成百上千个头文件依赖时重复执行正则与规范化 */
  private readonly toAbsolutePathCache = new Map<string, string>();

  protected _event: event.EventEmitter;
  protected watcher: FileWatcher;
  protected targetList: Target[];

  constructor(_uvprjFile: File) {
    this._event = new event.EventEmitter();
    this.uVsionFileInfo = <uVisonInfo>{};
    this.targetList = [];
    this.uvprjFile = _uvprjFile;
    this.prjID = getMD5(_uvprjFile.path);
    this.label = _uvprjFile.noSuffixName;
    this.tooltip = _uvprjFile.path;

    // 配置固定放在工程文件旁，运行期文件则跟随它解析出的 workspaceRoot
    this.config = new ProjectConfig(_uvprjFile);
    const configState = this.config.ensureFile();
    const runtimePaths = this.config.getRuntimePaths();

    // 日志流在打开工程时确定位置，一次会话内不再搬动，
    // 否则同一份日志会被拆到两个文件；下次打开工程会写到新的工作区目录
    this.logStream = fs.createWriteStream(runtimePaths.logFile.path, {
      flags: "a+",
    });
    this.logger = new console.Console(this.logStream);

    this.logger.log(
      "[info] Log at : " + Time.GetInstance().GetTimeStamp() + "\r\n",
    );

    if (configState.created) {
      this.logger.log(
        `[info] project config created: ${this.config.configFile.path}`,
      );
    } else if (configState.error !== undefined) {
      this.logger.log(
        `[Warn] create project config failed: ${configState.error}`,
      );
    }

    this.sourceRefsDebouncer = new Debouncer(500, () => {
      this.refreshSourceRefs();
    });
    this.cppPropertiesDebouncer = new Debouncer(500, () => {
      this.updateCppProperties();
    });

    this.watcher = new FileWatcher(this.uvprjFile);
    this.watcher.OnChanged = () => this.onProjectFileChanged();
    this.watcher.Watch();

    this.watchConfigFile();
    this.watchRuntimeDir(runtimePaths.dir);
  }

  /** '.uvprojx' 被保存：防抖 300ms 后重载，连续保存只解析一次 */
  private onProjectFileChanged(): void {
    if (this.isClosed) {
      return;
    }

    if (
      this.prevUpdateTime === undefined ||
      this.prevUpdateTime + 2000 < Date.now()
    ) {
      this.prevUpdateTime = Date.now();
      setTimeout(() => this.onReload(), 300);
    }
  }

  /**
   * 监视工程配置。
   *
   * 用户可能直接编辑 '.vscode/keil-assistant.json' 修改 workspaceRoot：
   * 这里重新挂载运行期目录监视器，并让 cpp 配置写到新目录。
   */
  private watchConfigFile(): void {
    const configWatcher = new FileWatcher(this.config.configFile);

    const onConfigChanged = () => {
      if (this.isClosed) {
        return;
      }

      this.watchRuntimeDir(this.getRuntimePaths().dir);
      this.cppPropertiesDebouncer.schedule();
    };

    configWatcher.OnChanged = onConfigChanged;
    configWatcher.OnRename = onConfigChanged;
    configWatcher.Watch();
    this.configWatcher = configWatcher;
  }

  /**
   * 挂载运行期目录的监视器。
   *
   * 编译结束时 uVision 会改写 'uv4.log.lock'；只挂一个目录监视器，
   * 避免每个 Target 各挂一个句柄、编译后触发 N 次刷新。
   */
  private watchRuntimeDir(dir: File): void {
    this.runtimeDirWatcher?.Close();
    this.runtimeDirWatcher = undefined;
    this.lockFileWatcher?.Close();
    this.lockFileWatcher = undefined;

    const lockFile = new File(dir.path + File.sep + RUNTIME_LOCK_FILE_NAME);

    if (!lockFile.IsFile()) {
      lockFile.Write("");
    }

    const dirWatcher = new FileWatcher(dir);
    const onLockFileChanged = (file: File) => {
      if (file.name === RUNTIME_LOCK_FILE_NAME) {
        this.scheduleSourceRefsUpdate();
      }
    };

    dirWatcher.OnChanged = onLockFileChanged;
    dirWatcher.OnRename = onLockFileChanged;
    dirWatcher.Watch();
    this.runtimeDirWatcher = dirWatcher;

    const lockWatcher = new FileWatcher(lockFile);
    lockWatcher.OnChanged = () => this.scheduleSourceRefsUpdate();
    lockWatcher.OnRename = () => this.scheduleSourceRefsUpdate();
    lockWatcher.Watch();
    this.lockFileWatcher = lockWatcher;
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
    this.toAbsolutePathCache.clear();

    for (const target of targetNodes) {
      this.targetList.push(
        createTarget(this, this.uVsionFileInfo, target),
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

  /** 当前工作区对应的运行期路径（日志、uv4.log、锁文件、cpp 配置） */
  getRuntimePaths(): RuntimePaths {
    return this.config.getRuntimePaths();
  }

  /**
   * 读取工程配置，得到打开工程时应使用的工作区根目录。
   * 每次调用都重新读取文件，用户修改配置后无需重载窗口即可生效。
   */
  getWorkspaceRootInfo(): WorkspaceRootInfo {
    return this.config.getWorkspaceRootInfo();
  }

  /** 打开工程时实际使用的工作区根目录 */
  getWorkspaceRoot(): string {
    return this.config.getWorkspaceRoot();
  }

  /** 保存工作区根目录到工程配置，下次打开工程时自动使用 */
  setWorkspaceRoot(root: string): void {
    this.config.setWorkspaceRoot(root);
    this.logger.log(
      `[info] workspace root of '${this.label}' set to '${root}'`,
    );
  }

  /**
   * 一次性把所有 Target 的 include/define 写入工作区的
   * '.vscode/c_cpp_properties.json'。
   *
   * 以前是每个 Target 都读取、解析、重写同一个文件，而且无条件写回，
   * 即使内容没有变化也会让 C/C++ 插件重新加载配置。
   */
  private updateCppProperties(): void {
    if (this.isClosed || this.targetList.length === 0) {
      return;
    }

    writeCppProperties(
      this.getRuntimePaths().cppPropertiesFile,
      this.targetList.map((target) => target.getCppPropertiesConfig()),
      this.logger,
    );
  }

  notifyUpdateView() {
    this._event.emit("dataChanged");
  }

  /** 触发一次依赖列表刷新（由编译锁文件变化调用，内部已防抖） */
  private scheduleSourceRefsUpdate(): void {
    this.sourceRefsDebouncer.schedule();
  }

  /**
   * 刷新所有 Target 的 '.d' 依赖列表。
   *
   * 一次编译过程中 'uv4.log.lock' 可能被反复改写，而每次刷新都要读取大量
   * '.d' 文件；编译/下载期间刷新既没有意义，还会和编译器抢磁盘，
   * 因此推迟到任务结束后再统一刷新一次。
   */
  private refreshSourceRefs(): void {
    if (this.isClosed) {
      return;
    }

    if (isKeilTaskRunning()) {
      this.scheduleSourceRefsUpdate();
      return;
    }

    for (const target of this.targetList) {
      void target.updateSourceRefs();
    }
  }

  close() {
    if (this.isClosed) {
      return;
    }

    this.isClosed = true;

    this.sourceRefsDebouncer.cancel();
    this.cppPropertiesDebouncer.cancel();

    this.configWatcher?.Close();
    this.configWatcher = undefined;
    this.runtimeDirWatcher?.Close();
    this.runtimeDirWatcher = undefined;
    this.lockFileWatcher?.Close();
    this.lockFileWatcher = undefined;

    this.watcher.Close();
    this.targetList.forEach((target) => target.close());
    this.targetList = [];
    this.toAbsolutePathCache.clear();

    this.logger.log("[info] project closed: " + this.label);

    // 结束日志流，否则反复打开/关闭工程会不断累积文件句柄
    this.logStream.end();
  }

  toAbsolutePath(rePath: string): string {
    let resolved = this.toAbsolutePathCache.get(rePath);
    if (resolved !== undefined) {
      return resolved;
    }

    const path = rePath.replace(/\//g, File.sep);
    if (/^[a-z]:/i.test(path)) {
      resolved = node_path.normalize(path);
    } else {
      resolved = node_path.normalize(this.uvprjFile.dir + File.sep + path);
    }

    this.toAbsolutePathCache.set(rePath, resolved);
    return resolved;
  }

  // 当前工程使用带暖橙标题栏的窗口图标，与 Target 的橙色方块呼应
  active() {
    this.icons = getIconPair("ProjectActive_16x");
  }

  // 非当前工程使用灰白窗口图标，弱化但不隐形
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
