# Broadcast European New Market to your local network (Wi-Fi / LAN).
# Other devices on the SAME network (your phone, a tablet) can then open the
# "Network" URL printed below- handy for testing the PWA on a real phone.
#
#   Usage:   .\serve-lan.ps1            # dev server with hot reload
#            .\serve-lan.ps1 -Preview   # serve the built production app
#
# If a device can't connect, allow Node.js through Windows Defender Firewall on
# "Private" networks (Windows usually prompts the first time).

param([switch]$Preview)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path "node_modules")) {
  Write-Host "Installing dependencies (first run)..." -ForegroundColor Yellow
  npm install
}

$port = if ($Preview) { 4180 } else { 5180 }

# Best-effort LAN IPv4 (skip loopback / APIPA / virtual adapters).
$ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object {
    $_.IPAddress -notlike "127.*" -and
    $_.IPAddress -notlike "169.254.*" -and
    $_.PrefixOrigin -ne "WellKnown"
  } |
  Sort-Object SkipAsSource |
  Select-Object -First 1).IPAddress

Write-Host ""
Write-Host "  European New Market  " -ForegroundColor White -BackgroundColor DarkRed
Write-Host "  Local:   http://localhost:$port"
if ($ip) {
  Write-Host "  Network: http://${ip}:$port" -ForegroundColor Green
  Write-Host "           ^ open this on your phone (same Wi-Fi)"
}
Write-Host ""

if ($Preview) {
  npm run build
  npm run preview:lan
} else {
  npm run dev:lan
}
