import * as vscode from "vscode";

import { ProjectExplorer } from "./explorer/projectExplorer";
import { ResourceManager } from "./ResourceManager";
import type { IView } from "./common/tree";

// 纯函数 / 配置类导出：不依赖 vscode 运行期，供测试直接验证
export {
  readConfigObject,
  readProjectFiles,
  resolveProjectFile,
  resolveWorkspaceRoot,
  samePath,
  toConfigPath,
} from "./config/workspaceConfig";
export { ProjectConfig } from "./config/projectConfig";
export { writeCppProperties } from "./services/cppPropertiesWriter";
export { File } from "../lib/node_utility/File";
export { ArmTarget } from "./model/armTarget";

/**
 * 插件入口。
 *
 * 这里只做“接线”：创建 ProjectExplorer、注册命令、启动工作区加载。
 * 具体逻辑放在 explorer / model / services 中，便于单独测试与复用。
 */
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
          const project = await prjExplorer.openProject(uvPrjPath);

          if (project) {
            // 工作区位置来自工程配置，默认仍是工程文件所在目录
            await prjExplorer.promptOpenWorkspace(project);
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
    vscode.commands.registerCommand("project.setWorkspaceRoot", (item: IView) =>
      prjExplorer.setWorkspaceRootCommand(item),
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
