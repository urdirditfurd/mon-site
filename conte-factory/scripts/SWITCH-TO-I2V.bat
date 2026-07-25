@echo off
REM Config I2V FACE-SAFE (sans PowerShell unicode)
setlocal
cd /d "%~dp0\.."
set ENVFILE=.env
if not exist "%ENVFILE%" copy /Y .env.example "%ENVFILE%" >nul

REM Ecrit un bloc propre (Ascii)
> "%TEMP%\conte_i2v_env.txt" (
echo CONTE_VIDEO_PROVIDER=i2v
echo CONTE_AUTO_START_I2V=1
echo CONTE_AUTO_START_LIPSYNC=0
echo CONTE_AUTO_START_WAN=0
echo PINOKIO_I2V_URL=http://127.0.0.1:7861
echo WAN_I2V_BACKEND=ltx
echo PINOKIO_I2V_FRAMES=33
echo PINOKIO_I2V_STEPS=22
echo PINOKIO_I2V_WIDTH=848
echo PINOKIO_I2V_HEIGHT=480
echo PINOKIO_I2V_GUIDANCE=3.5
echo PINOKIO_I2V_MOTION_SCALE=0.3
echo PINOKIO_I2V_SCHEDULER=default
echo PINOKIO_I2V_RESOLUTION=848p 16:9
echo CONTE_I2V_LOWVRAM=1
echo CONTE_I2V_PREFER_CLI=1
echo CONTE_I2V_USE_BATCH=1
echo WAN_DTYPE=float16
echo SULPHUR_CPU_OFFLOAD=1
echo CONTE_TTS_VOICE=fr-FR-VivienneMultilingualNeural
echo CONTE_TTS_SAMPLE_RATE=44100
echo CONTE_TTS_MP3_BITRATE=192k
echo CONTE_DURATION_TOLERANCE_SEC=5
)

REM Fusionne: garde les autres cles .env, remplace celles I2V
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$envFile='.env'; $patch=Get-Content $env:TEMP\conte_i2v_env.txt; $map=@{}; foreach($l in $patch){ if($l -match '^([^=]+)=(.*)$'){ $map[$matches[1]]=$matches[2] } }; $out=@(); if(Test-Path $envFile){ foreach($l in Get-Content $envFile){ if($l -match '^([^=]+)='){ $k=$matches[1]; if($map.ContainsKey($k)){ $out += ($k+'='+$map[$k]); $map.Remove($k); continue } }; $out += $l } }; foreach($k in $map.Keys){ $out += ($k+'='+$map[$k]) }; Set-Content -Path $envFile -Value $out -Encoding Ascii"

echo OK: I2V face-safe CFG=3.5 motion=0.3 848x480
echo Puis: scripts\REPARER-ET-RELANCE-36.bat
endlocal
