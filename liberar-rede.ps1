$ErrorActionPreference = 'Stop'
$ruleName = "Cota D'Agua - Rede Local"
$existingRule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue

if ($existingRule) {
  $existingRule | Set-NetFirewallRule -Enabled True -Direction Inbound -Action Allow -Profile Private,Domain
} else {
  New-NetFirewallRule `
    -DisplayName $ruleName `
    -Description "Permite acesso ao Cota D'Agua somente pela rede local privada." `
    -Direction Inbound `
    -Action Allow `
    -Protocol TCP `
    -LocalPort 3000 `
    -Profile Private,Domain `
    -RemoteAddress LocalSubnet | Out-Null
}

Write-Host ''
Write-Host 'Acesso pela rede local liberado com sucesso.' -ForegroundColor Green
Read-Host 'Pressione Enter para fechar'
