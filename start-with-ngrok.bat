@echo off
REM Script batch para iniciar ngrok e servidor Elysia
REM Uso: start-with-ngrok.bat

setlocal enabledelayedexpansion

echo ========================================
echo Elysia Multi-Bots + ngrok
echo ========================================
echo.

REM Verificar se ngrok está instalado
where ngrok >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERRO] ngrok nao encontrado no PATH
    echo.
    echo Instale ngrok em: https://ngrok.com/download
    echo Ou use: choco install ngrok
    pause
    exit /b 1
)

echo [OK] ngrok encontrado
echo.

REM Verificar se npm está instalado
where npm >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERRO] npm nao encontrado no PATH
    pause
    exit /b 1
)

echo [OK] npm encontrado
echo.

REM Iniciar ngrok em background
echo Iniciando ngrok na porta 3000...
start "ngrok" ngrok http 3000

REM Aguardar ngrok iniciar
echo Aguardando ngrok iniciar...
timeout /t 3 /nobreak

REM Verificar se ngrok está respondendo
echo Verificando conexao com ngrok...
curl -s http://localhost:4040/api/tunnels >nul 2>nul
if %errorlevel% neq 0 (
    echo [AVISO] ngrok ainda nao respondeu, tentando novamente...
    timeout /t 2 /nobreak
    curl -s http://localhost:4040/api/tunnels >nul 2>nul
    if %errorlevel% neq 0 (
        echo [ERRO] Nao foi possivel conectar ao ngrok
        pause
        exit /b 1
    )
)

echo [OK] ngrok iniciado com sucesso!
echo.

REM Iniciar servidor
echo Iniciando servidor Elysia...
echo.

call npm start

REM Se o servidor encerrar, parar ngrok também
echo.
echo Encerrando ngrok...
taskkill /IM ngrok.exe /F >nul 2>nul

echo Concluido!
pause
