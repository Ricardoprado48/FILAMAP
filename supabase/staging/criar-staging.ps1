# Filamap - cria/atualiza o ambiente de STAGING (projeto Supabase separado, plano gratuito)
# e roda o teste ponta a ponta do pareamento de computador.
#
# Executar em PowerShell normal:
#   powershell -ExecutionPolicy Bypass -File C:\FILAMAP-device-pairing\supabase\staging\criar-staging.ps1
#
# - Projeto "filamap-staging" numa CONTA Supabase separada (o plano gratuito limita 2 projetos
#   ativos por conta, e a conta do Filamap ja tem 2). Regiao sa-east-1. Custo zero; pausa
#   sozinho apos 7 dias sem uso.
# - Na primeira vez pede o Access Token da conta de staging (supabase.com > Account >
#   Access Tokens) com a digitacao oculta. O login do CLI desta maquina NAO muda: continua
#   apontando para a conta de producao.
# - Senha do banco e chaves ficam em %APPDATA%\Filamap-dev, criptografadas com DPAPI
#   (so este usuario do Windows consegue ler). Nada e impresso na tela.
# - Rodar de novo e seguro: reaproveita o projeto e reaplica o que faltar.
$ErrorActionPreference = "Stop"

$Repo    = "C:\FILAMAP-device-pairing"
$Name    = "filamap-staging"
$Region  = "sa-east-1"
$ProdRef = "gqtlszffgvxsqcmefhyd"
$DevDir  = Join-Path $env:APPDATA "Filamap-dev"
$PwFile  = Join-Path $DevDir "staging-db-password.dpapi"
$RefFile = Join-Path $DevDir "staging-ref.txt"
$KeyFile = Join-Path $DevDir "staging-keys.dpapi"
$TokFile = Join-Path $DevDir "staging-access-token.dpapi"

function Protect-ToFile([string]$Plain, [string]$Path) {
    $Plain | ConvertTo-SecureString -AsPlainText -Force | ConvertFrom-SecureString | Set-Content $Path -Encoding ascii
}
function Unprotect-FromFile([string]$Path) {
    $sec = (Get-Content $Path -Raw).Trim() | ConvertTo-SecureString
    return [System.Net.NetworkCredential]::new("", $sec).Password
}
function Hide-Secret([string]$Text) {
    if ($script:DbPassword) { $Text = $Text.Replace($script:DbPassword, "********") }
    if ($env:SUPABASE_ACCESS_TOKEN) { $Text = $Text.Replace($env:SUPABASE_ACCESS_TOKEN, "********") }
    return $Text
}
function Invoke-Supabase {
    # O CLI escreve avisos de versao no stderr; em caso de erro mostra o motivo
    # real, sempre com a senha mascarada.
    $errFile = [System.IO.Path]::GetTempFileName()
    $prev = $ErrorActionPreference; $ErrorActionPreference = "Continue"
    $out = & supabase @args 2>$errFile
    $code = $LASTEXITCODE
    $ErrorActionPreference = $prev
    $err = Get-Content $errFile -ErrorAction SilentlyContinue | Where-Object { $_ -notmatch 'new version|recommend updating|getting-started#updating' }
    Remove-Item $errFile -ErrorAction SilentlyContinue
    if ($code -ne 0) {
        $motivo = Hide-Secret (($err + $out) -join [Environment]::NewLine)
        throw (Hide-Secret "supabase $($args -join ' ') falhou (codigo $code):") + [Environment]::NewLine + $motivo
    }
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

# 1b. Conta de staging: token so deste processo (o login salvo do CLI fica intacto)
if (-not (Test-Path $TokFile)) {
    Write-Host "Cole o Access Token da conta Supabase de STAGING (supabase.com > Account > Access Tokens)."
    Write-Host "A digitacao fica oculta. Ele sera guardado criptografado so para este usuario do Windows."
    $secTok = Read-Host "Access Token" -AsSecureString
    $plainTok = [System.Net.NetworkCredential]::new("", $secTok).Password.Trim()
    if ($plainTok -notmatch '^sbp_') { throw "Isso nao parece um Access Token do Supabase (comeca com sbp_)." }
    Protect-ToFile $plainTok $TokFile
}
$env:SUPABASE_ACCESS_TOKEN = Unprotect-FromFile $TokFile

# Trava de seguranca: esta conta NAO pode enxergar o projeto de producao.
$projects = (Invoke-Supabase projects list -o json | Out-String | ConvertFrom-Json).projects
if ($projects | Where-Object { $_.id -eq $ProdRef }) {
    throw "O token informado e da conta de PRODUCAO. Use o token da conta nova de staging (apague $TokFile e rode de novo)."
}
$orgs = @((Invoke-Supabase orgs list -o json | Out-String | ConvertFrom-Json).organizations)
if ($orgs.Count -ne 1) { throw "A conta de staging deve ter exatamente 1 organizacao (tem $($orgs.Count))." }
$OrgId = $orgs[0].id
Write-Host "Conta de staging OK (organizacao $($orgs[0].name))."

# 2. Projeto (cria so se ainda nao existe)
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
