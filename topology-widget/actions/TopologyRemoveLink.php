<?php

namespace Modules\Topology\Actions;

use CController;
use CControllerResponseData;

class TopologyRemoveLink extends CController {

    protected function init(): void {
        $this->disableSIDvalidation();
    }

    protected function checkInput(): bool {
        $fields = [
            'from' => 'required|string|not_empty',
            'to'   => 'required|string|not_empty'
        ];
        return $this->validateInput($fields);
    }

    protected function checkPermissions(): bool {
        return $this->checkAccess(CRoleHelper::UI_MONITORING_HOSTS);
    }

    protected function doAction(): void {
        $from = $this->getInput('from');
        $to   = $this->getInput('to');
        $key  = min($from, $to) . '_' . max($from, $to);

        $path  = __DIR__ . '/../data/manual_links.json';
        $links = [];
        if (file_exists($path)) {
            $links = json_decode(file_get_contents($path), true) ?? [];
        }

        $links = array_values(array_filter($links, function ($link) use ($key) {
            $existing = min($link['from'], $link['to']) . '_' . max($link['from'], $link['to']);
            return $existing !== $key;
        }));

        file_put_contents($path, json_encode($links, JSON_PRETTY_PRINT));

        $this->setResponse(new CControllerResponseData([
            'body' => json_encode(['status' => 'ok'])
        ]));
    }
}
