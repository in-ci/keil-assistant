import * as vscode from "vscode";
import { File } from "../lib/node_utility/File";

let _instance: ResourceManager | undefined;

const dirList: string[] = [
  File.sep + "bin",
  File.sep + "res",
  File.sep + "res" + File.sep + "icons",
];

export class ResourceManager {
  private extensionDir: File;
  private dirMap: Map<string, File>;
  private iconMap: Map<string, string>;
  private iconUriMap: Map<string, vscode.Uri>;

  private constructor(context: vscode.ExtensionContext) {
    this.extensionDir = new File(context.extensionPath);
    this.dirMap = new Map();
    this.iconMap = new Map();
    this.iconUriMap = new Map();
    this.init();
  }

  static getInstance(context?: vscode.ExtensionContext): ResourceManager {
    if (_instance === undefined) {
      if (context) {
        _instance = new ResourceManager(context);
      } else {
        throw Error("context can't be undefined");
      }
    }
    return _instance;
  }

  private init() {
    // 初始化目录
    for (const path of dirList) {
      const f = new File(this.extensionDir.path + path);
      if (f.IsDir()) {
        this.dirMap.set(f.noSuffixName, f);
      }
    }

    // 初始化图标
    const iconDir = this.dirMap.get("icons");
    if (iconDir) {
      for (const icon of iconDir.GetList([/\.svg$/i], File.EMPTY_FILTER)) {
        this.iconMap.set(icon.noSuffixName, icon.path);
      }
    }
  }

  private getAppConfig(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration("KeilAssistant");
  }

  /**
   * Uv4Caller.exe 的路径；扩展安装不完整（缺少 bin 目录）时返回 undefined。
   */
  getBuilderExe(): string | undefined {
    const binDir = this.dirMap.get("bin");
    return binDir === undefined
      ? undefined
      : binDir.path + File.sep + "Uv4Caller.exe";
  }

  getC51UV4Path(): string {
    return this.getAppConfig().get<string>("C51.Uv4Path") || "null";
  }

  getArmUV4Path(): string {
    return this.getAppConfig().get<string>("MDK.Uv4Path") || "null";
  }

  getProjectExcludeList(): string[] {
    return this.getAppConfig().get<string[]>("Project.ExcludeList") || [];
  }

  getProjectFileLocationList(): string[] {
    return this.getAppConfig().get<string[]>("Project.FileLocationList") || [];
  }

  getIconByName(name: string): string | undefined {
    return this.iconMap.get(name);
  }

  /**
   * 按图标名缓存 vscode.Uri：树视图每次渲染都会取图标，
   * 反复创建 Uri 对象只会产生垃圾。
   */
  getIconUri(name: string): vscode.Uri | undefined {
    let uri = this.iconUriMap.get(name);

    if (uri === undefined) {
      const iconPath = this.iconMap.get(name);
      if (iconPath === undefined) {
        return undefined;
      }
      uri = vscode.Uri.file(iconPath);
      this.iconUriMap.set(name, uri);
    }

    return uri;
  }
}
