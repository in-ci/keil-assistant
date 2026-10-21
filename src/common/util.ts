import * as vscode from "vscode";
import * as crypto from "crypto";

import { samePath } from "../config/workspaceConfig";

/**
 * 与具体业务无关、但依赖 VS Code / Node 的通用工具。
 *
 * 单独成文件是为了让模型层（KeilProject / Target）可以复用这些能力，
 * 而不必各自重新实现路径比较、任务状态判断等逻辑。
 */

/**
 * 检查当前是否有 Keil 编译/下载后台任务正在运行。
 *
 * @returns 存在正在运行的 keil-task 任务时返回 true
 */
export function isKeilTaskRunning(): boolean {
  return vscode.tasks.taskExecutions.some(
    (execution) => execution.task.definition.type === "keil-task",
  );
}

/**
 * 计算输入文本的 MD5 摘要值。
 * 常用于根据文件路径生成唯一的工程 ID。
 *
 * @param data 待计算哈希的原始字符串
 * @returns 32位小写十六进制 MD5 哈希
 */
export function getMD5(data: string): string {
  const md5 = crypto.createHash("md5");
  md5.update(data);
  return md5.digest("hex");
}

/**
 * 触发 VS Code 窗口重载并打开指定路径作为工作区根目录。
 *
 * @param root 目标工作区目录的绝对路径
 */
export function openWorkspaceFolder(root: string) {
  vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(root));
}

/**
 * 判断指定目录是否已经是当前 VS Code 窗口中打开的工作区根目录。
 * 用于防止重复调用 openWorkspaceFolder 导致多余的窗口刷新。
 *
 * @param root 待检查的目标路径
 * @returns 当前已打开该目录时返回 true
 */
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
