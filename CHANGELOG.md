# Change Log

All notable changes to the "keil-assistant" extension will be documented in this file.

## [v2.0.0] - 2026-10-22

### 🚀 重大新特性 (Major Features)
- **clangd 语言服务完整支持**：
  - 自动依据活动 Target 的包含路径与宏定义生成工作区根目录的 `.clangd` 配置文件。
  - 自动提取工程源码列表并生成符合 LLVM 规范的 `compile_commands.json` 编译数据库，完美支持全局符号索引、F12 跨文件跳转到函数实现与悬停提示。
  - 智能宏过滤清洗：剔除原用于 MSVC IntelliSense 存根的有害伪宏（如 `__enable_irq()=`、`__attribute__(x)=` 等），避免破坏 CMSIS 核心头文件。
  - 供应商库与配置宏安全压制：在 `.clangd` 中增加针对第三方外设库的无用诊断过滤规则，消除未包含配置头文件时的虚假红线。
- **VS Code 编辑器减负机制**：
  - 打开工程时自动生成 `.vscode/settings.json`，在 `search.exclude` 中排除 `compile_commands.json`、`.clangd`、`node_modules` 与缓存目录，显著降低全局检索与后台文件监视器的 CPU/内存负担。
  - **防覆盖保护**：若 `.vscode/settings.json` 已存在，严格跳过生成，完整保留用户原有自定义配置。
- **自定义工程工作区根目录**：
  - 支持将工作区根目录指定至项目根目录（脱离 MDK 嵌套目录），并在 `.vscode/keil-assistant.json` 中持久化记录。
  - 提供 `Keil Assistant: Set Workspace Root` 命令与弹窗引导。
- **现代化事件激活机制**：
  - 移除性能敏感的全局 `*` 激活，改用 `workspaceContains:**/*.uvproj*` 与 `onView:project` 事件触发，大幅减少在非嵌入式项目下的冷启动开销。
- **VSIX 一键打包工具链**：
  - 新增 `pnpm run package` 自动化构建脚本，利用 Webpack 进行生产级打包与依赖内联（零外部运行时依赖），生成体积仅约 500 KB 的标准 `.vsix` 安装包。

### ⚡ 性能优化 (Performance Optimizations)
- **零异常栈开销的文件状态探测**：改写 `File._stat` 使用 `fs.statSync(path, { throwIfNoEntry: false })`，避免成百上千个路径探测失败时反复抛出 V8 异常导致的 CPU 峰值。
- **目录扫描系统调用精简**：`File.GetList` 升级为 `readdirSync(..., { withFileTypes: true })`，单次调用即可获取文件/目录类型，消除逐文件的冗余 `stat` 调用。
- **头文件依赖极速解析**：优化 `.d` 依赖解析并发控制与时间戳缓存（`mtimeMs`），无变化文件跳过解析；修复正则断言缺陷。
- **URI 图标成对缓存**：在 `ResourceManager` 中缓存 `{ light, dark }` URI 对象，杜绝树视图反复渲染带来的高频内存分配。
- **CRLF 归一化比对写盘**：配置写入前归一化换行符，避免 Windows 平台因换行符差异触发假刷新与语言服务重复重构索引。

### 🛡️ 架构重构与鲁棒性增强 (Architecture & Robustness)
- **核心模块高内聚低耦合**：
  - 命令行转义处理统一重构至 `common/cmdLineHandler.ts`，统一支持 PowerShell、CMD 与 POSIX Shell。
  - 清理遗留冗余代码：彻底移除 140+ 行未精简单例 `Time.ts` 与废弃的 `Utility.ts`，使用极轻量 `formatTimestamp()`。
  - 目录创建现代化：采用原生 `fs.mkdirSync(..., { recursive: true })` 替代老旧的手动字符串切分循环。
- **生命周期定时器全量受控**：工程重载与依赖刷新全面接入统一的 `Debouncer`，并在工程 `close()` 时显式终止，杜绝孤儿计时器。
- **全平台路径兼容增强**：使用 `path.isAbsolute` 统一替代正则盘符判断，全面兼容 Windows 盘符、UNC 共享路径以及 POSIX 规范路径。
- **宏提取解析器健壮化**：强化 `MacroHandler`，支持无值标志位宏（如 `#define USE_HAL_DRIVER`）、函数式宏与对象宏的全面捕获。
- **代码规范与类型安全**：保持严格类型推断，全仓库 0 错误、0 警告（`oxlint` + `tsc --noEmit`），并通过 31 项全流程单元测试。

***

## [v1.7.1]
- Fixed: can't use shortcut key
***

## [v1.7.0]
- Change: adjust view
- Optimize: Update doc
- Optimize: support double click to open file with non-preview mode
***

## [v1.6.2]
- Fixed: output messy code
- Optimize: extend more armcc keywords
***

## [v1.6.1]
- Fixed: error rebuild command
***

## [v1.6.0]
- New: support show source referance files
- New: add exclude list on open multi-project workspace
***

## [v1.5.0]
- New: add 'Active Target' button
- Changed: adjust keybindings
***

## [v1.4.0]
- New: support multi-target keil project
- New: add armclang cpp macros
***

## [v1.3.3]
- Optimize: extend more armcc keywords
***

## [v1.3.2]
- Fixed: some incorrect C51 keywords
- Fixed: some other bugs
***

## [v1.3.1]
- Fixed: add missed system include path
- Changed: remove c51 language highlight
- Optimized: add more system macro
***

## [v1.3.0]
- Add: switch workspace after open project
- Changed: change icon
- Fixed: build failed without workspace
***

## [v1.2.1]
- Add: Add some internal defines for ARM/C51
***

## [v1.2.0]
- Fixed: Can't run task by CMD
- Add: Shortcut keys
***

## [v1.1.0]
- Fixed: Not found C51/STM32 system include dir
- Fixed: Invalid macro
***

## [v1.0.0]
- First release