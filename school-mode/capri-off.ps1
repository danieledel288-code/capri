# Capri OFF: kill every Capri and Claude process and keep Capri from starting until capri-on.ps1 runs.
# -List only shows what would be killed.
param([switch]$List)

function Get-CapriProcs {
  $all = Get-CimInstance Win32_Process
  $app = $all | Where-Object { $_.Name -eq 'Capri.exe' }
  $appIds = @($app.ProcessId)
  $alive = @($all.ProcessId)
  # the Python sidecar: a child of Capri, or an orphaned `python -u core.py` whose parent already died
  $core = $all | Where-Object { $_.Name -match '^pythonw?\.exe$' -and $_.CommandLine -match '-u core\.py' -and
    (($appIds -contains $_.ParentProcessId) -or ($alive -notcontains $_.ParentProcessId)) }
  @($core) + @($app) | Where-Object { $_ }
}

function Get-ClaudeProcs {
  # Claude Code CLI (native or npm install), the Claude desktop app, and its Chrome bridge
  Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and (
    $_.Name -match '^claude' -or
    "$($_.ExecutablePath)" -match '\\(AnthropicClaude|Claude_[a-z0-9]+)\\|\\Claude\\ChromeNativeHost\\' -or
    "$($_.CommandLine)" -match '@anthropic-ai[\\/]claude-code') }
}

if ($List) {
  Write-Host "Capri:"; Get-CapriProcs | Format-Table ProcessId, Name, CommandLine -AutoSize
  Write-Host "Claude:"; Get-ClaudeProcs | Format-Table ProcessId, Name, ExecutablePath -AutoSize
  return
}

$lock = Join-Path $env:APPDATA 'capri\SCHOOL_MODE'
New-Item -ItemType Directory -Force (Split-Path $lock) | Out-Null
# runs hidden when the settings panel starts it, so leave a record of what happened
Start-Transcript -Path (Join-Path $env:APPDATA 'capri\school-mode.log') -Force | Out-Null
Set-Content -Path $lock -Value (Get-Date -Format o) -Encoding utf8

# no auto-start
$run = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
(Get-ItemProperty $run).PSObject.Properties | Where-Object { "$($_.Value)" -match 'capri' } |
  ForEach-Object { Remove-ItemProperty -Path $run -Name $_.Name; Write-Host "removed startup entry $($_.Name)" }

# Capri launches this script, so it is inside Capri's process tree: a /T kill of Capri.exe would take
# this script down with it before the rest ran. Claude goes first, then the sidecar's tree, and
# Capri.exe last and on its own (no /T).
foreach ($p in @(Get-ClaudeProcs)) { taskkill /PID $p.ProcessId /T /F 2>$null | Out-Null }
foreach ($p in @(Get-CapriProcs) | Where-Object { $_.Name -ne 'Capri.exe' }) { taskkill /PID $p.ProcessId /T /F 2>$null | Out-Null }
foreach ($p in @(Get-CapriProcs) | Where-Object { $_.Name -eq 'Capri.exe' }) { taskkill /PID $p.ProcessId /F 2>$null | Out-Null }
Start-Sleep -Milliseconds 800
$left = @(Get-CapriProcs) + @(Get-ClaudeProcs) | Where-Object { $_ }
if ($left) {
  Write-Host "STILL RUNNING:" -ForegroundColor Red
  $left | Format-Table ProcessId, Name, CommandLine -AutoSize
  exit 1
}
Write-Host "Capri and Claude are OFF. No processes running, Capri startup disabled and launch blocked." -ForegroundColor Green
Write-Host "Run 'Capri ON' to bring her back."
