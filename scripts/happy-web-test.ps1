param(
    [string]$ServerUrl = "http://localhost:3005",
    [int]$WebPort = 19006,
    [switch]$SkipServer
)

$repoRoot = Split-Path -Parent $PSScriptRoot
$serverDir = Join-Path $repoRoot "packages\\happy-server"
$appDir = Join-Path $repoRoot "packages\\happy-app"

$serverJob = $null
if (-not $SkipServer) {
    Write-Host "Starting happy-server (dev:win)..."
    $serverJob = Start-Job -ScriptBlock {
        param($dir)
        Push-Location $dir
        try {
            yarn dev:win
        } finally {
            Pop-Location
        }
    } -ArgumentList $serverDir
    Start-Sleep -Seconds 2
}

$env:EXPO_PUBLIC_HAPPY_SERVER_URL = $ServerUrl
$env:CI = "1"
Write-Host "Starting happy-app web with EXPO_PUBLIC_HAPPY_SERVER_URL=$ServerUrl on port $WebPort"
Push-Location $appDir
try {
    npx expo start --web --port $WebPort
} finally {
    Pop-Location
    if ($serverJob) {
        try { Stop-Job $serverJob | Out-Null } catch {}
        try { Remove-Job $serverJob -Force | Out-Null } catch {}
    }
}
