# Keil Assistant

## [English](./README_EN.md)

## 简述 📑

vscode 上的 Keil 辅助工具，与 c/c++ 插件配合使用.

能够为 Keil 项目提供 语法高亮、代码片段 的功能，并支持对 keil 项目进行 编译、下载。

**仅支持 Keil uVison 5 及以上版本**  

**仅支持 Windows 平台**

![preview](./res/preview/preview.png)

***

## 功能特性🎉

- 加载 Keil C51/ARM 项目，并以 Keil 项目资源管理器的展示方式显示项目视图
- 自动监视 keil 项目文件的变化，及时更新项目视图
- 通过调用 Keil 命令行接口实现 编译，重新编译，烧录 keil 项目
- 自动生成 c_cpp_properties.json 文件，使 C/C++ 插件的语法分析能正常进行

***

## 用法 📖

### 准备工作

1. 安装 C/C++ 插件
>
2. 进入 Keil-Assistant 插件设置，设置好 keil 可执行文件 UV4.exe 的绝对路径
 
 ![setting](./res/preview/setting.png)

***

### 开始使用 🏃‍♀️

1. 在 Keil 上创建好项目，添加好文件，头文件路径等
> 
2. 点击 **打开项目** 图标 或者 **使用 vscode 直接打开 keil 项目文件(.uvproj) 所在的目录**，插件会自动加载 keil 项目；
 
 ![load](./res/preview/load.png)

### 常用操作

- **编译，烧录**：提供了 3 个按钮，分别代表 编译，下载，重新编译
 
 ![build](./res/preview/build.png)

>

- **保存和刷新**：在 Keil 上添加/删除源文件，更改，配置项目，更改完毕后点击 **保存所有**，插件检测到 keil 项目变化后会自动刷新项目
 
 ![keil_save_all](./res/preview/keil_save_all.png)

>

- **打开源文件**：单击源文件将以预览模式打开，双击源文件将切换到非预览模式打开
 
 ![open_file](./res/preview/open_file.png)

>

- **切换 c/c++ 插件的配置**：点击目标名称在多个 c/c++ 配置中切换
 
 ![cpp_config](./res/preview/cpp_config.png)

>

- **切换 keil Target**：点击项目的切换按钮，可以在多个 Keil Target 之间切换
 
 ![active_target](./res/preview/active_target.png)

>

- **展开引用**：在编译完成后，可以点击源文件项的箭头图标展开其引用（仅支持 ARM 项目）
 
 ![show_referance](./res/preview/ref_show.png)

***

### 其他设置

- 工作区设置：项目排除列表(`KeilAssistant.Project.ExcludeList`)
 当某个目录下存在多个 keil 项目时，使用插件打开该目录，插件会加载所有的 keil 项目，通过此选项，可以指定需要排除哪些 keil 项目，防止在打开该工作区时自动加载该项目
 **默认的排除列表**：
  ```json
  [
      "template.uvproj",
      "template.uvprojx"
  ]
  ```

- 工程工作区位置：工程文件（`.uvprojx`）所在的目录下会生成 `.vscode/keil-assistant.json`，用来记录打开工程时使用的工作区根目录
  ```json
  {
      "workspaceRoot": "."
  }
  ```
  - `workspaceRoot` 默认为 `.`，即工程文件所在目录，与旧版本行为一致
  - 支持相对路径（相对工程文件所在目录，例如 MDK 工程位于 `Projects/MDK-ARM` 时填 `"../.."`）和绝对路径
  - 打开工程后，插件会提示是否切换到该工作区；也可以点击通知里的 **Change Location...**，或右键工程选择 **Keil Assistant: Set Workspace Root** 重新指定目录
  - 切换工作区后，插件会把工程登记到目标工作区 `.vscode/keil-assistant.json` 的 `projectFiles` 中（相对路径），下次打开该工作区时自动加载工程
  - 配置的目录不存在时会回退到工程文件所在目录，并给出提示

  生成的 `c_cpp_properties.json` 会写入当前工作区根目录的 `.vscode` 下，保证 C/C++ 插件能读取到

  插件的运行期文件（`keil-assistant.log`、`uv4.log`、`uv4.log.lock`）同样写入当前工作区根目录的 `.vscode` 下；修改 `workspaceRoot` 后重新打开工程即可生效（当前窗口的日志文件不会中途搬移）

### 还有其他问题 ？

可以到以下位置进行交流

- [论坛: https://discuss.em-ide.com/t/keil-assistant](https://discuss.em-ide.com/t/keil-assistant)

- [Github Issue: https://github.com/github0null/keil-assistant/issues](https://github.com/github0null/keil-assistant/issues)
