$ErrorActionPreference = 'Stop'

$projectDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $projectDirectory

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  $bundledNode = 'C:\Users\ryan.ap\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin'
  $bundledTools = 'C:\Users\ryan.ap\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback'
  if (Test-Path -LiteralPath "$bundledNode\node.exe") {
    $env:Path = "$bundledNode;$bundledTools;$env:Path"
  }
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'O Node.js não foi encontrado nesta máquina.'
}

function ConvertFrom-SecureValue {
  param([Parameter(Mandatory = $true)][Security.SecureString]$Value)

  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

Write-Host ''
Write-Host 'Redefinição da senha do administrador' -ForegroundColor Cyan
Write-Host 'A senha digitada ficará oculta.' -ForegroundColor DarkGray
Write-Host ''

$queryOutput = & npx.cmd wrangler d1 execute site-creator-d1 --local --command="SELECT id, username FROM accounts WHERE role = 'admin' LIMIT 1" --persist-to=.wrangler/state --json
if ($LASTEXITCODE -ne 0) {
  throw 'Não foi possível consultar o banco de dados local.'
}

$queryResult = ($queryOutput -join [Environment]::NewLine) | ConvertFrom-Json
$administrator = $queryResult[0].results | Select-Object -First 1
if (-not $administrator) {
  Write-Host 'Ainda não existe um administrador cadastrado.' -ForegroundColor Yellow
  Write-Host 'Abra o sistema e use a tela de primeiro acesso para criar o administrador.' -ForegroundColor Yellow
  exit 1
}

Write-Host "Usuário: $($administrator.username)" -ForegroundColor White
$firstSecure = Read-Host 'Digite a nova senha (mínimo de 8 caracteres)' -AsSecureString
$secondSecure = Read-Host 'Digite novamente para confirmar' -AsSecureString
$firstPassword = ConvertFrom-SecureValue -Value $firstSecure
$secondPassword = ConvertFrom-SecureValue -Value $secondSecure

try {
  if ($firstPassword.Length -lt 8) {
    throw 'A senha precisa ter pelo menos 8 caracteres.'
  }
  if ($firstPassword -cne $secondPassword) {
    throw 'As senhas digitadas não são iguais.'
  }

  $saltBytes = New-Object byte[] 16
  $random = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $random.GetBytes($saltBytes)
  }
  finally {
    $random.Dispose()
  }

  $deriver = [Security.Cryptography.Rfc2898DeriveBytes]::new(
    $firstPassword,
    $saltBytes,
    210000,
    [Security.Cryptography.HashAlgorithmName]::SHA256
  )
  try {
    $hashBytes = $deriver.GetBytes(32)
  }
  finally {
    $deriver.Dispose()
  }

  $passwordHash = [Convert]::ToBase64String($hashBytes)
  $passwordSalt = [Convert]::ToBase64String($saltBytes)
  $administratorId = ([string]$administrator.id).Replace("'", "''")
  $sql = "UPDATE accounts SET password_hash = '$passwordHash', password_salt = '$passwordSalt' WHERE id = '$administratorId' AND role = 'admin'; DELETE FROM sessions WHERE user_id = '$administratorId';"

  $updateOutput = & npx.cmd wrangler d1 execute site-creator-d1 --local --command=$sql --persist-to=.wrangler/state --json
  if ($LASTEXITCODE -ne 0) {
    throw 'Não foi possível atualizar a senha no banco de dados local.'
  }

  $updateResult = ($updateOutput -join [Environment]::NewLine) | ConvertFrom-Json
  if (-not $updateResult[0].success) {
    throw 'O banco de dados não confirmou a atualização da senha.'
  }

  Write-Host ''
  Write-Host 'Senha redefinida com sucesso.' -ForegroundColor Green
  Write-Host 'As sessões antigas do administrador foram encerradas.' -ForegroundColor Green
}
finally {
  $firstPassword = $null
  $secondPassword = $null
  $firstSecure = $null
  $secondSecure = $null
  $hashBytes = $null
}
