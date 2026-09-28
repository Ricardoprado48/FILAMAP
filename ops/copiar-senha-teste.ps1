# Copia para a area de transferencia a senha do usuario do ambiente de TESTE
# (https://staging.filamap.pages.dev). A senha nunca aparece na tela.
$ErrorActionPreference = "Stop"
$sec = (Get-Content "$env:APPDATA\Filamap-dev\staging-keys.dpapi" -Raw).Trim() | ConvertTo-SecureString
$k = [System.Net.NetworkCredential]::new("", $sec).Password | ConvertFrom-Json
Set-Clipboard -Value $k.password
Write-Host "E-mail : $($k.email)"
Write-Host "Senha  : copiada (Ctrl+V no campo Senha). Abra https://staging.filamap.pages.dev"
