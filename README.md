# Keil Assistant (v2.0)

VS Code 平台上的 Keil uVision 辅助增强插件（支持 ARM MDK 与 C51）。

## [English Documentation](./README_EN.md)

***

## 📌 项目背景与致谢 (Credits & Provenance)

- **上游原项目**：本项目基于 [github0null/keil-assistant](https://github.com/github0null/keil-assistant) 进行深度重构与功能现代化升级。
- **项目仓库**：[in-ci/keil-assistant](https://github.com/in-ci/keil-assistant)
- **AI 协同研发**：本项目 2.0 版本的架构重构、clangd 编译数据库生成、性能基准调优、并发控制及全流程自动化测试均深度借助 **AI（Google DeepMind Antigravity）** 结对协同编程完成。

***

## 简述 📑

Keil Assistant 是一款面向嵌入式开发者的 VS Code 扩展。为 Keil 项目提供目录树展示、语法高亮、代码片段、源码依赖跟踪，并支持在 VS Code 内直接调用 Keil 命令行进行 **编译、重新编译、一键下载烧录**。

不仅兼容微软 **C/C++（ms-vscode.cpptools）** 插件，2.0 版本更原生支持了更轻量、跳转更迅速的 **clangd（llvm-vs-code-extensions.vscode-clangd）** 语言服务器！

**系统与环境要求**：
- **仅支持 Windows 平台**
- **支持 Keil uVision 5 及以上版本**
- **VS Code >= 1.85.0**

![preview](./res/preview/preview.png)

***

## 🌟 v2.0 核心特性与亮点 🎉

### 1. 🚀 原生 clangd 语言服务完整支持
相较于体积庞大、在复杂工程中容易卡顿的微软 C/C++ 插件，clangd 具有内存占用低、毫秒级补全与精确跳转等显著优势：
- **自动生成 `.clangd` 配置文件**：放置于工作区根目录，自动映射当前 Target 的包含路径与预处理宏；
- **自动生成 `compile_commands.json` 编译数据库**：抽取所有参与构建的 `.c/.cpp` 源文件并构建完整的编译标志，支持**跨文件全局符号索引与 F12 秒级“跳转到函数实现”**；
- **智能宏清洗与存根过滤**：过滤破坏 Clang 原生语法的遗留伪宏（如 `__enable_irq()=` 等），消除 CMSIS 核心头文件报错；
- **第三方驱动库诊断压制**：内置针对 STM32 HAL / 标准外设库的无用诊断过滤规则，杜绝因头文件前置引用导致的虚假红线。

### 2. 📂 自由指定工作区根目录
- 支持将工作区设置在项目根目录（例如将工作区设在上层代码根目录，而工程位于 `Projects/MDK-ARM`）；
- 在 `.vscode/keil-assistant.json` 中自动持久化工作区定位与关联工程。

***

## 📖 使用指南

### 1. 准备工作

1. 安装代码浏览插件（**二选一**）：
   - **方式 A（推荐，轻量飞速）**：安装 **clangd** 扩展（`llvm-vs-code-extensions.vscode-clangd`），同时建议在设置中将微软 C/C++ 插件的 IntelliSense 设为 disabled；
   - **方式 B（传统模式）**：安装微软官方 **C/C++** 扩展（`ms-vscode.cpptools`）。
2. 在 Keil-Assistant 插件设置中配置对应工具链的 `UV4.exe` 绝对路径：
   - ARM（MDK）路径示例：`C:\Keil_v5\UV4\UV4.exe`
   - C51 路径示例：`C:\Keil_v5\UV4\UV4.exe`

   ![setting](./res/preview/setting.png)

***

### 2. 打开与加载工程 🏃‍♀️

1. 点击侧边栏 **打开项目** 图标，或**直接在 VS Code 中打开包含 Keil 工程文件（`.uvproj / .uvprojx`）的目录**；
2. 插件会自动解析 Target、宏定义、包含目录和文件分组，并在根目录下生成相应的补全配置：

   ![load](./res/preview/load.png)

***

### 3. 常用操作快捷按钮

- **编译与烧录**：
  - **Build (增量编译)**：调用 Keil 增量构建当前活动 Target；
  - **Rebuild (重新编译)**：全量重新构建；
  - **Download (下载烧录)**：调用配置的调试器/下载器向目标芯片烧录程序。

  ![build](./res/preview/build.png)

- **自动刷新**：在 Keil 中增删源文件并保存后，插件监视器会自动感知并同步刷新工程树。
- **活动 Target 切换**：点击工程栏切换按钮，可随时切换不同的 Target，插件会自动联动更新 `.clangd` 和 `c_cpp_properties.json` 的编译参数。

  ![active_target](./res/preview/active_target.png)

- **查看源码依赖引用**：编译完成后，可展开源文件子箭头查看其包含的头文件列表（支持 ARM 工具链）。

  ![show_referance](./res/preview/ref_show.png)

***

## 🛠️ 本地开发与打包构建

```bash
# 1. 安装依赖
pnpm install

# 2. 代码检查与类型校验
pnpm run check

# 3. 运行自动化单元测试套件
pnpm test

# 4. 一键构建生产环境 VSIX 扩展安装包
pnpm run package
```

打包成功后会在根目录下生成 `keil-assistant-2.0.0.vsix`，可在 VS Code 扩展面板中选择 **「从 VSIX 安装...」** 直接体验。

***

## 💬 问题反馈与交流

欢迎提交 Issue 或 Pull Request：
- [GitHub Issues: https://github.com/in-ci/keil-assistant/issues](https://github.com/in-ci/keil-assistant/issues)
- [上游原仓库: https://github.com/github0null/keil-assistant](https://github.com/github0null/keil-assistant)
