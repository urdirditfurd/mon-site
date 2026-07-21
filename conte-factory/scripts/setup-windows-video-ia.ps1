#Requires -Version 5.1
<#
  Setup Windows — Conte Factory + icône Bureau « video ia »
  À coller / lancer même depuis C:\Users\...

  Usage :
    powershell -ExecutionPolicy Bypass -File setup-windows-video-ia.ps1

  Ou en une ligne (depuis n'importe où) :
    irm https://raw.githubusercontent.com/urdirditfurd/mon-site/cursor/conte-factory-pipeline-0391/conte-factory/scripts/setup-windows-video-ia.ps1 | iex
#>

$ErrorActionPreference = "Stop"
$RepoUrl = "https://github.com/urdirditfurd/mon-site.git"
$Branch = "cursor/conte-factory-pipeline-0391"
$TargetRoot = Join-Path $env:USERPROFILE "mon-site"
$Desktop = [Environment]::GetFolderPath("Desktop")

function Write-Step($msg) {
  Write-Host ""
  Write-Host "==> $msg" -ForegroundColor Cyan
}

function Ensure-Git {
  $git = Get-Command git -ErrorAction SilentlyContinue
  if ($git) {
    Write-Host "Git OK : $($git.Source)"
    return
  }

  Write-Step "Git introuvable — tentative d'installation (winget)"
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if ($winget) {
    winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("Path", "User")
    $git = Get-Command git -ErrorAction SilentlyContinue
    if ($git) { return }
  }

  Write-Host ""
  Write-Host "Git n'est pas installe. Fais ceci puis relance ce script :" -ForegroundColor Yellow
  Write-Host "  1. Ouvre https://git-scm.com/download/win"
  Write-Host "  2. Installe Git (options par defaut)"
  Write-Host "  3. FERME PowerShell et rouvre une NOUVELLE fenetre"
  Write-Host "  4. Relance ce script"
  throw "Git manquant"
}

function Ensure-Repo {
  if (Test-Path (Join-Path $TargetRoot "conte-factory\scripts\launch-video-ia.bat")) {
    Write-Step "Projet deja present : $TargetRoot"
    Push-Location $TargetRoot
    try {
      git fetch origin $Branch 2>$null
      git checkout $Branch 2>$null
      git pull origin $Branch 2>$null
    } catch {
      Write-Host "Pull ignore ($($_.Exception.Message))"
    }
    Pop-Location
    return
  }

  Write-Step "Telechargement du projet dans $TargetRoot"
  if (Test-Path $TargetRoot) {
    Write-Host "Le dossier existe mais semble incomplet. On continue avec git clone dans un sous-dossier..."
  }
  $parent = Split-Path $TargetRoot -Parent
  if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent | Out-Null }

  if (-not (Test-Path $TargetRoot)) {
    git clone --branch $Branch --single-branch $RepoUrl $TargetRoot
  } else {
    Push-Location $TargetRoot
    if (-not (Test-Path ".git")) {
      Pop-Location
      throw "Le dossier $TargetRoot existe sans git. Renomme-le puis relance."
    }
    git fetch origin $Branch
    git checkout $Branch
    git pull origin $Branch
    Pop-Location
  }
}

function Ensure-PythonVenv {
  $cf = Join-Path $TargetRoot "conte-factory"
  Push-Location $cf
  try {
    if (-not (Test-Path ".venv")) {
      Write-Step "Creation environnement Python (.venv)"
      $py = Get-Command python -ErrorAction SilentlyContinue
      if (-not $py) { $py = Get-Command py -ErrorAction SilentlyContinue }
      if (-not $py) {
        Write-Host "Python manquant. Installe depuis https://www.python.org/downloads/ (coche 'Add to PATH')" -ForegroundColor Yellow
        throw "Python manquant"
      }
      if ($py.Name -eq "py.exe" -or $py.Name -eq "py") {
        py -3 -m venv .venv
      } else {
        python -m venv .venv
      }
    }
    Write-Step "Installation des dependances Conte Factory"
    & ".\.venv\Scripts\python.exe" -m pip install -U pip
    & ".\.venv\Scripts\python.exe" -m pip install -r requirements.txt
    if (-not (Test-Path ".env")) {
      Copy-Item ".env.example" ".env"
      Write-Host "Fichier .env cree (provider pinokio / Wan)."
    }
  } finally {
    Pop-Location
  }
}

function Install-DesktopShortcut {
  Write-Step "Creation du raccourci Bureau « video ia »"
  $cf = Join-Path $TargetRoot "conte-factory"
  $Bat = Join-Path $cf "scripts\launch-video-ia.bat"
  $IconPng = Join-Path $cf "assets\video-ia-icon.png"
  $IcoTarget = Join-Path $cf "assets\video-ia-icon.ico"
  $ShortcutPath = Join-Path $Desktop "video ia.lnk"

  if (-not (Test-Path $Bat)) {
    throw "Lanceur introuvable: $Bat"
  }

  $IconLocation = $null
  if (Test-Path $IconPng) {
    try {
      Add-Type -AssemblyName System.Drawing
      $img = [System.Drawing.Image]::FromFile($IconPng)
      $iconBmp = New-Object System.Drawing.Bitmap $img, 256, 256
      $hIcon = $iconBmp.GetHicon()
      $iconObj = [System.Drawing.Icon]::FromHandle($hIcon)
      $fs = [System.IO.File]::Create($IcoTarget)
      $iconObj.Save($fs)
      $fs.Close()
      $img.Dispose()
      $iconBmp.Dispose()
      $IconLocation = "$IcoTarget,0"
    } catch {
      Write-Host "Conversion ICO ignoree — icone par defaut."
    }
  }

  $Wsh = New-Object -ComObject WScript.Shell
  $Sc = $Wsh.CreateShortcut($ShortcutPath)
  $Sc.TargetPath = $Bat
  $Sc.WorkingDirectory = $cf
  $Sc.WindowStyle = 1
  $Sc.Description = "video ia — suivi Contes (Pinokio Wan + Conte Factory)"
  if ($IconLocation) { $Sc.IconLocation = $IconLocation }
  $Sc.Save()

  Write-Host "Raccourci : $ShortcutPath" -ForegroundColor Green
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Setup video ia (Windows)" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green

Ensure-Git
Ensure-Repo
Ensure-PythonVenv
Install-DesktopShortcut

Write-Host ""
Write-Host "TERMINE." -ForegroundColor Green
Write-Host "1. Ouvre Pinokio → Wan Snapdragon ARM → Install (1ere fois) → Run"
Write-Host "2. Double-clique « video ia » sur le Bureau"
Write-Host "3. Projet : $TargetRoot\conte-factory"
Write-Host ""
