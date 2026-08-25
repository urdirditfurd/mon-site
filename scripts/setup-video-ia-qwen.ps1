# Setup Vidéo IA Qwen + Wan Pinokio (Windows)
# Usage: powershell -ExecutionPolicy Bypass -File .\scripts\setup-video-ia-qwen.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $Root ".git"))) {
  $Root = Get-Location
}

Set-Location $Root
Write-Host "==> Repo: $Root" -ForegroundColor Cyan

if (-not (Test-Path ".git")) {
  throw "Ce dossier n'est pas un dépôt git. Clone d'abord: git clone https://github.com/urdirditfurd/mon-site.git"
}

Write-Host "==> Fetch + checkout branche Vidéo IA Qwen" -ForegroundColor Cyan
git fetch origin
git checkout -f cursor/video-ia-qwen-workflow-37c6
if ($LASTEXITCODE -ne 0) {
  Write-Host "Branche feature introuvable, fallback main..." -ForegroundColor Yellow
  git checkout -f main
  git pull origin main
} else {
  git pull origin cursor/video-ia-qwen-workflow-37c6
}

if (-not (Test-Path "package.json")) {
  throw "package.json toujours absent. Clone propre recommandé: git clone https://github.com/urdirditfurd/mon-site.git"
}

if (-not (Test-Path "video-ia-qwen\index.html")) {
  throw "video-ia-qwen manquant sur cette branche."
}

Write-Host "==> npm install" -ForegroundColor Cyan
npm install

Write-Host ""
Write-Host "OK. Prochaines étapes:" -ForegroundColor Green
Write-Host "  1) npm start"
Write-Host "  2) Ouvre http://localhost:3000/video-ia-qwen"
Write-Host "  3) (optionnel) Pinokio → lancer pinokio\wan-snapdragon-arm (Gradio :7860, API :7867)"
Write-Host "  4) Moteur = Pinokio Wan local"
Write-Host ""
Write-Host "Lancer le serveur maintenant ? (O/N)" -ForegroundColor Cyan
$ans = Read-Host
if ($ans -match '^(o|oui|y|yes)$') {
  npm start
}
