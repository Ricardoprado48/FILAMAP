# O12 - Abre a Web com o orcamento por placas no SEU computador (http://localhost:5173),
# ligada a producao: entra com a sua conta e usa o seu estoque de verdade.
# Nada e publicado. Salvar no catalogo grava no banco de verdade (como no site).
# Para fechar: Ctrl+C nesta janela.
# Uso: powershell -ExecutionPolicy Bypass -File <repo>\ops\o12-testar-local.ps1
$ErrorActionPreference = "Stop"
Set-Location (Join-Path (Split-Path $PSScriptRoot -Parent) "web-app")
if (-not (Test-Path node_modules)) { npm ci }
Write-Host "Abrindo http://localhost:5173 ... (Ctrl+C para fechar)"
npx vite --open
