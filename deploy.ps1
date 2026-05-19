# deploy.ps1 — copia o módulo para o diretório de módulos do Zabbix
# Ajuste $ZabbixModulesPath conforme seu ambiente

param(
    [string]$ZabbixModulesPath = "/usr/share/zabbix/modules"
)

$ModuleSrc = Join-Path $PSScriptRoot "topology-widget"
$ModuleDst = "$ZabbixModulesPath/topology"

Write-Host "Copiando modulo para: $ModuleDst"

# Se estiver no Windows e o Zabbix estiver em Linux (WSL ou SSH), adapte este bloco.
# Para deploy local (Zabbix no mesmo host):
if (Test-Path $ZabbixModulesPath) {
    if (Test-Path $ModuleDst) {
        Remove-Item -Recurse -Force $ModuleDst
    }
    Copy-Item -Recurse $ModuleSrc $ModuleDst

    # Garante permissão de escrita no diretório data/
    $dataDir = "$ModuleDst/data"
    if (-not (Test-Path $dataDir)) {
        New-Item -ItemType Directory $dataDir | Out-Null
    }

    Write-Host "Deploy concluido. Acesse Administration > General > Modules no Zabbix e ative 'Network Topology'."
} else {
    Write-Host "Diretorio de modulos nao encontrado: $ZabbixModulesPath"
    Write-Host "Use: scp -r topology-widget user@zabbix-server:$ZabbixModulesPath/topology"
}
