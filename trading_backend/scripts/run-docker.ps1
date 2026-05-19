param(
    [switch]$Build
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

if (-not (Test-Path ".env.docker")) {
    Copy-Item ".env.docker.example" ".env.docker"
    Write-Host "[run-docker] created .env.docker from template"
}

if ($Build) {
    docker compose --env-file .env.docker up -d --build
}
else {
    docker compose --env-file .env.docker up -d
}

Write-Host "[run-docker] services started"
docker compose ps
