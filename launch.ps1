# Hermes Desktop Launch Script
# Run this to start Hermes Desktop

Write-Host "Starting Hermes Desktop..." -ForegroundColor Cyan

# Check if Hermes is installed
$hermesPath = "$env:LOCALAPPDATA\hermes\hermes-agent\hermes"
if (Test-Path $hermesPath) {
    Write-Host "✓ Hermes Agent found" -ForegroundColor Green
    python $hermesPath --version
} else {
    Write-Host "✗ Hermes Agent not found - will need installation" -ForegroundColor Yellow
}

# Start the app
cd "$PSScriptRoot"
npm run dev
