import * as vscode from "vscode";
import * as node_path from "path";

// 允许在配置里使用 ${workspaceFolder} 等变量
import vscodeVariablesModule = require("vscode-variables");

import { File } from "../../lib/node_utility/File";
import { ResourceManager } from "../ResourceManager";
import { getMD5, openWorkspaceFolder, isWorkspaceFolderOpen } from "../common/util";
import { IView } from "../common/tree";
import {
  PROJECT_CONFIG_FILE_NAME,
  readConfigObject,
  readProjectFiles,
  registerProjectInWorkspaceConfig,
  resolveProjectFile,
} from "../config/workspaceConfig";
import { KeilProject } from "../model/keilProject";
import { Source } from "../model/treeItems";
import type { Target } from "../model/target";

const vscodeVariables = vscodeVariablesModule as unknown as (
  value: string,
  recursive?: boolean,
) => string;

/**
 * 侧边栏工程树的提供者，同时负责工程生命周期与工作区切换。
 *
 * 树视图只做展示，工程的解析/构建在 model 层；这里负责：
 * 发现并打开工程、维护活动工程、响应树节点命令、切换工作区。
 */

export class ProjectExplorer
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

        // 工作区配置里登记的工程：切换工作区时由本插件写入。
        // 静态扫描只看工作区根目录，而 MDK 工程通常放在 'Projects/xxx' 子目录里，
        // 没有这份登记，重载之后工程列表会是空的。
        const workspaceConfigFile = new File(
          wsFilePath +
            File.sep +
            ".vscode" +
            File.sep +
            PROJECT_CONFIG_FILE_NAME,
        );
        const registeredProjects = readProjectFiles(
          readConfigObject(workspaceConfigFile),
        ).map((entry) => resolveProjectFile(wsFilePath, entry));

        const seenPaths = new Set<string>();
        const uvList: File[] = [];

        for (const rawPath of workspace
          .GetList([/\.uvproj[x]?$/i], File.EMPTY_FILTER)
          .map((file) => file.path)
          .concat(ResourceManager.getInstance().getProjectFileLocationList())
          .concat(registeredProjects)) {
          const resolvedPath = node_path.resolve(vscodeVariables(rawPath));
          const key =
            process.platform === "win32"
              ? resolvedPath.toLowerCase()
              : resolvedPath;

          if (seenPaths.has(key)) {
            continue;
          }
          seenPaths.add(key);

          const file = new File(resolvedPath);
          if (!excludeList.includes(file.name)) {
            uvList.push(file);
          }
        }

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

  /**
   * 打开工程后的工作区确认流程。
   *
   * 工作区位置来自工程文件旁的 '.vscode/keil-assistant.json'，默认就是工程文件
   * 所在目录；用户可以在通知里直接切换，也可以选择其它目录并把位置写回配置。
   */
  async promptOpenWorkspace(project: KeilProject): Promise<void> {
    const info = project.getWorkspaceRootInfo();

    if (info.invalid !== undefined) {
      void vscode.window.showWarningMessage(
        `Keil Assistant: workspaceRoot '${info.invalid}' is not an existing folder, using '${info.root}' instead.`,
      );
    }

    // 工作区已经是它时不必再弹窗，否则每次打开工程都会多一次窗口重载
    if (isWorkspaceFolderOpen(info.root)) {
      return;
    }

    const picked = await vscode.window.showInformationMessage(
      `Keil project loaded. Open workspace '${info.root}'? The window will be reloaded.`,
      "Open Workspace",
      "Change Location...",
      "Later",
    );

    if (picked === "Open Workspace") {
      this.openProjectWorkspace(project, info.root);
    } else if (picked === "Change Location...") {
      const root = await this.pickWorkspaceRoot(project);

      if (root !== undefined) {
        project.setWorkspaceRoot(root);
        this.openProjectWorkspace(project, root);
      }
    }
  }

  /** 命令：为工程指定工作区根目录，写回工程配置后询问是否立即切换 */
  async setWorkspaceRootCommand(item?: IView): Promise<void> {
    const project = await this.pickProject(item);

    if (!project) {
      void vscode.window.showInformationMessage(
        "Keil Assistant: open a keil project first.",
      );
      return;
    }

    const root = await this.pickWorkspaceRoot(project);

    if (root === undefined) {
      return;
    }

    project.setWorkspaceRoot(root);

    if (isWorkspaceFolderOpen(root)) {
      void vscode.window.showInformationMessage(
        `Keil Assistant: workspace root saved: ${root}`,
      );
      return;
    }

    const picked = await vscode.window.showInformationMessage(
      `Keil Assistant: workspace root saved: ${root}. Open it now?`,
      "Open Workspace",
      "Later",
    );

    if (picked === "Open Workspace") {
      this.openProjectWorkspace(project, root);
    }
  }

  /**
   * 目标目录就是工程文件所在目录时，加载工作区会直接扫描到该工程；
   * 否则先把工程登记到目标工作区的配置里，切换后重载时才能自动重新打开。
   */
  private openProjectWorkspace(project: KeilProject, root: string): void {
    registerProjectInWorkspaceConfig(root, project.uvprjFile, (message) => {
      project.logger.log(message);
    });
    openWorkspaceFolder(root);
  }

  private async pickWorkspaceRoot(
    project: KeilProject,
  ): Promise<string | undefined> {
    const picked = await vscode.window.showOpenDialog({
      openLabel: "Use as workspace root",
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      defaultUri: vscode.Uri.file(project.getWorkspaceRoot()),
    });

    return picked?.[0]?.fsPath;
  }

  /** 命令没有携带树节点时，按“当前活动工程 / 唯一工程 / 用户选择”的顺序确定工程 */
  private async pickProject(item?: IView): Promise<KeilProject | undefined> {
    const fromView = item ? this.prjList.get(item.prjID) : undefined;

    if (fromView) {
      return fromView;
    }

    if (this.currentActiveProject) {
      return this.currentActiveProject;
    }

    const projects = Array.from(this.prjList.values());

    if (projects.length === 1) {
      return projects[0];
    }

    if (projects.length === 0) {
      return undefined;
    }

    const picked = await vscode.window.showQuickPick(
      projects.map((project) => ({
        label: project.label,
        description: project.uvprjFile.path,
        project,
      })),
      { placeHolder: "Select a keil project" },
    );

    return picked?.project;
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
          const filePath = source.file.path;

          if (source.file.IsFile()) {
            // 文件存在，直接打开

            let isPreview: boolean = true;

            if (
              this.itemClickInfo &&
              this.itemClickInfo.name === filePath &&
              this.itemClickInfo.time + 260 > Date.now()
            ) {
              isPreview = false;
            }

            // 重置上一次点击记录
            this.itemClickInfo = {
              name: filePath,
              time: Date.now(),
            };

            vscode.window.showTextDocument(vscode.Uri.file(filePath), {
              preview: isPreview,
            });
          } else {
            vscode.window.showWarningMessage(
              `Not found file: ${filePath}`,
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
      const pair = ResourceManager.getInstance().getIconPairUri(
        icons.light,
        icons.dark,
      );
      if (pair) {
        res.iconPath = pair;
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
