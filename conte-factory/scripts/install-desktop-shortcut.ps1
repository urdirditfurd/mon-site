# Creates Desktop shortcut named "video ia"
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\install-desktop-shortcut.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Desktop = [Environment]::GetFolderPath("Desktop")
$ShortcutPath = Join-Path $Desktop "video ia.lnk"
$Bat = Join-Path $PSScriptRoot "DEMARRER-VIDEO-IA.bat"
$Icon = Join-Path $Root "assets\video-ia-icon.png"
$IcoTarget = Join-Path $Root "assets\video-ia-icon.ico"

if (-not (Test-Path $Bat)) {
  throw "Launcher not found: $Bat"
}

$IconLocation = $null
if (Test-Path $Icon) {
  try {
    Add-Type -AssemblyName System.Drawing
    $img = [System.Drawing.Image]::FromFile($Icon)
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
    Write-Host "ICO conversion skipped - using default icon."
  }
}

$Wsh = New-Object -ComObject WScript.Shell
$Sc = $Wsh.CreateShortcut($ShortcutPath)
$Sc.TargetPath = $Bat
$Sc.WorkingDirectory = $Root
$Sc.WindowStyle = 1
$Sc.Description = "video ia - Conte Factory + Pinokio Wan tracker"
if ($IconLocation) {
  $Sc.IconLocation = $IconLocation
}
$Sc.Save()

Write-Host ""
Write-Host "OK - shortcut created:"
Write-Host "  $ShortcutPath"
Write-Host "Double-click 'video ia' on the Desktop to open the tracker."
Write-Host ""
