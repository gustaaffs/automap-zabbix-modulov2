<?php

namespace Modules\Topology;

use Zabbix\Core\CModule;

class Module extends CModule {

    public function init(): void {
        // Assets (JS/CSS) são carregados automaticamente pelo widget framework
        // quando o widget está presente no dashboard
    }
}
