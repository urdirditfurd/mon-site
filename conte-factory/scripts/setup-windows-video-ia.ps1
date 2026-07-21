#Requires -Version 5.1
<#
  Setup Windows - Conte Factory + Desktop shortcut "video ia"
  Run from anywhere:

    irm https://raw.githubusercontent.com/urdirditfurd/mon-site/cursor/conte-factory-pipeline-0391/conte-factory/scripts/setup-windows-video-ia.ps1 | iex

  Or after clone:

    powershell -ExecutionPolicy Bypass -File scripts\setup-windows-video-ia.ps1
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

function Refresh-Path {
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
              [System.Environment]::GetEnvironmentVariable("Path", "User")
}

function Ensure-Winget {
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if (-not $winget) {
    throw "winget not found. Install App Installer from Microsoft Store, then retry."
  }
}

function Ensure-Git {
  Refresh-Path
  $git = Get-Command git -ErrorAction SilentlyContinue
  if ($git) {
    Write-Host "Git OK: $($git.Source)"
    return
  }

  Write-Step "Installing Git (winget)"
  Ensure-Winget
  winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements
  Refresh-Path

  # Common install location if PATH not refreshed yet
  $candidates = @(
    "C:\Program Files\Git\cmd\git.exe",
    "C:\Program Files (x86)\Git\cmd\git.exe"
  )
  foreach ($c in $candidates) {
    if (Test-Path $c) {
      $env:Path = "$(Split-Path $c);$env:Path"
      break
    }
  }

  $git = Get-Command git -ErrorAction SilentlyContinue
  if (-not $git) {
    throw "Git installed but not in PATH. Close PowerShell, reopen, and re-run this script."
  }
}

function Get-RealPython {
  # Avoid Windows Store stub that prints "Python was not found"
  $cmds = @("python", "python3", "py")
  foreach ($name in $cmds) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if (-not $cmd) { continue }
    try {
      if ($name -eq "py") {
        $ver = & py -3 -c "import sys; print(sys.executable)" 2>$null
      } else {
        $ver = & $cmd.Source -c "import sys; print(sys.executable)" 2>$null
      }
      if ($LASTEXITCODE -eq 0 -and $ver -and ($ver -notmatch "WindowsApps")) {
        return @{ Name = $name; Exe = $ver.Trim() }
      }
    } catch { }
  }
  return $null
}

function Ensure-Python {
  Refresh-Path
  $py = Get-RealPython
  if ($py) {
    Write-Host "Python OK: $($py.Exe)"
    return $py
  }

  Write-Step "Installing Python 3.12 (winget)"
  Ensure-Winget
  winget install --id Python.Python.3.12 -e --source winget --accept-package-agreements --accept-source-agreements
  Refresh-Path

  # Typical paths right after install
  $local = Join-Path $env:LOCALAPPDATA "Programs\Python"
  if (Test-Path $local) {
    Get-ChildItem $local -Directory | ForEach-Object {
      $env:Path = "$($_.FullName);$($_.FullName)\Scripts;$env:Path"
    }
  }
  $pf = "C:\Program Files\Python312"
  if (Test-Path "$pf\python.exe") {
    $env:Path = "$pf;$pf\Scripts;$env:Path"
  }

  $py = Get-RealPython
  if (-not $py) {
    Write-Host ""
    Write-Host "Python is still missing from PATH." -ForegroundColor Yellow
    Write-Host "1. Install from https://www.python.org/downloads/"
    Write-Host "2. CHECK the box: Add python.exe to PATH"
    Write-Host "3. Close PowerShell completely and reopen"
    Write-Host "4. Re-run this script"
    throw "Python missing"
  }
  return $py
}

function Ensure-Repo {
  $marker = Join-Path $TargetRoot "conte-factory\scripts\launch-video-ia.bat"
  if (Test-Path $marker) {
    Write-Step "Project already present: $TargetRoot"
    Push-Location $TargetRoot
    try {
      git fetch origin $Branch 2>$null
      git checkout $Branch 2>$null
      git pull origin $Branch 2>$null
    } catch {
      Write-Host "Pull skipped ($($_.Exception.Message))"
    }
    Pop-Location
    return
  }

  Write-Step "Downloading project into $TargetRoot"
  if (-not (Test-Path $TargetRoot)) {
    git clone --branch $Branch --single-branch $RepoUrl $TargetRoot
  } else {
    Push-Location $TargetRoot
    if (-not (Test-Path ".git")) {
      Pop-Location
      throw "Folder $TargetRoot exists without git. Rename it, then re-run."
    }
    git fetch origin $Branch
    git checkout $Branch
    git pull origin $Branch
    Pop-Location
  }
}

function Ensure-PythonVenv {
  $cf = Join-Path $TargetRoot "conte-factory"
  $py = Ensure-Python
  Push-Location $cf
  try {
    if (-not (Test-Path ".venv\Scripts\python.exe")) {
      Write-Step "Creating Python venv (.venv)"
      if (Test-Path ".venv") { Remove-Item -Recurse -Force ".venv" }
      if ($py.Name -eq "py") {
        & py -3 -m venv .venv
      } else {
        & $py.Exe -m venv .venv
      }
    }
    if (-not (Test-Path ".venv\Scripts\python.exe")) {
      throw "venv creation failed"
    }

    Write-Step "Installing Conte Factory dependencies"
    & ".\.venv\Scripts\python.exe" -m pip install -U pip
    & ".\.venv\Scripts\python.exe" -m pip install -r requirements.txt
    if (-not (Test-Path ".env")) {
      Copy-Item ".env.example" ".env"
      Write-Host ".env created (provider pinokio / Wan)."
    }
  } finally {
    Pop-Location
  }
}

function Install-DesktopShortcut {
  Write-Step "Creating Desktop shortcut 'video ia'"
  $cf = Join-Path $TargetRoot "conte-factory"
  $shortcutScript = Join-Path $cf "scripts\install-desktop-shortcut.ps1"
  & powershell -NoProfile -ExecutionPolicy Bypass -File $shortcutScript
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
Write-Host "DONE." -ForegroundColor Green
Write-Host "1. Open Pinokio -> Wan Snapdragon ARM -> Install (first time) -> Run"
Write-Host "2. Double-click 'video ia' on the Desktop"
Write-Host "3. Project folder: $TargetRoot\conte-factory"
Write-Host ""
