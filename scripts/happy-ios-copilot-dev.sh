#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HAPPY_DEV_HOME="${HAPPY_DEV_HOME:-$HOME/.happy-dev}"
IOS_BUNDLE_ID="${IOS_BUNDLE_ID:-net.immense.happy.dev}"
HAPPY_METRO_PORT="${HAPPY_METRO_PORT:-8081}"
HAPPY_FORCE_IOS_REBUILD="${HAPPY_FORCE_IOS_REBUILD:-0}"
HAPPY_CHAT_SEND_TARGET="${HAPPY_CHAT_SEND_TARGET:-panel}"
HAPPY_VSCODE_USER_DATA_DIR="${HAPPY_VSCODE_USER_DATA_DIR:-}"
HAPPY_VSCODE_EXTENSIONS_DIR="${HAPPY_VSCODE_EXTENSIONS_DIR:-}"
BRIDGE_TAIL_PID=""

run() {
  echo "▶ $*"
  "$@"
}

get_daemon_http_port() {
  local state_path="$HAPPY_DEV_HOME/daemon.state.json"
  if [[ ! -f "$state_path" ]]; then
    return 1
  fi

  node -e '
const fs = require("fs");
const p = process.argv[1];
try {
  const json = JSON.parse(fs.readFileSync(p, "utf8"));
  if (json && Number.isInteger(json.httpPort)) {
    console.log(String(json.httpPort));
  }
} catch {}
' "$state_path"
}

cleanup() {
  if [[ -n "$BRIDGE_TAIL_PID" ]]; then
    kill "$BRIDGE_TAIL_PID" >/dev/null 2>&1 || true
  fi
}

restart_code_extension_dev_host() {
  local extension_path="$ROOT_DIR/packages/happy-vscode-extension"
  local code_cli="code"

  if ! command -v "$code_cli" >/dev/null 2>&1; then
    echo "⚠ VS Code CLI ('code') not found. Install it via VS Code: Command Palette -> 'Shell Command: Install code command in PATH'."
    return 1
  fi

  local -a code_args
  code_args=(
    --new-window "$ROOT_DIR"
    --extensionDevelopmentPath "$extension_path"
  )

  if [[ -n "$HAPPY_VSCODE_USER_DATA_DIR" ]]; then
    mkdir -p "$HAPPY_VSCODE_USER_DATA_DIR"
    code_args+=(--user-data-dir "$HAPPY_VSCODE_USER_DATA_DIR")
  fi

  if [[ -n "$HAPPY_VSCODE_EXTENSIONS_DIR" ]]; then
    mkdir -p "$HAPPY_VSCODE_EXTENSIONS_DIR"
    code_args+=(--extensions-dir "$HAPPY_VSCODE_EXTENSIONS_DIR")
  fi

  echo "▶ Restarting VS Code (stable) for extension development"
  osascript -e 'tell application "Visual Studio Code" to quit' >/dev/null 2>&1 || true
  pkill -x "Code" >/dev/null 2>&1 || true
  pkill -f "Visual Studio Code.app/Contents/MacOS/Electron" >/dev/null 2>&1 || true
  pkill -f "Visual Studio Code Helper" >/dev/null 2>&1 || true
  sleep 1

  echo "▶ Launching VS Code extension development host"
  echo "  extension: $extension_path"
  if [[ -n "$HAPPY_VSCODE_USER_DATA_DIR" ]]; then
    echo "  user-data-dir: $HAPPY_VSCODE_USER_DATA_DIR"
  else
    echo "  user-data-dir: (default profile)"
  fi
  if [[ -n "$HAPPY_VSCODE_EXTENSIONS_DIR" ]]; then
    echo "  extensions-dir: $HAPPY_VSCODE_EXTENSIONS_DIR"
  else
    echo "  extensions-dir: (default profile)"
  fi
  HAPPY_HOME_DIR="$HAPPY_DEV_HOME" "$code_cli" "${code_args[@]}" >/dev/null 2>&1 || true
}

find_latest_bridge_log() {
  local expected_port="${1:-}"
  local latest=""
  local candidate=""
  local root=""
  local custom_root=""

  for root in "$HOME/Library/Application Support/Code/logs" "$HOME/Library/Application Support/Code - Insiders/logs"; do
    [[ -d "$root" ]] || continue
    while IFS= read -r candidate; do
      if [[ -n "$expected_port" ]]; then
        if ! grep -q "Using daemon at http://127.0.0.1:$expected_port" "$candidate" 2>/dev/null; then
          continue
        fi
      fi
      if [[ -z "$latest" || "$candidate" -nt "$latest" ]]; then
        latest="$candidate"
      fi
    done < <(find "$root" -type f -path "*/exthost/output_logging_*/*-Happy VS Code Bridge.log" 2>/dev/null)
  done

  if [[ -n "$HAPPY_VSCODE_USER_DATA_DIR" ]]; then
    custom_root="$HAPPY_VSCODE_USER_DATA_DIR/logs"
    if [[ -d "$custom_root" ]]; then
      while IFS= read -r candidate; do
        if [[ -n "$expected_port" ]]; then
          if ! grep -q "Using daemon at http://127.0.0.1:$expected_port" "$candidate" 2>/dev/null; then
            continue
          fi
        fi
        if [[ -z "$latest" || "$candidate" -nt "$latest" ]]; then
          latest="$candidate"
        fi
      done < <(find "$custom_root" -type f -path "*/exthost/output_logging_*/*-Happy VS Code Bridge.log" 2>/dev/null)
    fi
  fi

  echo "$latest"
}

tail_bridge_log_when_available() {
  local expected_port="$1"
  local waited=0
  local wait_step=2
  local max_wait=60
  local log_file=""

  while (( waited <= max_wait )); do
    log_file="$(find_latest_bridge_log "$expected_port")"
    if [[ -z "$log_file" ]]; then
      log_file="$(find_latest_bridge_log)"
    fi
    if [[ -n "$log_file" ]]; then
      echo "▶ Tailing Happy VS Code Bridge log:"
      echo "  $log_file"
      tail -n 120 -F "$log_file" &
      BRIDGE_TAIL_PID="$!"
      return 0
    fi
    sleep "$wait_step"
    waited=$((waited + wait_step))
  done

  echo "⚠ Could not find Happy VS Code Bridge output log under:"
  echo "  $HOME/Library/Application Support/Code/logs"
  echo "  $HOME/Library/Application Support/Code - Insiders/logs"
  if [[ -n "$HAPPY_VSCODE_USER_DATA_DIR" ]]; then
    echo "  $HAPPY_VSCODE_USER_DATA_DIR/logs"
  fi
  return 1
}

publish_vscode_sessions_snapshot() {
  local daemon_port="$1"
  local bridge_scan_module="$ROOT_DIR/packages/happy-vscode-extension/dist/sessionScan.js"

  if [[ ! -f "$bridge_scan_module" ]]; then
    echo "⚠ Session scanner not found at:"
    echo "  $bridge_scan_module"
    return 1
  fi

  local instance_id=""
  local waited=0
  local wait_step=2
  local max_wait=60

  while (( waited <= max_wait )); do
    instance_id="$(node -e '
const port = process.argv[1];
(async () => {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/vscode/instances`);
    if (!res.ok) {
      process.stdout.write("");
      return;
    }
    const json = await res.json();
    const id = json?.instances?.[0]?.instanceId ?? "";
    process.stdout.write(id);
  } catch {
    process.stdout.write("");
  }
})();
' "$daemon_port")"

    if [[ -n "$instance_id" ]]; then
      break
    fi

    sleep "$wait_step"
    waited=$((waited + wait_step))
  done

  if [[ -z "$instance_id" ]]; then
    echo "⚠ No VS Code bridge instance registered yet; skipping initial session publish."
    return 1
  fi

  echo "▶ Publishing VS Code session snapshot to daemon (instance $instance_id)"
  node -e '
const scanModule = process.argv[1];
const daemonPort = process.argv[2];
const instanceId = process.argv[3];

(async () => {
  const { scanVscodeSessions } = require(scanModule);
  const sessions = await scanVscodeSessions();
  const response = await fetch(`http://127.0.0.1:${daemonPort}/vscode/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ instanceId, sessions })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Daemon request failed: ${response.status} ${text}`);
  }

  console.log(`Published ${sessions.length} sessions`);
})().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
' "$bridge_scan_module" "$daemon_port" "$instance_id"
}

is_ios_app_installed_on_booted_simulator() {
  xcrun simctl get_app_container booted "$IOS_BUNDLE_ID" app >/dev/null 2>&1
}

launch_installed_ios_app_and_open_dev_url() {
  local metro_port="$1"
  local encoded_url="http%3A%2F%2F127.0.0.1%3A${metro_port}"
  local dev_client_url="exp+happy://expo-development-client/?url=${encoded_url}"

  xcrun simctl launch booted "$IOS_BUNDLE_ID" >/dev/null 2>&1 || true
  xcrun simctl openurl booted "$dev_client_url" >/dev/null 2>&1 || true
}

resolve_available_metro_port() {
  local preferred_port="$1"
  node -e '
const net = require("net");
const start = Number(process.argv[1]) || 8081;
const end = start + 40;

function isFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

(async () => {
  for (let port = start; port <= end; port++) {
    if (await isFree(port)) {
      process.stdout.write(String(port));
      return;
    }
  }
  process.stdout.write(String(start));
})();
' "$preferred_port"
}

find_running_metro_port() {
  local start_port="$1"
  local end_port=$((start_port + 40))
  local port=""
  local status=""

  for ((port=start_port; port<=end_port; port++)); do
    status="$(curl -fsS --max-time 1 "http://127.0.0.1:${port}/status" 2>/dev/null || true)"
    if [[ "$status" == "packager-status:running" ]]; then
      echo "$port"
      return 0
    fi
  done

  return 1
}

ensure_workspace_bridge_settings() {
  local settings_path="$ROOT_DIR/.vscode/settings.json"
  local daemon_state_path="$HAPPY_DEV_HOME/daemon.state.json"
  local chat_send_target="$HAPPY_CHAT_SEND_TARGET"

  mkdir -p "$ROOT_DIR/.vscode"

  node -e '
const fs = require("fs");
const settingsPath = process.argv[1];
const daemonStatePath = process.argv[2];
const chatSendTargetRaw = process.argv[3];
const chatSendTarget = chatSendTargetRaw === "editor" ? "editor" : "panel";

let settings = {};
if (fs.existsSync(settingsPath)) {
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  } catch {
    settings = {};
  }
}

settings["happy.vscode.daemonStatePath"] = daemonStatePath;
settings["happy.vscode.chatSendTarget"] = chatSendTarget;
fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
' "$settings_path" "$daemon_state_path" "$chat_send_target"

  echo "▶ Ensured VS Code bridge daemon path in:"
  echo "  $settings_path"
}

trap cleanup EXIT INT TERM

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This command requires macOS."
  exit 1
fi

if ! command -v yarn >/dev/null 2>&1; then
  echo "yarn is required but was not found in PATH."
  exit 1
fi

echo "Happy iOS Copilot bootstrap"
echo "Repo: $ROOT_DIR"
echo "Dev home: $HAPPY_DEV_HOME"
echo "Bundle ID: $IOS_BUNDLE_ID"
echo "Chat send target: $HAPPY_CHAT_SEND_TARGET"
echo "VS Code mode: extension development host (stable code)"
echo

# Ensure Simulator is available before auth deep-link opens.
open -a Simulator >/dev/null 2>&1 || true

# 1) Authenticate the dev CLI variant (opens deep link in booted iOS simulator).
run yarn --cwd "$ROOT_DIR/packages/happy-cli" dev:auth login --mobile --open-ios-simulator

# 2) Start dev daemon for this auth profile.
run yarn --cwd "$ROOT_DIR/packages/happy-cli" dev:daemon:start
DAEMON_HTTP_PORT="$(get_daemon_http_port || true)"
if [[ -z "$DAEMON_HTTP_PORT" ]]; then
  echo "⚠ Could not resolve daemon port from $HAPPY_DEV_HOME/daemon.state.json"
fi

# 3) Build/install VS Code bridge so Copilot conversations are published.
run yarn --cwd "$ROOT_DIR" vscode:bridge:build
ensure_workspace_bridge_settings
restart_code_extension_dev_host || true
if [[ -n "$DAEMON_HTTP_PORT" ]]; then
  tail_bridge_log_when_available "$DAEMON_HTTP_PORT" || true
  publish_vscode_sessions_snapshot "$DAEMON_HTTP_PORT" || true
else
  tail_bridge_log_when_available || true
fi

# 4) Launch iOS app.
if [[ "$HAPPY_FORCE_IOS_REBUILD" == "1" ]]; then
  echo "▶ Launching iOS app with full native rebuild (HAPPY_FORCE_IOS_REBUILD=1)"
  yarn --cwd "$ROOT_DIR/packages/happy-app" ios:dev
elif is_ios_app_installed_on_booted_simulator; then
  RUNNING_METRO_PORT="$(find_running_metro_port "$HAPPY_METRO_PORT" || true)"
  if [[ -n "$RUNNING_METRO_PORT" ]]; then
    METRO_PORT="$RUNNING_METRO_PORT"
    echo "▶ Reusing running Metro on port: $METRO_PORT"
    echo "▶ Launching iOS app without native rebuild (installed app detected)"
    launch_installed_ios_app_and_open_dev_url "$METRO_PORT"
    echo "▶ Metro already running; skipping new expo start"
    exit 0
  fi

  METRO_PORT="$(resolve_available_metro_port "$HAPPY_METRO_PORT")"
  echo "▶ Starting new Metro on port: $METRO_PORT"
  echo "▶ Launching iOS app without native rebuild (installed app detected)"
  launch_installed_ios_app_and_open_dev_url "$METRO_PORT"
  yarn --cwd "$ROOT_DIR/packages/happy-app" start:dev --dev-client --host localhost --port "$METRO_PORT"
else
  echo "▶ Installed app not found on booted simulator; falling back to full native rebuild"
  yarn --cwd "$ROOT_DIR/packages/happy-app" ios:dev
fi
