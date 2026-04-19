# Cursor/старый PowerShell часто не видит npm после установки Node — подтягиваем PATH из Windows.
$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
Set-Location (Join-Path $PSScriptRoot "backend")
npm run dev
