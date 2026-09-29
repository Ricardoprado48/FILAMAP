param([switch]$Remover)
# Parametro desconhecido NUNCA cai no modo padrao (incidente 2026-09-29).
if ($args.Count -gt 0) { throw "Parametro nao reconhecido: $($args -join ' '). Nada foi feito." }
# Instalacao limpa: cria (ou remove) o usuario local do Windows "FilamapTeste".
# Um usuario novo nao tem nada do Filamap nem do Bambu Studio: e o PC de um tester.
# Ele e ADMINISTRADOR de proposito: o instalador pede elevacao, e num usuario comum o
# Windows pediria a senha do SEU usuario e instalaria o inicio automatico no seu nome.
# Rode num PowerShell aberto como Administrador.
#   (sem parametro)  cria o usuario (pede uma senha para ele)
#   -Remover         apaga o usuario e a pasta dele (C:\Users\FilamapTeste)
$ErrorActionPreference = "Stop"
$Nome = "FilamapTeste"

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { Write-Host "Abra o PowerShell como Administrador (botao direito > Executar como administrador) e rode de novo. Nada foi feito." -ForegroundColor Red; exit 1 }
if ($env:USERNAME -eq $Nome) { Write-Host "Rode a partir do SEU usuario, nao do $Nome. Nada foi feito." -ForegroundColor Red; exit 1 }

$existe = Get-LocalUser -Name $Nome -ErrorAction SilentlyContinue
# Grupo Administradores pelo SID (o nome muda com o idioma do Windows).
$grupoAdmin = (Get-LocalGroup -SID "S-1-5-32-544").Name

if ($Remover) {
    if (-not $existe) { Write-Host "Usuario $Nome nao existe. Nada a remover."; exit 0 }
    $logado = @(Get-CimInstance Win32_Process -Filter "Name='explorer.exe'" | ForEach-Object { (Invoke-CimMethod -InputObject $_ -MethodName GetOwner).User }) -contains $Nome
    if ($logado) { Write-Host "O usuario $Nome ainda esta conectado. Saia dele (Iniciar > $Nome > Sair) e rode de novo. Nada foi feito." -ForegroundColor Red; exit 1 }
    $resp = Read-Host "Digite REMOVER para apagar o usuario $Nome e a pasta dele (qualquer outra coisa cancela)"
    if ($resp -cne "REMOVER") { Write-Host "Cancelado. Nada foi feito."; exit 0 }
    $sid = $existe.SID.Value
    Remove-LocalUser -Name $Nome
    $perfil = Get-CimInstance Win32_UserProfile | Where-Object { $_.SID -eq $sid }
    if ($perfil) { Remove-CimInstance -InputObject $perfil }
    Write-Host "Usuario $Nome e pasta removidos." -ForegroundColor Green
    exit 0
}

if ($existe) { Write-Host "Usuario $Nome ja existe. Pode usar (ou rode com -Remover para comecar do zero)."; exit 0 }
Write-Host "Vai criar o usuario local $Nome (administrador) para o teste de instalacao limpa."
$senha = Read-Host "Escolha uma senha para o $Nome" -AsSecureString
if ($senha.Length -lt 4) { Write-Host "Senha muito curta. Nada foi feito." -ForegroundColor Red; exit 1 }
$resp = Read-Host "Digite CRIAR para continuar (qualquer outra coisa cancela)"
if ($resp -cne "CRIAR") { Write-Host "Cancelado. Nada foi feito."; exit 0 }
New-LocalUser -Name $Nome -Password $senha -FullName "Filamap Teste" -Description "Teste de instalacao limpa do Filamap" -PasswordNeverExpires | Out-Null
Add-LocalGroupMember -Group $grupoAdmin -Member $Nome
Write-Host "Usuario $Nome criado (administrador)." -ForegroundColor Green
