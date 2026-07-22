# Installe automatisation Windows 100% autonome
# Usage: powershell -ExecutionPolicy Bypass -File scripts\install-windows-autostart.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$VenvPy = Join-Path $Root ".venv\Scripts\python.exe"
$DemarrerBat = Join-Path $PSScriptRoot "DEMARRER-VIDEO-IA.bat"
$PipelineBat = Join-Path $PSScriptRoot "run-scheduled-pipeline.bat"
$TaskPrefix = "VideoIA"

if (-not (Test-Path $VenvPy)) {
  throw "Environnement Python manquant. Lance INSTALL-NVIDIA.ps1 avant de continuer."
}

function Register-VideoIATask {
  param(
    [string]$Name,
    [string]$Description,
    [string]$BatPath,
    [string]$BatArgs = "",
    [string]$TriggerType,
    [string]$Time = "02:00"
  )
  $taskName = "$TaskPrefix-$Name"
  $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($existing) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  }

  $action = New-ScheduledTaskAction `
    -Execute "cmd.exe" `
    -Argument "/c `"$BatPath`" $BatArgs" `
    -WorkingDirectory $Root

  if ($TriggerType -eq "AtLogon") {
    $trigger = New-ScheduledTaskTrigger -AtLogon
  } else {
    $trigger = New-ScheduledTaskTrigger -Daily -At $Time
  }

  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 2 `
    -RestartInterval (New-TimeSpan -Minutes 5)

  Register-ScheduledTask `
    -TaskName $taskName `
    -Description $Description `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -RunLevel Highest | Out-Null

  Write-Host "OK tache planifiee : $taskName" -ForegroundColor Green
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Installation automatisation Video IA" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Register-VideoIATask `
  -Name "Dashboard" `
  -Description "Demarre Wan GPU + dashboard video ia au login Windows" `
  -BatPath $DemarrerBat `
  -BatArgs "quiet" `
  -TriggerType "AtLogon"

Register-VideoIATask `
  -Name "PipelineNuit" `
  -Description "Pipeline complet conte-factory chaque nuit" `
  -BatPath $PipelineBat `
  -TriggerType "Daily" `
  -Time "02:00"

Write-Host ""
Write-Host "Termine." -ForegroundColor Green
Write-Host "  - Au login : Wan + http://127.0.0.1:8501"
Write-Host "  - Chaque nuit 02:00 : pipeline complet"
Write-Host "  - Logs : data\scheduled.log et data\wan_server.log"
Write-Host ""
Write-Host "Taches : VideoIA-Dashboard, VideoIA-PipelineNuit"
Write-Host ""
