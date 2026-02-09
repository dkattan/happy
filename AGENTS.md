# AGENTS

## Dependency Installation

It is OK to install npm packages as needed for tasks.

## Hanging Commands

If a command appears to hang, redirect stdout and stderr to a log file so output can accumulate. Then terminate the command and inspect the log file for clues.

## VS Code Bridge Diagnostics

Single-command diagnostics:
- `yarn vscode:bridge:diagnose`

What it does:
- Builds the Happy VS Code extension
- Packages and installs the VSIX
- Opens a new VS Code window
- Tails the latest Extension Host log (exthost), telemetry, and Happy OutputChannel logs

Log locations (Windows defaults):
- `%APPDATA%\Code\logs\<timestamp>\exthost*.log`
- `%APPDATA%\Code - Insiders\logs\<timestamp>\exthost*.log`
- `%APPDATA%\Code\logs\<timestamp>\exthost\output_logging_*\*-Happy VS Code Bridge.log`

Standalone log tail:
- `yarn vscode:bridge:tail`
- `yarn vscode:bridge:tail-output`

## Happy Web Dev

Single-command web dev (starts happy-server + happy-app web):
- `yarn happy:web:dev`

Notes:
- Server URL is `http://localhost:3005` by default.
- Override with `powershell ./scripts/happy-web-dev.ps1 -ServerUrl http://localhost:3005`

## Playwright Web Tests

Single-command test run (starts happy-server + happy-app web automatically):
- `yarn test:playwright`

Notes:
- `playwright.config.ts` starts `scripts/happy-web-test.ps1` with `HAPPY_SERVER_URL` and `HAPPY_WEB_PORT`.
- On failure, tests dump interactive elements into attachments and console logs.
