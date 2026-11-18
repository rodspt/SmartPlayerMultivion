<#
.SYNOPSIS
  Empacota, assina, instala e abre o app numa TV Samsung (Tizen).

.EXAMPLE
  .\tools\install-tv.ps1 -Device 192.168.0.194:26101
  .\tools\install-tv.ps1 -Device 192.168.0.194              # porta 26101 por padrao
  .\tools\install-tv.ps1 -Device 192.168.0.194 -Profile SmartPro -NoRun
  .\tools\install-tv.cmd -Device 192.168.0.194:26101
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [Alias("Devide", "Ip", "Tv")]
    [string]$Device,

    # Perfil de assinatura (vazio = perfil ativo do Tizen)
    [Alias("Profile")]
    [string]$SignProfile = "",

    # Apenas instala, sem abrir o app
    [switch]$NoRun,

    # Pasta das ferramentas Tizen (padrao: extensao Tizen do VS Code)
    [string]$ToolsDir = "$env:USERPROFILE\.tizen-extension-platform\server\sdktools\data\tools"
)

# Erros de comandos nativos sao tratados pelo codigo de saida
$ErrorActionPreference = "Continue"

function Write-Step([string]$msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Fail([string]$msg) { Write-Host "ERRO: $msg" -ForegroundColor Red; exit 1 }

# --- Caminhos -------------------------------------------------------------
$projDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$sdb = Join-Path $ToolsDir "sdb.exe"
$tz  = Join-Path $ToolsDir "tizen-core\tz.exe"

# Tizen Studio classico como alternativa
if (-not (Test-Path $sdb) -and (Test-Path "C:\tizen-studio\tools\sdb.exe")) {
    $sdb = "C:\tizen-studio\tools\sdb.exe"
}
if (-not (Test-Path $sdb)) { Fail "sdb.exe nao encontrado em $ToolsDir. Instale a extensao Tizen do VS Code ou informe -ToolsDir." }
if (-not (Test-Path $tz))  { Fail "tz.exe nao encontrado em $ToolsDir\tizen-core. Instale a extensao Tizen do VS Code ou informe -ToolsDir." }

if ($Device -notmatch ":\d+$") { $Device = "${Device}:26101" }

Write-Host "Projeto : $projDir"
Write-Host "TV      : $Device"

# --- 1. Conectar ----------------------------------------------------------
Write-Step "Conectando na TV"
& $sdb connect $Device | Out-Host
$devices = (& $sdb devices) -join "`n"
$line = ($devices -split "`n") | Where-Object { $_ -match [regex]::Escape($Device) }
if (-not $line -or $line -notmatch "\bdevice\b") {
    Write-Host $devices
    Fail "TV $Device nao esta conectada. Verifique: Developer Mode ligado, IP do PC configurado na TV, mesma rede."
}
Write-Host "Conectado: $($line.Trim())" -ForegroundColor Green

# --- 2. Build -------------------------------------------------------------
Write-Step "Build"
& $tz build -w $projDir
if ($LASTEXITCODE -ne 0) { Fail "tz build falhou (codigo $LASTEXITCODE)." }

# --- 3. Pack (assinatura) -------------------------------------------------
Write-Step "Empacotando e assinando"
$packStart = Get-Date
if ($SignProfile) {
    & $tz security-profiles set-active $SignProfile
    if ($LASTEXITCODE -ne 0) { Fail "Perfil de assinatura '$SignProfile' nao encontrado. Use: tz security-profiles list" }
}
# A pasta Debug\projects pode estar travada por um momento (ex.: extensao Tizen
# do VS Code indexando). Tenta algumas vezes antes de desistir.
$packOk = $false
for ($try = 1; $try -le 4 -and -not $packOk; $try++) {
    if ($try -gt 1) {
        Write-Host "Pasta de saida em uso, tentando novamente ($try/4)..." -ForegroundColor Yellow
        Start-Sleep -Seconds 3
        & $tz build -w $projDir | Out-Null
    }
    & $tz pack -w $projDir
    $packOk = ($LASTEXITCODE -eq 0)
}
if (-not $packOk) { Fail "tz pack falhou. Feche o VS Code/Explorer na pasta Debug ou verifique o perfil de assinatura." }

$wgt = Get-ChildItem -Path (Join-Path $projDir "Debug") -Filter *.wgt -ErrorAction SilentlyContinue |
       Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $wgt) { Fail "Nenhum .wgt gerado em $projDir\Debug." }
if ($wgt.LastWriteTime -lt $packStart.AddSeconds(-5)) { Fail "O .wgt em Debug nao foi atualizado pelo pack." }
Write-Host ("Pacote: {0} ({1:N1} MB)" -f $wgt.FullName, ($wgt.Length / 1MB)) -ForegroundColor Green

# --- 4. Instalar ----------------------------------------------------------
Write-Step "Instalando na TV"
# "$_" converte o stderr em texto (evita o bloco vermelho NativeCommandError do PowerShell 5.1)
$out = @(& $tz install -w $projDir -p $wgt.FullName -e $Device 2>&1 | ForEach-Object { "$_" })
$tzExit = $LASTEXITCODE
$out | Where-Object { $_ -notmatch "installing\[\d+\]|pushed .*%" } | Out-Host
$outText = $out -join "`n"

# So "install completed" confirma a instalacao. "cmd_ret:0" NAO basta: a TV
# responde cmd_ret:0 mesmo quando recusa o pacote (ex.: "download failed[116]").
# O tz faz uma verificacao extra depois (pkgcmd -l via sdb) que pode falhar se a
# conexao com a TV oscilar, mesmo com o app ja instalado.
$failLine = ($out | Where-Object { $_ -match "\] (install|download|uninstall) failed\[|install failed" } | Select-Object -First 1)
if ($failLine -or $outText -notmatch "install completed") {
    if ($failLine) { Write-Host "A TV respondeu: $($failLine.Trim())" -ForegroundColor Red }
    Fail ("Instalacao falhou. Verifique: conexao com a TV; certificado do perfil de assinatura incluindo o DUID desta TV; " +
          "arquivos indevidos no pacote (veja 'excludes' em tizen_web_project.yaml).")
}
if ($tzExit -ne 0) {
    Write-Host "Aviso: a TV confirmou a instalacao, mas a verificacao final do tz falhou (conexao oscilando?). Seguindo." -ForegroundColor Yellow
}
Write-Host "Instalado com sucesso." -ForegroundColor Green

# --- 5. Abrir -------------------------------------------------------------
if (-not $NoRun) {
    Write-Step "Abrindo o app"
    & $sdb connect $Device | Out-Null
    $runOut = @(& $tz run -w $projDir -e $Device 2>&1 | ForEach-Object { "$_" })
    $runOut | Out-Host
    if ($LASTEXITCODE -ne 0 -and ($runOut -join "`n") -notmatch "successfully launched") {
        Write-Host "Aviso: nao foi possivel abrir o app automaticamente. Abra-o pelo menu da TV." -ForegroundColor Yellow
    }
}

Write-Host "`nConcluido: app instalado em $Device." -ForegroundColor Green
