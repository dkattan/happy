param(
    [int]$Tail = 200
)

function Get-LatestLogRoot {
    param([string]$root)
    if (-not (Test-Path $root)) { return $null }
    $latestSession = Get-ChildItem -Path $root -Directory | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $latestSession) { return $null }
    return $latestSession.FullName
}

$appData = @($env:APPDATA)[0]
if (-not $appData) {
    Write-Error 'APPDATA not set.'
    exit 1
}

$targets = @(
    @{ Name = 'Code'; Root = "$appData\\Code\\logs" },
    @{ Name = 'Code - Insiders'; Root = "$appData\\Code - Insiders\\logs" }
)

$any = $false
$logsToTail = @()
foreach ($target in $targets) {
    $latestRoot = Get-LatestLogRoot -root $target.Root
    if (-not $latestRoot) { continue }

    $primary = Get-ChildItem -Path $latestRoot -Recurse -Filter 'exthost.log' -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if ($primary) { $logsToTail += @{ Name = "$($target.Name) exthost"; Path = $primary.FullName } }

    $telemetry = Get-ChildItem -Path $latestRoot -Recurse -Filter 'extHostTelemetry.log' -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if ($telemetry) { $logsToTail += @{ Name = "$($target.Name) telemetry"; Path = $telemetry.FullName } }

    $outputLog = Get-ChildItem -Path $latestRoot -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like '*Happy VS Code Bridge.log' } |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if ($outputLog) { $logsToTail += @{ Name = "$($target.Name) output"; Path = $outputLog.FullName } }
}

if (-not $logsToTail.Count) {
    Write-Error 'No exthost logs found under %APPDATA%\\Code\\logs or %APPDATA%\\Code - Insiders\\logs.'
    exit 1
}

$any = $true
Write-Host 'Tailing logs (Ctrl+C to stop):'
$logsToTail | ForEach-Object { Write-Host " - $($_.Name): $($_.Path)" }

$jobs = @()
foreach ($log in $logsToTail) {
    $jobs += Start-Job -ScriptBlock {
        param($path, $name, $tail)
        Get-Content -Path $path -Tail $tail -Wait | ForEach-Object { "[$name] $_" }
    } -ArgumentList $log.Path, $log.Name, $Tail
}

Receive-Job -Wait -Job $jobs | Write-Output
