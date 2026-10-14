param(
    [string]$Mensagem
)

$ErrorActionPreference = 'Stop'

function Executar-Git {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Argumentos)

    & git @Argumentos
    if ($LASTEXITCODE -ne 0) {
        throw "O comando Git falhou: git $($Argumentos -join ' ')"
    }
}

try {
    $PastaProjeto = Split-Path -Parent $MyInvocation.MyCommand.Path
    $ChaveSSH = Join-Path $env:USERPROFILE '.ssh\garotodagua_deploy'
    $Repositorio = 'git@github.com:ryanpierredev/GAROTODAGUA.git'

    Set-Location -LiteralPath $PastaProjeto

    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        throw 'O Git não está instalado ou não foi encontrado no PATH.'
    }

    if (-not (Test-Path -LiteralPath $ChaveSSH -PathType Leaf)) {
        throw "A chave privada não foi encontrada em: $ChaveSSH"
    }

    $CaminhoChave = $ChaveSSH.Replace('\', '/')
    $ComandoSSH = "ssh -i `"$CaminhoChave`" -o IdentitiesOnly=yes"

    Executar-Git config --local core.sshCommand $ComandoSSH

    $RemotoAtual = & git remote get-url origin 2>$null
    if ($LASTEXITCODE -ne 0) {
        Executar-Git remote add origin $Repositorio
    }
    elseif ($RemotoAtual.Trim() -ne $Repositorio) {
        Executar-Git remote set-url origin $Repositorio
    }

    Write-Host ''
    Write-Host 'Preparando os arquivos do projeto...' -ForegroundColor Cyan
    Executar-Git add -A -- . ':(exclude)*.zip' ':(glob,exclude)**/*.zip'

    & git diff --cached --quiet
    $TemAlteracoes = $LASTEXITCODE -ne 0

    if ($TemAlteracoes) {
        if ([string]::IsNullOrWhiteSpace($Mensagem)) {
            $Mensagem = Read-Host 'Digite uma mensagem para esta atualização'
        }

        if ([string]::IsNullOrWhiteSpace($Mensagem)) {
            $Mensagem = "Atualização do projeto em $(Get-Date -Format 'dd/MM/yyyy HH:mm')"
        }

        Executar-Git commit -m $Mensagem
    }
    else {
        Write-Host 'Não existem alterações novas para criar um commit.' -ForegroundColor Yellow
    }

    Write-Host ''
    Write-Host 'Enviando para o GitHub...' -ForegroundColor Cyan
    Executar-Git push -u origin main

    Write-Host ''
    Write-Host 'Projeto enviado com sucesso!' -ForegroundColor Green
    Write-Host 'https://github.com/ryanpierredev/GAROTODAGUA' -ForegroundColor Green
}
catch {
    Write-Host ''
    Write-Host "ERRO: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

