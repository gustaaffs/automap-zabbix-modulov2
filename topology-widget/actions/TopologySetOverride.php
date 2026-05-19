<?php

namespace Modules\Topology\Actions;

use CController;
use CControllerResponseData;

// Mapeia um nome de vizinho CDP/LLDP não resolvido para um hostid do Zabbix
class TopologySetOverride extends CController {

    protected function init(): void {
        $this->disableSIDvalidation();
    }

    protected function checkInput(): bool {
        $fields = [
            'neighbor_name' => 'required|string|not_empty',
            'hostid'        => 'required|string|not_empty'
        ];
        return $this->validateInput($fields);
    }

    protected function checkPermissions(): bool {
        return $this->checkAccess(CRoleHelper::UI_MONITORING_HOSTS);
    }

    protected function doAction(): void {
        $neighbor_name = $this->getInput('neighbor_name');
        $hostid        = $this->getInput('hostid');

        $path      = __DIR__ . '/../data/name_overrides.json';
        $overrides = [];
        if (file_exists($path)) {
            $overrides = json_decode(file_get_contents($path), true) ?? [];
        }

        $overrides[$neighbor_name] = $hostid;
        file_put_contents($path, json_encode($overrides, JSON_PRETTY_PRINT));

        $this->setResponse(new CControllerResponseData([
            'body' => json_encode(['status' => 'ok'])
        ]));
    }
}
