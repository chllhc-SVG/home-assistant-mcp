@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d %~dp0

node scripts/start-dev.mjs
