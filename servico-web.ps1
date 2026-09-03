param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Start', 'Stop', 'Restart')]
  [string]$Action
)

$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$serviceStatePath = Join-Path $projectDirectory '.cota-dagua-service.pid'
$serviceLogPath = Join-Path $projectDirectory '.cota-dagua-service.log'
$serviceErrorLogPath = Join-Path $projectDirectory '.cota-dagua-service-error.log'
$vinextCliPath = Join-Path $projectDirectory 'node_modules\vinext\dist\cli.js'
$normalizedProjectPath = $projectDirectory.ToLowerInvariant()

function Initialize-NodePath {
  if (Get-Command node -ErrorAction SilentlyContinue) { return }

  $bundledNode = 'C:\Users\ryan.ap\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin'
  $bundledTools = 'C:\Users\ryan.ap\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback'
  if (Test-Path -LiteralPath "$bundledNode\node.exe") {
    $env:Path = "$bundledNode;$bundledTools;$env:Path"
  }
}

function Get-VerifiedServiceProcess {
  param([int]$ProcessIdentifier)

  if ($ProcessIdentifier -le 0) { return $null }
  $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessIdentifier" -ErrorAction SilentlyContinue
  if (-not $processInfo) { return $null }
  $commandLine = ([string]$processInfo.CommandLine).ToLowerInvariant()
  if ($commandLine.Contains($normalizedProjectPath) -and $commandLine.Contains('vinext') -and $commandLine.Contains('0.0.0.0')) {
    return $processInfo
  }
  return $null
}

function Find-ServiceProcess {
  if (Test-Path -LiteralPath $serviceStatePath) {
    $savedValue = (Get-Content -LiteralPath $serviceStatePath -Raw -ErrorAction SilentlyContinue).Trim()
    $savedProcessId = 0
    if ([int]::TryParse($savedValue, [ref]$savedProcessId)) {
      $savedProcess = Get-VerifiedServiceProcess -ProcessIdentifier $savedProcessId
      if ($savedProcess) { return $savedProcess }
    }
    Remove-Item -LiteralPath $serviceStatePath -Force -ErrorAction SilentlyContinue
  }

  $listener = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) {
    return Get-VerifiedServiceProcess -ProcessIdentifier $listener.OwningProcess
  }
  return $null
}

function Stop-CotaService {
  $serviceProcess = Find-ServiceProcess
  if (-not $serviceProcess) {
    $occupiedPort = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($occupiedPort) {
      throw 'A porta 3000 esta sendo usada por outro programa. Ele nao foi encerrado.'
    }
    Remove-Item -LiteralPath $serviceStatePath -Force -ErrorAction SilentlyContinue
    Write-Host 'O servico Cota D''Agua ja esta parado.' -ForegroundColor Yellow
    return
  }

  $serviceProcessId = [int]$serviceProcess.ProcessId
  & taskkill.exe /PID $serviceProcessId /T /F | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw 'Nao foi possivel encerrar o servico web.'
  }

  $limit = [DateTime]::UtcNow.AddSeconds(15)
  while ((Get-Process -Id $serviceProcessId -ErrorAction SilentlyContinue) -and [DateTime]::UtcNow -lt $limit) {
    Start-Sleep -Milliseconds 250
  }
  Remove-Item -LiteralPath $serviceStatePath -Force -ErrorAction SilentlyContinue
  Write-Host 'Servico Cota D''Agua parado.' -ForegroundColor Green
}

function Start-CotaService {
  $runningProcess = Find-ServiceProcess
  if ($runningProcess) {
    Set-Content -LiteralPath $serviceStatePath -Value $runningProcess.ProcessId
    Write-Host "O servico ja esta em execucao (processo $($runningProcess.ProcessId))." -ForegroundColor Yellow
    Show-ServiceAddresses
    return
  }

  $occupiedPort = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($occupiedPort) {
    throw 'A porta 3000 esta sendo usada por outro programa. O servico nao foi iniciado.'
  }

  Initialize-NodePath
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if (-not $nodeCommand) { throw 'O Node.js nao foi encontrado nesta maquina.' }
  if (-not (Test-Path -LiteralPath $vinextCliPath)) {
    throw 'As dependencias do aplicativo nao foram encontradas.'
  }

  $startedProcess = Start-Process `
    -FilePath $nodeCommand.Source `
    -ArgumentList @("`"$vinextCliPath`"", 'dev', '--hostname', '0.0.0.0') `
    -WorkingDirectory $projectDirectory `
    -WindowStyle Hidden `
    -RedirectStandardOutput $serviceLogPath `
    -RedirectStandardError $serviceErrorLogPath `
    -PassThru

  Set-Content -LiteralPath $serviceStatePath -Value $startedProcess.Id
  $limit = [DateTime]::UtcNow.AddSeconds(30)
  do {
    if ($startedProcess.HasExited) {
      $details = if (Test-Path -LiteralPath $serviceErrorLogPath) {
        (Get-Content -LiteralPath $serviceErrorLogPath -Tail 8 -ErrorAction SilentlyContinue) -join [Environment]::NewLine
      } else { '' }
      Remove-Item -LiteralPath $serviceStatePath -Force -ErrorAction SilentlyContinue
      throw "O servico encerrou durante a inicializacao. $details"
    }
    $listener = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener) { break }
    Start-Sleep -Milliseconds 500
  } while ([DateTime]::UtcNow -lt $limit)

  if (-not $listener) {
    & taskkill.exe /PID $startedProcess.Id /T /F | Out-Null
    Remove-Item -LiteralPath $serviceStatePath -Force -ErrorAction SilentlyContinue
    throw 'O servico nao respondeu na porta 3000 dentro do tempo esperado.'
  }

  $verifiedProcess = Get-VerifiedServiceProcess -ProcessIdentifier $listener.OwningProcess
  if (-not $verifiedProcess) {
    & taskkill.exe /PID $startedProcess.Id /T /F | Out-Null
    Remove-Item -LiteralPath $serviceStatePath -Force -ErrorAction SilentlyContinue
    throw 'O processo iniciado nao pode ser confirmado.'
  }
  Set-Content -LiteralPath $serviceStatePath -Value $verifiedProcess.ProcessId
  Write-Host 'Servico Cota D''Agua iniciado em segundo plano.' -ForegroundColor Green
  Show-ServiceAddresses
}

function Show-ServiceAddresses {
  $addresses = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
    Select-Object -ExpandProperty IPAddress -Unique

  Write-Host ''
  Write-Host 'Enderecos para acessar:' -ForegroundColor Cyan
  Write-Host '  http://localhost:3000' -ForegroundColor White
  foreach ($address in $addresses) {
    Write-Host "  http://${address}:3000" -ForegroundColor Cyan
  }
  Write-Host ''
}

Set-Location -LiteralPath $projectDirectory
switch ($Action) {
  'Start' { Start-CotaService }
  'Stop' { Stop-CotaService }
  'Restart' {
    Stop-CotaService
    Start-CotaService
  }
}
