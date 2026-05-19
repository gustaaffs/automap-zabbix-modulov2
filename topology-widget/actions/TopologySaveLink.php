<?php

namespace Modules\Topology\Actions;

use CController;
use CControllerResponseData;

class TopologySaveLink extends CController {

    protected function init(): void {
        $this->disableSIDvalidation();
    }

    protected function checkInput(): bool {
        $fields = [
            'from'  => 'required|string|not_empty',
            'to'    => 'required|string|not_empty',
            'label' => 'string'
        ];
        return $this->validateInput($fields);
    }

    protected function checkPermissions(): bool {
        return $this->checkAccess(CRoleHelper::UI_MONITORING_HOSTS);
    }

    protected function doAction(): void {
        $from  = $this->getInput('from');
        $to    = $this->getInput('to');
        $label = $this->getInput('label', '');

        if ($from === $to) {
            $this->setJsonResponse(['status' => 'error', 'message' => 'Origem e destino iguais.']);
            return;
        }

        $path  = __DIR__ . '/../data/manual_links.json';
        $links = $this->readJson($path);

        $key = min($from, $to) . '_' . max($from, $to);
        foreach ($links as $link) {
            $existing = min($link['from'], $link['to']) . '_' . max($link['from'], $link['to']);
            if ($existing === $key) {
                $this->setJsonResponse(['status' => 'exists']);
                return;
            }
        }

        $links[] = ['from' => $from, 'to' => $to, 'label' => $label];
        $this->writeJson($path, $links);
        $this->setJsonResponse(['status' => 'ok']);
    }

    private function readJson(string $path): array {
        if (!file_exists($path)) {
            return [];
        }
        return json_decode(file_get_contents($path), true) ?? [];
    }

    private function writeJson(string $path, array $data): void {
        file_put_contents($path, json_encode($data, JSON_PRETTY_PRINT));
    }

    private function setJsonResponse(array $data): void {
        $this->setResponse(new CControllerResponseData([
            'body' => json_encode($data)
        ]));
    }
}
