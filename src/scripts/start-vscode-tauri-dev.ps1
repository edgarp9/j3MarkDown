$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$stateRoot = Join-Path ([System.IO.Path]::GetTempPath()) "j3markdown-vscode"
$pidFile = Join-Path $stateRoot "tauri-dev.pid.json"
$stopScript = Join-Path $PSScriptRoot "stop-vscode-tauri-dev.ps1"

function Get-ProcessTree {
    param([Parameter(Mandatory = $true)][int]$RootPid)

    $allProcesses = @(Get-CimInstance Win32_Process)
    $processIds = New-Object "System.Collections.Generic.HashSet[int]"
    [void]$processIds.Add($RootPid)

    $changed = $true
    while ($changed) {
        $changed = $false
        foreach ($process in $allProcesses) {
            if ($processIds.Contains([int]$process.ParentProcessId) -and -not $processIds.Contains([int]$process.ProcessId)) {
                [void]$processIds.Add([int]$process.ProcessId)
                $changed = $true
            }
        }
    }

    $allProcesses | Where-Object { $processIds.Contains([int]$_.ProcessId) }
}

function Stop-ChildProcessTree {
    $children = @(Get-ProcessTree -RootPid $PID | Where-Object { [int]$_.ProcessId -ne $PID })
    foreach ($child in $children) {
        & taskkill.exe /PID $child.ProcessId /T /F *> $null
    }
}

function Remove-OwnPidFile {
    if (-not (Test-Path -LiteralPath $pidFile)) {
        return
    }

    try {
        $record = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
        if ([int]$record.pid -eq $PID -and $record.workspace -eq $repoRoot) {
            Remove-Item -LiteralPath $pidFile -Force
        }
    } catch {
        Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    }
}

New-Item -ItemType Directory -Force -Path $stateRoot | Out-Null

if (Test-Path -LiteralPath $stopScript) {
    & $stopScript -Quiet
}

$record = [ordered]@{
    pid = $PID
    workspace = $repoRoot
    script = $PSCommandPath
    startedAt = (Get-Date).ToString("o")
}
$record | ConvertTo-Json | Set-Content -LiteralPath $pidFile -Encoding UTF8

$exitCode = 0
Push-Location $repoRoot
try {
    & corepack pnpm run tauri:dev
    $exitCode = if ($LASTEXITCODE -ne $null) { $LASTEXITCODE } else { 0 }
} catch {
    Write-Error $_ -ErrorAction Continue
    $exitCode = 1
} finally {
    Pop-Location
    Stop-ChildProcessTree
    Remove-OwnPidFile
}

exit $exitCode
