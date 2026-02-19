param(
    [string]$HappyHome,
    [string]$ServerUrl = $env:HAPPY_SERVER_URL,
    [string]$MachineId,
    [ValidateSet('workspaces', 'sessions', 'both')]
    [string]$Entity = 'workspaces',
    [string]$Query,
    [int]$Limit = 25,
    [ValidateSet('vscode', 'insiders')]
    [string]$AppTarget
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-HappyHome {
    param([string]$InputPath)

    if ($InputPath -and -not [string]::IsNullOrWhiteSpace($InputPath)) {
        return $InputPath
    }

    if ($env:HAPPY_HOME_DIR -and -not [string]::IsNullOrWhiteSpace($env:HAPPY_HOME_DIR)) {
        return $env:HAPPY_HOME_DIR
    }

    $defaultDev = Join-Path $HOME ".happy-dev"
    if (Test-Path $defaultDev) {
        return $defaultDev
    }

    return (Join-Path $HOME ".happy")
}

if (-not $Query -or [string]::IsNullOrWhiteSpace($Query)) {
    throw "Provide -Query (example: -Query ""immybot"")."
}

if ($Limit -lt 1) {
    throw "-Limit must be greater than 0."
}

$HappyHome = Resolve-HappyHome -InputPath $HappyHome
if (-not $ServerUrl -or [string]::IsNullOrWhiteSpace($ServerUrl)) {
    $ServerUrl = "https://api.cluster-fluster.com"
}

$accessKeyPath = Join-Path $HappyHome "access.key"
$settingsPath = Join-Path $HappyHome "settings.json"

if (-not (Test-Path $accessKeyPath)) {
    throw "access.key not found at: $accessKeyPath"
}

if ((-not $MachineId -or [string]::IsNullOrWhiteSpace($MachineId)) -and (Test-Path $settingsPath)) {
    $settings = Get-Content $settingsPath -Raw | ConvertFrom-Json
    if ($settings.machineId) {
        $MachineId = [string]$settings.machineId
    }
}

if (-not $MachineId -or [string]::IsNullOrWhiteSpace($MachineId)) {
    throw "MachineId not provided and not found in $settingsPath"
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$tempNodeScript = Join-Path $repoRoot ".tmp-vscode-search-api-test-$([Guid]::NewGuid().ToString('N')).cjs"

$nodeScript = @'
const fs = require("fs");
const crypto = require("crypto");
const { io } = require("socket.io-client");

let nacl = null;
try {
  nacl = require("tweetnacl");
} catch {
  // Only required for legacy secret format.
}

function encodeBase64(buffer) {
  return Buffer.from(buffer).toString("base64");
}

function decodeBase64(value) {
  return Buffer.from(value, "base64");
}

function encryptLegacy(data, key) {
  if (!nacl) {
    throw new Error("tweetnacl is required for legacy secret encryption.");
  }
  const nonce = crypto.randomBytes(nacl.secretbox.nonceLength);
  const plaintext = Buffer.from(JSON.stringify(data), "utf8");
  const encrypted = Buffer.from(nacl.secretbox(plaintext, nonce, key));
  return encodeBase64(Buffer.concat([nonce, encrypted]));
}

function decryptLegacy(payloadBase64, key) {
  if (!nacl) {
    throw new Error("tweetnacl is required for legacy secret decryption.");
  }
  const payload = decodeBase64(payloadBase64);
  const nonceLen = nacl.secretbox.nonceLength;
  const nonce = payload.subarray(0, nonceLen);
  const ciphertext = payload.subarray(nonceLen);
  const decrypted = nacl.secretbox.open(ciphertext, nonce, key);
  if (!decrypted) {
    throw new Error("Failed to decrypt legacy payload.");
  }
  return JSON.parse(Buffer.from(decrypted).toString("utf8"));
}

function encryptDataKey(data, key) {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
  const plaintext = Buffer.from(JSON.stringify(data), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const bundle = Buffer.concat([Buffer.from([0]), nonce, encrypted, authTag]);
  return encodeBase64(bundle);
}

function decryptDataKey(payloadBase64, key) {
  const bundle = decodeBase64(payloadBase64);
  if (bundle.length < 29 || bundle[0] !== 0) {
    throw new Error("Unsupported data-key payload format.");
  }
  const nonce = bundle.subarray(1, 13);
  const authTag = bundle.subarray(bundle.length - 16);
  const ciphertext = bundle.subarray(13, bundle.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(decrypted.toString("utf8"));
}

function buildCodec(access) {
  if (access?.encryption?.machineKey) {
    const key = decodeBase64(access.encryption.machineKey);
    return {
      variant: "dataKey",
      encrypt: (data) => encryptDataKey(data, key),
      decrypt: (payload) => decryptDataKey(payload, key),
    };
  }

  if (access?.secret) {
    const key = decodeBase64(access.secret);
    return {
      variant: "legacy",
      encrypt: (data) => encryptLegacy(data, key),
      decrypt: (payload) => decryptLegacy(payload, key),
    };
  }

  throw new Error("Unsupported access.key format (expected encryption.machineKey or secret).");
}

async function run() {
  const access = JSON.parse(fs.readFileSync(process.env.HAPPY_ACCESS_KEY_PATH, "utf8"));
  if (!access?.token) {
    throw new Error("access.key does not contain token.");
  }

  const machineId = process.env.HAPPY_MACHINE_ID;
  const serverUrl = process.env.HAPPY_SERVER_URL || "https://api.cluster-fluster.com";
  const query = process.env.HAPPY_QUERY || "";
  const entity = process.env.HAPPY_ENTITY || "workspaces";
  const limit = Number(process.env.HAPPY_LIMIT || "25");
  const appTarget = process.env.HAPPY_APP_TARGET || undefined;

  const codec = buildCodec(access);
  const endpoint = serverUrl.replace(/^http/i, "ws");
  const socket = io(endpoint, {
    path: "/v1/updates",
    transports: ["websocket"],
    auth: {
      token: access.token,
      clientType: "user-scoped",
    },
    reconnection: false,
    timeout: 15000,
  });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Socket connection timed out.")), 15000);
    socket.once("connect", () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.once("connect_error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });

  const method = `${machineId}:search`;
  const params = { query, entity, limit, source: { live: true, disk: true } };
  if (appTarget) {
    params.appTarget = appTarget;
  }

  const encryptedParams = codec.encrypt(params);
  const response = await socket.timeout(20000).emitWithAck("rpc-call", {
    method,
    params: encryptedParams,
  });
  socket.close();

  if (!response?.ok) {
    throw new Error(response?.error || "RPC call failed.");
  }

  const result = codec.decrypt(response.result);
  const items = Array.isArray(result?.recentWorkspaces)
    ? result.recentWorkspaces
    : Array.isArray(result?.flatSessions)
      ? result.flatSessions
      : [];

  const summary = {
    ok: true,
    machineId,
    entity,
    query,
    appTarget: appTarget || null,
    encryptionVariant: codec.variant,
    resultCount: items.length,
  };

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ERROR: ${message}`);
  process.exit(1);
});
'@

try {
    Set-Content -Path $tempNodeScript -Value $nodeScript -Encoding UTF8

    Write-Host "Testing search API..."
    Write-Host "  Home: $HappyHome"
    Write-Host "  Server: $ServerUrl"
    Write-Host "  Machine: $MachineId"
    Write-Host "  Entity: $Entity"
    Write-Host "  Query: $Query"
    if ($AppTarget) {
        Write-Host "  AppTarget: $AppTarget"
    }

    $env:HAPPY_ACCESS_KEY_PATH = $accessKeyPath
    $env:HAPPY_MACHINE_ID = $MachineId
    $env:HAPPY_SERVER_URL = $ServerUrl
    $env:HAPPY_QUERY = $Query
    $env:HAPPY_ENTITY = $Entity
    $env:HAPPY_LIMIT = "$Limit"
    if ($AppTarget) {
        $env:HAPPY_APP_TARGET = $AppTarget
    } else {
        Remove-Item Env:HAPPY_APP_TARGET -ErrorAction SilentlyContinue
    }

    Push-Location $repoRoot
    try {
        node $tempNodeScript
    } finally {
        Pop-Location
    }
} finally {
    Remove-Item $tempNodeScript -Force -ErrorAction SilentlyContinue
}
