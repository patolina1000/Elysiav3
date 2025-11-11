# Script PowerShell para iniciar ngrok e servidor Elysia
# Uso: .\start-with-ngrok.ps1

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Elysia Multi-Bots + ngrok" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Verificar se ngrok está instalado
$ngrokPath = Get-Command ngrok -ErrorAction SilentlyContinue
if (-not $ngrokPath) {
    Write-Host "❌ ngrok não encontrado no PATH" -ForegroundColor Red
    Write-Host ""
    Write-Host "Instale ngrok em: https://ngrok.com/download" -ForegroundColor Yellow
    Write-Host "Ou use: choco install ngrok" -ForegroundColor Yellow
    exit 1
}

Write-Host "✓ ngrok encontrado: $($ngrokPath.Source)" -ForegroundColor Green
Write-Host ""

# Verificar se npm está instalado
$npmPath = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npmPath) {
    Write-Host "❌ npm não encontrado no PATH" -ForegroundColor Red
    exit 1
}

Write-Host "✓ npm encontrado" -ForegroundColor Green
Write-Host ""

# Iniciar ngrok em background
Write-Host "Iniciando ngrok na porta 3000..." -ForegroundColor Cyan
Start-Process -NoNewWindow -FilePath "ngrok" -ArgumentList "http 3000"

# Aguardar ngrok iniciar
Write-Host "Aguardando ngrok iniciar..." -ForegroundColor Yellow
Start-Sleep -Seconds 3

# Verificar se ngrok está respondendo
$ngrokStatus = $null
try {
    $ngrokStatus = Invoke-RestMethod -Uri "http://localhost:4040/api/tunnels" -ErrorAction SilentlyContinue
} catch {
    Write-Host "⚠ ngrok ainda não respondeu, tentando novamente..." -ForegroundColor Yellow
    Start-Sleep -Seconds 2
    try {
        $ngrokStatus = Invoke-RestMethod -Uri "http://localhost:4040/api/tunnels" -ErrorAction SilentlyContinue
    } catch {
        Write-Host "❌ Não foi possível conectar ao ngrok" -ForegroundColor Red
        Write-Host "Certifique-se de que ngrok está rodando corretamente" -ForegroundColor Red
        exit 1
    }
}

if ($ngrokStatus -and $ngrokStatus.tunnels.Count -gt 0) {
    $publicUrl = $ngrokStatus.tunnels[0].public_url
    Write-Host "✓ ngrok iniciado com sucesso!" -ForegroundColor Green
    Write-Host "  URL pública: $publicUrl" -ForegroundColor Green
} else {
    Write-Host "⚠ ngrok iniciado mas sem tunnels ativos" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Iniciando servidor Elysia..." -ForegroundColor Cyan
Write-Host ""

# Iniciar servidor
npm start

# Se o servidor encerrar, parar ngrok também
Write-Host ""
Write-Host "Encerrando ngrok..." -ForegroundColor Yellow
Stop-Process -Name ngrok -Force -ErrorAction SilentlyContinue

Write-Host "Concluído!" -ForegroundColor Green
