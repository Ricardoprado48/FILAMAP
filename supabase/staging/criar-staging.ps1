# Filamap - cria/atualiza o ambiente de STAGING (projeto Supabase separado, plano gratuito)
# e roda o teste ponta a ponta do pareamento de computador.
#
# Executar em PowerShell normal:
#   powershell -ExecutionPolicy Bypass -File C:\FILAMAP-device-pairing\supabase\staging\criar-staging.ps1
#
# - Projeto "filamap-staging" na organizacao Rprado3d (a outra org ja tem 2 projetos ativos,
#   limite do plano gratuito). Regiao sa-east-1. Custo zero; pausa sozinho apos 7 dias sem uso.
# - Senha do banco e chaves ficam em %APPDATA%\Filamap-dev, criptografadas com DPAPI
#   (so este usuario do Windows consegue ler). Nada e impresso na tela.
# - Rodar de novo e seguro: reaproveita o projeto e reaplica o que faltar.
$ErrorActionPreference = "Stop"

$Repo    = "C:\FILAMAP-device-pairing"
$OrgId   = "femhztrnkpxuydozsnca"
$Name    = "filamap-staging"
$Region  = "sa-east-1"
$ProdRef = "gqtlszffgvxsqcmefhyd"
$DevDir  = Join-Path $env:APPDATA "Filamap-dev"
$PwFile  = Join-Path $DevDir "staging-db-password.dpapi"
$RefFile = Join-Path $DevDir "staging-ref.txt"
$KeyFile = Join-Path $DevDir "staging-keys.dpapi"

function Protect-ToFile([string]$Plain, [string]$Path) {
    $Plain | ConvertTo-SecureString -AsPlainText -Force | ConvertFrom-SecureString | Set-Content $Path -Encoding ascii
}
function Unprotect-FromFile([string]$Path) {
    $sec = Get-Content $Path -Raw | ConvertTo-SecureString
    return [System.Net.NetworkCredential]::new("", $sec).Password
}
function Invoke-Supabase {
    # O CLI escreve avisos de versao no stderr; so o codigo de saida importa.
    $prev = $ErrorActionPreference; $ErrorActionPreference = "Continue"
    $out = & supabase @args 2>$null
    $code = $LASTEXITCODE
    $ErrorActionPreference = $prev
    if ($code -ne 0) { throw "supabase $($args -join ' ') falhou (codigo $code)" }
    return $out
}

New-Item -ItemType Directory -Force $DevDir | Out-Null

# 1. Senha do banco (gerada uma vez)
if (-not (Test-Path $PwFile)) {
    $bytes = New-Object byte[] 24
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    Protect-ToFile (([Convert]::ToBase64String($bytes)) -replace '[+/=]', 'x') $PwFile
}
$DbPassword = Unprotect-FromFile $PwFile

# 2. Projeto (cria so se ainda nao existe)
$projects = (Invoke-Supabase projects list -o json | Out-String | ConvertFrom-Json).projects
$existing = $projects | Where-Object { $_.name -eq $Name -and $_.organization_id -eq $OrgId } | Select-Object -First 1
if ($existing) {
    $Ref = $existing.id
    Write-Host "Projeto $Name ja existe ($Ref)."
} else {
    Write-Host "Criando projeto $Name (plano gratuito, $Region)..."
    $created = Invoke-Supabase projects create $Name --org-id $OrgId --region $Region --db-password $DbPassword -o json | Out-String | ConvertFrom-Json
    $Ref = $created.id
}
if (-not $Ref -or $Ref -eq $ProdRef) { throw "Ref de staging invalido: '$Ref'" }
Set-Content $RefFile $Ref -Encoding ascii

# 3. Espera ficar pronto (ate ~10 min)
Write-Host "Aguardando o projeto ficar pronto..."
for ($i = 0; $i -lt 60; $i++) {
    $p = (Invoke-Supabase projects list -o json | Out-String | ConvertFrom-Json).projects | Where-Object { $_.id -eq $Ref }
    if ($p.status -eq "ACTIVE_HEALTHY") { break }
    Start-Sleep -Seconds 10
}
if ($p.status -ne "ACTIVE_HEALTHY") { throw "Projeto nao ficou pronto a tempo (status: $($p.status)). Rode o script de novo em alguns minutos." }

# 4. Migrations + Edge Function (link vale so para a pasta $Repo; C:\FILAMAP continua em producao)
Push-Location $Repo
try {
    $env:SUPABASE_DB_PASSWORD = $DbPassword
    Invoke-Supabase link --project-ref $Ref | Out-Null
    $linked = (Get-Content (Join-Path $Repo "supabase\.temp\project-ref") -Raw).Trim()
    if ($linked -ne $Ref) { throw "Link apontou para '$linked', esperado '$Ref'. Abortado antes de aplicar migrations." }
    Write-Host "Aplicando migrations no staging..."
    Invoke-Supabase db push --linked --include-all | Out-Null
    Write-Host "Publicando Edge Function agent-pair no staging..."
    Invoke-Supabase functions deploy agent-pair --project-ref $Ref --no-verify-jwt --use-api | Out-Null
} finally {
    Remove-Item Env:SUPABASE_DB_PASSWORD -ErrorAction SilentlyContinue
    Pop-Location
}

# 5. Chaves de API (guardadas com DPAPI, nunca impressas)
$keys = Invoke-Supabase projects api-keys --project-ref $Ref -o json | Out-String | ConvertFrom-Json
# Projetos novos podem vir so com chaves no formato novo (sb_publishable_/sb_secret_).
$anon = ($keys | Where-Object { $_.name -eq "anon" } | Select-Object -First 1).api_key
if (-not $anon) { $anon = ($keys | Where-Object { "$($_.api_key)" -like "sb_publishable_*" } | Select-Object -First 1).api_key }
$service = ($keys | Where-Object { $_.name -eq "service_role" } | Select-Object -First 1).api_key
if (-not $service) { $service = ($keys | Where-Object { "$($_.api_key)" -like "sb_secret_*" } | Select-Object -First 1).api_key }
if (-not $anon -or -not $service) { throw "Nao foi possivel obter as chaves do staging." }
Protect-ToFile (@{ url = "https://$Ref.supabase.co"; anon = $anon; service_role = $service } | ConvertTo-Json -Compress) $KeyFile

# 6. Teste ponta a ponta do pareamento
Write-Host "`nRodando teste ponta a ponta do pareamento no staging..."
$env:SUPABASE_URL = "https://$Ref.supabase.co"
$env:SUPABASE_ANON_KEY = $anon
$env:SUPABASE_SERVICE_ROLE_KEY = $service
try {
    Push-Location (Join-Path $Repo "desktop-agent")
    node scripts\pairing-e2e.mjs
    $e2e = $LASTEXITCODE
} finally {
    Pop-Location
    Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY, Env:SUPABASE_ANON_KEY, Env:SUPABASE_URL -ErrorAction SilentlyContinue
}

Write-Host ""
if ($e2e -eq 0) { Write-Host "STAGING OK ($Ref). Pareamento aprovado ponta a ponta." }
else { Write-Host "STAGING criado ($Ref), mas o teste de pareamento FALHOU. Mande a saida acima para o Claude." }
