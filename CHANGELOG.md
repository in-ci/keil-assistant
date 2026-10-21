# Change Log

All notable changes to the "keil-assistant" extension will be documented in this file.

## [Unreleased]
- New: remember the workspace root of each project in `.vscode/keil-assistant.json` (default: the project folder)
- New: `Keil Assistant: Set Workspace Root` command and a "Change Location..." button to pick another workspace root
- New: generate `.clangd` configuration file at workspace root (same level as `.vscode`) based on `c_cpp_properties.json` for lightweight code navigation and diagnostics with clangd
- New: automatically sync and update `.clangd` compilation flags when switching active targets
- Optimize: generated `c_cpp_properties.json` follows the workspace root
- Optimize: run-time files (`keil-assistant.log`, `uv4.log`, `uv4.log.lock`) follow the workspace root too
- Optimize: split `extension.ts` into focused modules (common/model/services/explorer) and dedupe config/file-watching code
- Optimize: switch `File.GetList` to `withFileTypes` to eliminate per-file `lstatSync` syscalls
- Optimize: memoize `toAbsolutePath` in `KeilProject` to accelerate header path resolution
- Optimize: worker pool concurrency and direct path joins for `.d` reference parsing in `Target`
- Optimize: fix GNU depfile target-colon lookbehind bug and accelerate reference parsing
- Optimize: cache `{ light, dark }` URI icon pairs in `ResourceManager` to eliminate allocations in tree rendering
- Optimize: normalize CRLF in `writeCppProperties` to prevent unnecessary re-writes and C/C++ re-indexing on Windows
- Optimize: fast `noSuffixName` implementation using `lastIndexOf` instead of array allocation
- Docs: add detailed Chinese docstrings and comments across modules and functions
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