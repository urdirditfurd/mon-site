# Configuration rapide de la tour Windows (à lancer en Administrateur)
# Usage: powershell -ExecutionPolicy Bypass -File setup-tower.ps1

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "=== Configuration Tour Pinokio (sans onduleur) ===" -ForegroundColor Cyan
Write-Host ""

# 1. Désactiver veille / hibernation
Write-Host "[1/5] Désactivation veille et hibernation..."
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /change monitor-timeout-ac 15
powercfg /hibernate off
Write-Host "  OK" -ForegroundColor Green

# 2. OpenSSH Server (pour restart à distance via Tailscale SSH)
Write-Host "[2/5] OpenSSH Server..."
$sshCapability = Get-WindowsCapability -Online | Where-Object Name -like "OpenSSH.Server*"
if ($sshCapability.State -ne "Installed") {
    Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0 | Out-Null
}
Start-Service sshd -ErrorAction SilentlyContinue
Set-Service -Name sshd -StartupType Automatic
Write-Host "  OK — sshd actif" -ForegroundColor Green

# 3. Tailscale (si absent, affiche instructions)
Write-Host "[3/5] Tailscale..."
if (Get-Command tailscale -ErrorAction SilentlyContinue) {
    tailscale status
    Write-Host "  OK" -ForegroundColor Green
} else {
    Write-Host "  Installez Tailscale: https://tailscale.com/download/windows" -ForegroundColor Yellow
}

# 4. Pinokio Remote autostart
Write-Host "[4/5] Pinokio Remote..."
$remoteDir = Join-Path $PSScriptRoot "..\..\pinokio-remote"
$remoteDir = (Resolve-Path $remoteDir -ErrorAction SilentlyContinue)
if ($remoteDir) {
    $setupBat = Join-Path $remoteDir "setup_autostart.bat"
    if (Test-Path $setupBat) {
        Write-Host "  Lancez: $setupBat" -ForegroundColor Yellow
    }
} else {
    Write-Host "  Clonez pinokio-remote sur la tour et lancez setup_autostart.bat" -ForegroundColor Yellow
}

# 5. Rappels BIOS + prise connectée
Write-Host "[5/5] Rappels manuels obligatoires:" -ForegroundColor Yellow
Write-Host "  - BIOS: AC Power Loss = Power On"
Write-Host "  - Ethernet uniquement (pas Wi-Fi)"
Write-Host "  - Prise connectée entre mur et PC (hard reset à distance)"
Write-Host "  - netplwiz: connexion auto sans mot de passe"
Write-Host "  - Parsec installé pour le bureau à distance"
Write-Host ""

Write-Host "=== Terminé ===" -ForegroundColor Cyan
