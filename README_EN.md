# Keil Assistant (v2.0)

A powerful, modernized VS Code extension for Keil uVision projects (supporting ARM MDK and C51).

## [中文文档](./README.md)

***

## 📌 Provenance & Credits

- **Upstream Repository**: This project is a deeply modernized, optimized, and refactored fork based on [github0null/keil-assistant](https://github.com/github0null/keil-assistant).
- **Current Repository**: [in-ci/keil-assistant](https://github.com/in-ci/keil-assistant)
- **AI-Assisted Engineering**: Version 2.0's architecture refactoring, clangd compilation database generation, performance benchmarking, concurrency control, and automated testing were developed collaboratively with **AI (Google DeepMind Antigravity)** agentic pair programming.

***

## Summary 📑

Keil Assistant is an essential VS Code extension for embedded software engineers. It provides project explorer views, syntax highlighting, code snippets, source file dependency tracking, and seamless **build, rebuild, and flash/download** workflows directly inside VS Code.

In addition to supporting Microsoft's **C/C++ (ms-vscode.cpptools)** extension, v2.0 natively supports the high-performance **clangd (llvm-vs-code-extensions.vscode-clangd)** language server!

**System Requirements**:
- **Windows platform only**
- **Keil uVision 5 and above**
- **VS Code >= 1.85.0**

![preview](./res/preview/preview.png)

***

## 🌟 Highlights & New Features in v2.0 🎉

### 1. 🚀 Native clangd Language Server Support
Compared to the resource-heavy C/C++ extension, clangd offers lightning-fast code navigation, accurate indexing, and minimal memory usage:
- **Automatic `.clangd` generation**: Placed at workspace root, synchronized with active Target defines and includes;
- **Automatic `compile_commands.json` generation**: Extracts compiled source files into a standard LLVM compilation database, enabling **instant F12 "Go to Implementation" and cross-file global symbol indexing**;
- **IntelliSense macro sanitization**: Removes incompatible legacy MSVC pseudo-macros (`__enable_irq()=`, `__attribute__(x)=`, etc.) that corrupt CMSIS headers in Clang;
- **Vendor library diagnostic suppression**: Built-in diagnostic filters prevent false-positive diagnostic errors in ST HAL and peripheral drivers.

### 2. 📂 Flexible Workspace Root
- Allows setting the workspace root to the project root folder (separating code from nested `Projects/MDK-ARM` folders);
- Persisted automatically in `.vscode/keil-assistant.json`.

***

## 📖 Usage Guide

### 1. Setup

1. Install a C/C++ language extension (**Choose one**):
   - **Option A (Recommended, fast & lightweight)**: Install **clangd** (`llvm-vs-code-extensions.vscode-clangd`);
   - **Option B (Traditional)**: Install Microsoft **C/C++** (`ms-vscode.cpptools`).
2. In Keil Assistant settings, configure the absolute path to your `UV4.exe`:
   - ARM (MDK) path, e.g.: `C:\Keil_v5\UV4\UV4.exe`
   - C51 path, e.g.: `C:\Keil_v5\UV4\UV4.exe`

   ![setting](./res/preview/setting.png)

***

### 2. Loading Projects 🏃‍♀️

1. Click the **Open Project** icon in the sidebar or open the directory containing the Keil project file (`.uvproj` / `.uvprojx`);
2. The extension automatically loads project groups, active Target configuration, and writes the language server files:

   ![load](./res/preview/load.png)

***

### 3. Common Operations

- **Build & Flash**:
  - **Build**: Incrementally compile the active Target;
  - **Rebuild**: Full rebuild;
  - **Download**: Flash program to target chip via configured debugger.

  ![build](./res/preview/build.png)

- **Target Switching**: Click the switch target button to change active targets; `.clangd` and `c_cpp_properties.json` sync automatically.

  ![active_target](./res/preview/active_target.png)

- **Show Header Dependencies**: After compilation, expand file items to view included headers (ARM only).

  ![show_referance](./res/preview/ref_show.png)

***

## 🛠️ Build & Package from Source

```bash
# 1. Install dependencies
pnpm install

# 2. Type checking and linting
pnpm run check

# 3. Run unit tests
pnpm test

# 4. Package into .vsix file
pnpm run package
```

The resulting `keil-assistant-2.0.0.vsix` file can be installed via VS Code's **"Install from VSIX..."** menu.

***

## 💬 Feedback & Community

Feedback, bug reports, and contributions are welcome:
- [GitHub Issues: https://github.com/in-ci/keil-assistant/issues](https://github.com/in-ci/keil-assistant/issues)
- [Original upstream repository: https://github.com/github0null/keil-assistant](https://github.com/github0null/keil-assistant)
