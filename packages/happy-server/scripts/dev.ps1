param(
    [int]$Port = 3005
)

function Get-PortFromEnvFile {
    param([string]$envPath, [int]$fallback)
    if (-not (Test-Path $envPath)) { return $fallback }
    $line = Get-Content -Path $envPath | Where-Object { $_ -match '^PORT=' } | Select-Object -First 1
    if (-not $line) { return $fallback }
    $value = $line -replace '^PORT=', ''
    if ([int]::TryParse($value, [ref]$null)) { return [int]$value }
    return $fallback
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $repoRoot ".env.dev"
$Port = Get-PortFromEnvFile -envPath $envFile -fallback $Port

try {
    $connections = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
    foreach ($conn in $connections) {
        if ($conn.OwningProcess) {
            try {
                Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
            } catch {
                Write-Warning "Failed to stop process $($conn.OwningProcess) on port $Port."
            }
        }
    }
} catch {
    Write-Warning "Unable to check or clear port $Port. Continuing."
}

Push-Location $repoRoot
try {
    npx tsx --env-file=.env --env-file=.env.dev ./sources/main.ts
} finally {
    Pop-Location
}
