@echo off
chcp 65001 >nul 2>&1
::
:: Lance Pinokio Remote en arrière-plan (pas de fenêtre console visible).
:: Utile pour démarrer automatiquement avec Windows.
:: Les logs sont écrits dans pinokio_remote.log
::

start /B "" python server.py > pinokio_remote.log 2>&1
echo Pinokio Remote démarré en arrière-plan.
echo Logs disponibles dans : %~dp0pinokio_remote.log
timeout /t 3 >nul
