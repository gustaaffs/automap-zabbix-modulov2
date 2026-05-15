<?php

namespace Modules\AutomapTopology\Actions;

use API;
use CController;
use CControllerResponseData;

class TopologyView extends CController {

	protected function checkInput(): bool {
		$fields = [
			'groupids'      => 'array',
			'max_levels'    => 'int32',
			'util_warn_pct' => 'int32',
			'util_crit_pct' => 'int32'
		];

		return $this->validateInput($fields);
	}

	protected function checkPermissions(): bool {
		return $this->getUserType() >= USER_TYPE_ZABBIX_USER;
	}

	// ── Helpers BFS ────────────────────────────────────────────────────────

	private function normalizeNodeName(string $name): string {
		$name = trim(strtolower($name));
		if (strpos($name, '.') !== false) {
			$name = explode('.', $name)[0];
		}
		return trim($name);
	}

	private function fetchVizinhoItems(array $hostids): array {
		if (!$hostids) return [];

		$items = API::Item()->get([
			'output'    => ['itemid', 'hostid', 'name'],
			'hostids'   => $hostids,
			'monitored' => true,
			'tags'      => [['tag' => 'component', 'value' => 'vizinho', 'operator' => 1]],
			'sortfield' => 'name',
			'sortorder' => 'ASC'
		]);

		if (!is_array($items) || !$items) {
			$items = API::Item()->get([
				'output'    => ['itemid', 'hostid', 'name'],
				'hostids'   => $hostids,
				'monitored' => true,
				'search'    => ['name' => 'Vizinho'],
				'sortfield' => 'name',
				'sortorder' => 'ASC'
			]);
		}

		return is_array($items) ? $items : [];
	}

	private function parseVizinhoItem(string $item_name): ?array {
		if (preg_match('/^Vizinho\s+(CDP|LLDP)\s*:\s*(.+?)\s*\(Porta\s+(.+?)\)\s*$/iu', $item_name, $m)) {
			return [strtoupper(trim($m[1])), trim($m[2]), trim($m[3])];
		}
		if (preg_match('/^Vizinho\s+(CDP|LLDP)\s*:\s*(.+?)\s*$/iu', $item_name, $m)) {
			return [strtoupper(trim($m[1])), trim($m[2]), ''];
		}
		return null;
	}

	private function resolveNeighborHostsByName(array $names_norm_to_raw): array {
		if (!$names_norm_to_raw) return [];

		$terms = array_values(array_unique(array_merge(
			array_keys($names_norm_to_raw),
			array_values($names_norm_to_raw)
		)));

		$hosts = API::Host()->get([
			'output'          => ['hostid', 'host', 'name'],
			'search'          => ['host' => $terms, 'name' => $terms],
			'searchByAny'     => true,
			'monitored_hosts' => true
		]);

		$resolved = [];
		if (is_array($hosts)) {
			foreach ($hosts as $h) {
				$nn = $this->normalizeNodeName($h['name']);
				$nt = $this->normalizeNodeName($h['host']);
				if (isset($names_norm_to_raw[$nn]) && !isset($resolved[$nn])) {
					$resolved[$nn] = ['hostid' => $h['hostid'], 'name' => $h['name']];
				}
				if (isset($names_norm_to_raw[$nt]) && !isset($resolved[$nt])) {
					$resolved[$nt] = ['hostid' => $h['hostid'], 'name' => $h['name']];
				}
			}
		}
		return $resolved;
	}

	private function fetchTelemetry(array $expanded_host_map): array {
		$hostids = array_values(array_unique(array_keys($expanded_host_map)));
		$status = $traffic = $speed = [];
		if (!$hostids) return [$status, $traffic, $speed];

		$items = API::Item()->get([
			'output'      => ['itemid', 'hostid', 'name', 'lastvalue', 'units'],
			'hostids'     => $hostids,
			'monitored'   => true,
			'search'      => ['name' => ['Operational status', 'Bits received', 'Bits sent', 'Speed']],
			'searchByAny' => true,
			'sortfield'   => 'name',
			'sortorder'   => 'ASC'
		]);

		if (is_array($items)) {
			foreach ($items as $item) {
				$name = trim($item['name']);
				if (stripos($name, 'Interface ') !== 0) continue;
				$host = $expanded_host_map[$item['hostid']] ?? ('Host_' . $item['hostid']);
				$rec  = [
					'host'  => $host,
					'name'  => $name,
					'value' => (string) $item['lastvalue'],
					'units' => (string) ($item['units'] ?? '')
				];
				if (stripos($name, 'Operational status') !== false)        $status[]  = $rec;
				elseif (stripos($name, 'Bits received') !== false
					||  stripos($name, 'Bits sent')     !== false)         $traffic[] = $rec;
				elseif (preg_match('/:\s*Speed\s*$/i', $name))             $speed[]   = $rec;
			}
		}
		return [$status, $traffic, $speed];
	}

	// ── Ação principal ─────────────────────────────────────────────────────

	protected function doAction(): void {
		$groupids      = array_values(array_filter((array) $this->getInput('groupids', []), 'strlen'));
		$max_levels    = max(1, min(6, (int) $this->getInput('max_levels', 2)));
		$util_warn_pct = max(1, min(100, (int) $this->getInput('util_warn_pct', 60)));
		$util_crit_pct = max(1, min(100, (int) $this->getInput('util_crit_pct', 85)));
		if ($util_crit_pct < $util_warn_pct) $util_crit_pct = $util_warn_pct;

		// Todos os grupos para o filtro
		$all_groups = API::HostGroup()->get([
			'output'                => ['groupid', 'name'],
			'with_monitored_hosts'  => true,
			'sortfield'             => 'name',
			'sortorder'             => 'ASC'
		]);
		$all_groups = is_array($all_groups) ? $all_groups : [];

		$selected_groups = [];
		foreach ($all_groups as $g) {
			if (in_array($g['groupid'], $groupids)) {
				$selected_groups[] = ['id' => $g['groupid'], 'name' => $g['name']];
			}
		}

		$response = [
			'all_groups'      => $all_groups,
			'selected_groups' => $selected_groups,
			'groupids'        => $groupids,
			'max_levels'      => $max_levels,
			'util_warn_pct'   => $util_warn_pct,
			'util_crit_pct'   => $util_crit_pct,
			'group_name'      => '',
			'links_b64'       => base64_encode('[]'),
			'levels_b64'      => base64_encode('{}'),
			'status_b64'      => base64_encode('[]'),
			'traffic_b64'     => base64_encode('[]'),
			'speed_b64'       => base64_encode('[]'),
			'unmanaged_b64'   => base64_encode('[]'),
			'config_b64'      => base64_encode(json_encode([
				'max_levels'    => $max_levels,
				'util_warn_pct' => $util_warn_pct,
				'util_crit_pct' => $util_crit_pct,
				'show_unmanaged'=> 0
			])),
			'message' => ''
		];

		if (!$groupids) {
			$this->setResponse(new CControllerResponseData($response));
			return;
		}

		foreach ($all_groups as $g) {
			if ($g['groupid'] === $groupids[0]) {
				$response['group_name'] = $g['name'];
				break;
			}
		}

		$lvl0_hosts = API::Host()->get([
			'output'          => ['hostid', 'name'],
			'groupids'        => $groupids,
			'monitored_hosts' => true
		]);

		if (!$lvl0_hosts) {
			$response['message'] = 'Nenhum host monitorado encontrado.';
			$this->setResponse(new CControllerResponseData($response));
			return;
		}

		$known_hosts = $expanded = [];
		foreach ($lvl0_hosts as $h) {
			$norm = $this->normalizeNodeName($h['name']);
			$known_hosts[$norm] = ['hostid' => $h['hostid'], 'name' => $h['name'], 'level' => 0];
			$expanded[$h['hostid']] = $h['name'];
		}

		$unique_map = $all_neighbors = [];
		$current    = array_keys($known_hosts);

		for ($level = 0; $level < $max_levels && $current; $level++) {
			$hids = array_filter(array_map(fn($n) => $known_hosts[$n]['hostid'] ?? null, $current));
			$items = $this->fetchVizinhoItems(array_values($hids));
			if (!$items) break;

			$discovered = [];
			foreach ($items as $item) {
				$src_raw = $expanded[$item['hostid']] ?? ('HostID_' . $item['hostid']);
				$parsed  = $this->parseVizinhoItem(trim($item['name']));
				if (!$parsed) continue;
				[$proto, $tgt_raw, $port] = $parsed;

				$sn = $this->normalizeNodeName($src_raw);
				$tn = $this->normalizeNodeName($tgt_raw);
				if (!$sn || !$tn) continue;

				$all_neighbors[$tn] = $tgt_raw;
				if (!isset($known_hosts[$tn])) $discovered[$tn] = $tgt_raw;

				$pair = [$sn, $tn];
				sort($pair, SORT_STRING);
				$key = implode('|', $pair) . '|' . $proto . '|' . $port;
				if (!isset($unique_map[$key])) {
					$unique_map[$key] = [
						'source' => $sn, 'target' => $tn,
						'protocol' => $proto, 'port' => $port,
						'raw_item' => $item['name']
					];
				}
			}

			$next = [];
			if ($discovered) {
				$resolved = $this->resolveNeighborHostsByName($discovered);
				foreach ($discovered as $norm => $raw) {
					if (isset($resolved[$norm])) {
						$known_hosts[$norm] = ['hostid' => $resolved[$norm]['hostid'], 'name' => $resolved[$norm]['name'], 'level' => $level + 1];
						$expanded[$resolved[$norm]['hostid']] = $resolved[$norm]['name'];
						$next[] = $norm;
					} else {
						$known_hosts[$norm] = ['hostid' => null, 'name' => $raw, 'level' => $level + 1];
					}
				}
			}
			$current = $next;
		}

		$host_levels = $unmanaged = [];
		foreach ($known_hosts as $norm => $info) {
			$host_levels[$norm] = $info['level'];
			if (isset($all_neighbors[$norm]) && empty($info['hostid'])) $unmanaged[] = $norm;
		}

		[$status_items, $traffic_items, $speed_items] = $this->fetchTelemetry($expanded);

		$enc = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES;
		$response['links_b64']    = base64_encode(json_encode(array_values($unique_map), $enc));
		$response['levels_b64']   = base64_encode(json_encode($host_levels ?: new \stdClass(), $enc));
		$response['status_b64']   = base64_encode(json_encode($status_items, $enc));
		$response['traffic_b64']  = base64_encode(json_encode($traffic_items, $enc));
		$response['speed_b64']    = base64_encode(json_encode($speed_items, $enc));
		$response['unmanaged_b64']= base64_encode(json_encode(array_values(array_unique($unmanaged)), $enc));

		$this->setResponse(new CControllerResponseData($response));
	}
}
