<?php

namespace Modules\Topology\Actions;

use CController;
use CControllerResponseData;
use API;

class WidgetView extends CController {

    protected function init(): void {
        $this->disableSIDvalidation();
    }

    protected function checkInput(): bool {
        return true;
    }

    protected function checkPermissions(): bool {
        return $this->checkAccess(CRoleHelper::UI_MONITORING_HOSTS);
    }

    protected function doAction(): void {
        // 1. Busca todos os items com tag component=network-topology
        $items = API::Item()->get([
            'output'      => ['itemid', 'hostid', 'name', 'key_'],
            'tags'        => [[
                'tag'      => 'component',
                'value'    => 'network-topology',
                'operator' => TAG_OPERATOR_EQUAL
            ]],
            'selectTags'  => ['tag', 'value'],
            'monitored'   => true,
            'preservekeys' => false
        ]);

        // 2. Todos os hosts monitorados (para cruzamento e seletor manual)
        $hosts = API::Host()->get([
            'output'          => ['hostid', 'name'],
            'monitored_hosts' => true,
            'preservekeys'    => true
        ]);

        // 3. Carrega overrides de nome (ex: FQDN → hostname Zabbix)
        $overrides = $this->loadJson('name_overrides.json');

        // 4. Índice de busca: nome normalizado → hostid
        $lookup = [];
        foreach ($hosts as $hostid => $host) {
            $lookup[strtolower($host['name'])]                      = $hostid;
            $lookup[strtolower(explode('.', $host['name'])[0])]    = $hostid;
        }
        // Aplica overrides manuais
        foreach ($overrides as $neighbor_raw => $hostid) {
            $lookup[strtolower($neighbor_raw)] = $hostid;
        }

        // 5. Constrói nodes e edges a partir dos items CDP/LLDP
        $edges      = [];
        $node_ids   = [];
        $unresolved = [];

        foreach ($items as $item) {
            $src_hostid = $item['hostid'];
            $node_ids[$src_hostid] = true;

            // Extrai nome do vizinho da tag "vizinho: <valor>"
            $neighbor_name = null;
            foreach ($item['tags'] as $tag) {
                if ($tag['tag'] === 'vizinho') {
                    $neighbor_name = $tag['value'];
                    break;
                }
            }
            if ($neighbor_name === null) {
                continue;
            }

            // Normaliza: strip FQDN
            $normalized = strtolower(explode('.', trim($neighbor_name))[0]);
            $dst_hostid = $lookup[$normalized]
                       ?? $lookup[strtolower(trim($neighbor_name))]
                       ?? null;

            if ($dst_hostid !== null) {
                $node_ids[$dst_hostid] = true;
                $edge_key = min($src_hostid, $dst_hostid) . '_' . max($src_hostid, $dst_hostid);
                if (!array_key_exists($edge_key, $edges)) {
                    $edges[$edge_key] = [
                        'from'  => $src_hostid,
                        'to'    => $dst_hostid,
                        'label' => $this->extractPort($item['name']),
                        'type'  => 'auto'
                    ];
                }
            } else {
                $unresolved[$normalized] = [
                    'name'          => $neighbor_name,
                    'normalized'    => $normalized,
                    'source_hostid' => $src_hostid
                ];
            }
        }

        // 6. Adiciona links manuais
        $manual_links = $this->loadJson('manual_links.json');
        foreach ($manual_links as $link) {
            $edge_key = min($link['from'], $link['to']) . '_' . max($link['from'], $link['to']);
            if (!array_key_exists($edge_key, $edges)) {
                $node_ids[$link['from']] = true;
                $node_ids[$link['to']]   = true;
                $edges[$edge_key] = [
                    'from'  => $link['from'],
                    'to'    => $link['to'],
                    'label' => $link['label'] ?? '',
                    'type'  => 'manual'
                ];
            }
        }

        // 7. Monta lista de nodes
        $nodes = [];
        foreach (array_keys($node_ids) as $hostid) {
            if (isset($hosts[$hostid])) {
                $nodes[] = ['id' => $hostid, 'label' => $hosts[$hostid]['name']];
            }
        }

        // 8. Adiciona nodes de vizinhos não resolvidos (com marcação visual)
        foreach ($unresolved as $u) {
            $nodes[] = [
                'id'    => 'unresolved_' . $u['normalized'],
                'label' => $u['name'],
                'group' => 'unresolved'
            ];
            $edge_key = $u['source_hostid'] . '_unresolved_' . $u['normalized'];
            $edges[$edge_key] = [
                'from'  => $u['source_hostid'],
                'to'    => 'unresolved_' . $u['normalized'],
                'label' => '',
                'type'  => 'auto'
            ];
        }

        // 9. Carrega posições salvas
        $positions = $this->loadJson('positions.json');

        $this->setResponse(new CControllerResponseData([
            'topology' => [
                'nodes'     => array_values($nodes),
                'edges'     => array_values($edges),
                'positions' => $positions,
                'unresolved'=> array_values($unresolved)
            ],
            'all_hosts' => array_values($hosts)
        ]));
    }

    // Extrai porta do nome do item:
    // "CDP - Raw Data: Vizinho CDP: SW-X (Porta GigabitEthernet0/1)"
    private function extractPort(string $name): string {
        if (preg_match('/\(Porta\s+([^)]+)\)/i', $name, $m)) {
            return $m[1];
        }
        return '';
    }

    private function loadJson(string $filename): array {
        $path = __DIR__ . '/../data/' . $filename;
        if (!file_exists($path)) {
            return [];
        }
        return json_decode(file_get_contents($path), true) ?? [];
    }
}
