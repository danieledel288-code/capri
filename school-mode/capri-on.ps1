# Capri ON: lift school mode and start her again.
$lock = Join-Path $env:APPDATA 'capri\SCHOOL_MODE'
Remove-Item $lock -ErrorAction SilentlyContinue
$exe = Join-Path $env:LOCALAPPDATA 'Programs\capri\Capri.exe'
if (Test-Path $exe) { Start-Process $exe; Write-Host "Capri is ON." -ForegroundColor Green }
else { Write-Host "School mode lifted, but Capri.exe isn't installed at $exe" -ForegroundColor Yellow }
