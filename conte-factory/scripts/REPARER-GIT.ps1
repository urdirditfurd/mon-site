# Repare refs Git corrompus + met a jour la branche pipeline
# Usage:
#   powershell -ExecutionPolicy Bypass -File C:\ConteFactory\conte-factory\scripts\REPARER-GIT.ps1

$ErrorActionPreference = "Stop"
$Root = "C:\ConteFactory"
$Repo = "https://github.com/urdirditfurd/mon-site.git"
$Branch = "cursor/conte-factory-pipeline-0391"

function Invoke-Git {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$GitCommand
    )
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $out = & git @GitCommand 2>&1
    $code = $LASTEXITCODE
    $ErrorActionPreference = $prev
    if ($code -ne 0) {
        $msg = ($out | Out-String).Trim()
        throw "git $($GitCommand -join ' ') a echoue (code $code). $msg"
    }
    return $out
}

function Invoke-GitCleanSafe {
    Invoke-Git @(
        "clean", "-fd",
        "-e", "conte-factory/.venv",
        "-e", "conte-factory/data",
        "-e", "conte-factory/.env",
        "-e", "pinokio"
    ) | Out-Null
}

function Ensure-GitOrigin {
    param([string]$Url)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $remotes = @(& git remote 2>&1)
    $code = $LASTEXITCODE
    $ErrorActionPreference = $prev
    if ($code -ne 0) {
        throw "git remote a echoue (code $code)"
    }
    if ($remotes -contains "origin") {
        Invoke-Git @("remote", "set-url", "origin", $Url) | Out-Null
    } else {
        Invoke-Git @("remote", "add", "origin", $Url) | Out-Null
    }
}

if (-not (Test-Path $Root)) {
    throw "Dossier introuvable: $Root"
}
Set-Location $Root

Write-Host "=== Suppression refs Git corrompus ===" -ForegroundColor Cyan
$broken = @(
    ".git\refs\heads\cursor",
    ".git\refs\remotes\origin\cursor",
    ".git\ORIG_HEAD",
    ".git\MERGE_HEAD"
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
Ensure-GitOrigin -Url $Repo
$prev = $ErrorActionPreference
$ErrorActionPreference = "Continue"
& git reset --hard 2>&1 | Out-Null
$ErrorActionPreference = $prev
Invoke-GitCleanSafe
Invoke-Git @("fetch", "origin", $Branch, "--depth", "50") | Out-Null
Invoke-Git @("checkout", "-B", $Branch, "FETCH_HEAD") | Out-Null
Invoke-Git @("reset", "--hard", "FETCH_HEAD") | Out-Null
Write-Host "Git OK sur $Branch" -ForegroundColor Green
