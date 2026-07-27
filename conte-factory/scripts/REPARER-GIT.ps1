# Repare refs Git corrompus + met a jour la branche pipeline
# Usage:
#   powershell -ExecutionPolicy Bypass -File C:\ConteFactory\conte-factory\scripts\REPARER-GIT.ps1

$ErrorActionPreference = "Stop"
$Root = "C:\ConteFactory"
$Repo = "https://github.com/urdirditfurd/mon-site.git"
$Branch = "cursor/conte-factory-pipeline-0391"

if (-not (Test-Path $Root)) {
    throw "Dossier introuvable: $Root"
}
Set-Location $Root

Write-Host "=== Suppression refs Git corrompus ===" -ForegroundColor Cyan
$broken = @(
    ".git\refs\heads\cursor",
    ".git\refs\remotes\origin\cursor",
    ".git\refs\heads\$Branch",
    ".git\refs\remotes\origin\$Branch"
)
foreach ($rel in $broken) {
    $full = Join-Path $Root $rel
    if (Test-Path $full) {
        Remove-Item -Recurse -Force $full
        Write-Host "Supprime: $rel"
    }
}

$packed = Join-Path $Root ".git\packed-refs"
if (Test-Path $packed) {
    $lines = Get-Content $packed | Where-Object {
        $_ -notmatch "cursor/conte-factory-pipeline-0391"
    }
    Set-Content -Path $packed -Value $lines -Encoding Ascii
    Write-Host "Nettoyage packed-refs"
}

Write-Host "=== Reset local + fetch ===" -ForegroundColor Cyan
git remote remove origin 2>$null
git remote add origin $Repo
git reset --hard 2>$null
git clean -fd
git fetch origin $Branch --depth 50
if ($LASTEXITCODE -ne 0) {
    throw "git fetch a echoue"
}

git checkout -B $Branch FETCH_HEAD
git reset --hard FETCH_HEAD
Write-Host "Git OK sur $Branch" -ForegroundColor Green
