import * as vscode from "vscode";
import * as crypto from "crypto";

import { samePath } from "../config/workspaceConfig";

/**
 * 与具体业务无关、但依赖 VS Code / Node 的通用工具。
 *
 * 单独成文件是为了让模型层（KeilProject / Target）可以复用这些能力，
 * 而不必各自重新实现路径比较、任务状态判断等逻辑。
 */

export function isKeilTaskRunning(): boolean {
  return vscode.tasks.taskExecutions.some(
    (execution) => execution.task.definition.type === "keil-task",
  );
}


export function getMD5(data: string): string {
  const md5 = crypto.createHash("md5");
  md5.update(data);
  return md5.digest("hex");
}

/** 把当前窗口切换（重载）到指定目录作为工作区 */

export function openWorkspaceFolder(root: string) {
  vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(root));
}

/** 指定目录是否已经是当前打开的工作区，避免重复触发窗口重载 */

export function isWorkspaceFolderOpen(root: string): boolean {
  const folders = vscode.workspace.workspaceFolders;

  if (!folders) {
    return false;
  }

  return folders.some(
    (folder) =>
      folder.uri.scheme === "file" && samePath(folder.uri.fsPath, root),
  );
}
