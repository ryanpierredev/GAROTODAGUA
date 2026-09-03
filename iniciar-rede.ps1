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

$addresses = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
  Select-Object -ExpandProperty IPAddress -Unique

Write-Host ''
Write-Host 'Cota D''Água disponível nesta máquina em:' -ForegroundColor Cyan
Write-Host '  http://localhost:3000' -ForegroundColor White
foreach ($address in $addresses) {
  Write-Host "  http://${address}:3000" -ForegroundColor Green
}
Write-Host ''
Write-Host 'Mantenha esta janela aberta enquanto as pessoas estiverem usando o sistema.' -ForegroundColor Yellow
Write-Host ''

npm run rede
