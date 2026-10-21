# Change Log

All notable changes to the "keil-assistant" extension will be documented in this file.

## [Unreleased]
- New: remember the workspace root of each project in `.vscode/keil-assistant.json` (default: the project folder)
- New: `Keil Assistant: Set Workspace Root` command and a "Change Location..." button to pick another workspace root
- Optimize: generated `c_cpp_properties.json` follows the workspace root
- Optimize: run-time files (`keil-assistant.log`, `uv4.log`, `uv4.log.lock`) follow the workspace root too
- Optimize: split `extension.ts` into focused modules (common/model/services/explorer) and dedupe config/file-watching code
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