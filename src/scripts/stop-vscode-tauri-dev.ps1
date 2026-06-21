param(
    [switch]$Quiet
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$stateRoot = Join-Path ([System.IO.Path]::GetTempPath()) "j3markdown-vscode"
$pidFile = Join-Path $stateRoot "tauri-dev.pid.json"
$startScript = (Resolve-Path (Join-Path $PSScriptRoot "start-vscode-tauri-dev.ps1")).Path

function Write-Info {
    param([Parameter(Mandatory = $true)][string]$Message)

    if (-not $Quiet) {
        Write-Host $Message
    }
}

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

function Remove-PidFile {
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}

if (-not (Test-Path -LiteralPath $pidFile)) {
    Write-Info "No recorded j3Markdown VS Code dev process was found."
    exit 0
}

try {
    $record = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
} catch {
    Remove-PidFile
    Write-Info "Removed unreadable j3Markdown VS Code dev PID file."
    exit 0
}

if ($record.workspace -ne $repoRoot) {
    Write-Info "Recorded VS Code dev process belongs to another workspace; leaving it running."
    exit 0
}

$rootPid = [int]$record.pid
$rootProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $rootPid" -ErrorAction SilentlyContinue
$tree = @(Get-ProcessTree -RootPid $rootPid)

if ($rootProcess) {
    $commandLine = [string]$rootProcess.CommandLine
    $normalizedCommandLine = $commandLine -replace "/", "\"
    $normalizedStartScript = $startScript -replace "/", "\"
    if (-not $normalizedCommandLine.Contains($normalizedStartScript)) {
        Remove-PidFile
        Write-Info "Recorded PID no longer belongs to the j3Markdown VS Code dev launcher."
        exit 0
    }

    & taskkill.exe /PID $rootPid /T /F *> $null
    Remove-PidFile
    Write-Info "Stopped j3Markdown VS Code dev process tree rooted at PID $rootPid."
    exit 0
}

$descendants = @($tree | Where-Object { [int]$_.ProcessId -ne $rootPid })
foreach ($process in $descendants) {
    & taskkill.exe /PID $process.ProcessId /T /F *> $null
}

Remove-PidFile
if ($descendants.Count -gt 0) {
    Write-Info "Stopped orphaned j3Markdown VS Code dev child processes for PID $rootPid."
} else {
    Write-Info "Recorded j3Markdown VS Code dev process was already stopped."
}
