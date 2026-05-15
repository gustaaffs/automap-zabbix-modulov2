<?php

/**
 * @var CView $this
 * @var array $data
 */

// Grupos para o select
$group_options = '';
foreach ($data['all_groups'] as $g) {
	$sel = in_array($g['groupid'], $data['groupids']) ? ' selected' : '';
	$group_options .= '<option value="' . htmlspecialchars($g['groupid']) . '"' . $sel . '>'
		. htmlspecialchars($g['name']) . '</option>';
}

$has_data = !empty($data['groupids']) && empty($data['message']);

(new CWidget())
	->setTitle(_('AutoMap — Topologia de Rede'))
	->addItem(new CTag('div', true,
		// Filtro
		(new CTag('form', true))
			->setAttribute('method', 'get')
			->setAttribute('action', 'zabbix.php')
			->setAttribute('style', 'display:flex; align-items:center; gap:16px; flex-wrap:wrap; margin-bottom:12px;')
			->addItem(new CVar('action', 'automap.topology.view'))
			->addItem(
				(new CTag('div', true))
					->setAttribute('style', 'display:flex; align-items:center; gap:8px;')
					->addItem(new CLabel(_('Grupos'), 'groupids'))
					->addItem(
						(new CTag('select', true, $group_options))
							->setAttribute('name', 'groupids[]')
							->setAttribute('id', 'groupids')
							->setAttribute('multiple', 'multiple')
							->setAttribute('size', '1')
							->setAttribute('style', 'min-width:220px; max-width:320px;')
					)
			)
			->addItem(
				(new CTag('div', true))
					->setAttribute('style', 'display:flex; align-items:center; gap:8px;')
					->addItem(new CLabel(_('Níveis'), 'max_levels'))
					->addItem(
						(new CNumericBox('max_levels', $data['max_levels'], 1))
							->setAttribute('min', '1')
							->setAttribute('max', '6')
							->setWidth(ZBX_TEXTAREA_TINY_WIDTH)
					)
			)
			->addItem(
				(new CTag('div', true))
					->setAttribute('style', 'display:flex; align-items:center; gap:8px;')
					->addItem(new CLabel(_('Warn %'), 'util_warn_pct'))
					->addItem(
						(new CNumericBox('util_warn_pct', $data['util_warn_pct'], 3))
							->setAttribute('min', '1')->setAttribute('max', '100')
							->setWidth(ZBX_TEXTAREA_TINY_WIDTH)
					)
			)
			->addItem(
				(new CTag('div', true))
					->setAttribute('style', 'display:flex; align-items:center; gap:8px;')
					->addItem(new CLabel(_('Crit %'), 'util_crit_pct'))
					->addItem(
						(new CNumericBox('util_crit_pct', $data['util_crit_pct'], 3))
							->setAttribute('min', '1')->setAttribute('max', '100')
							->setWidth(ZBX_TEXTAREA_TINY_WIDTH)
					)
			)
			->addItem(
				(new CSubmit('apply', _('Aplicar')))
					->setAttribute('style', 'margin-left:8px;')
			)
	))
	->addItem(
		// Container do mapa
		(new CTag('div', true))
			->setAttribute('id', 'topology-map-root')
			->setAttribute('data-links',     $data['links_b64'])
			->setAttribute('data-levels',    $data['levels_b64'])
			->setAttribute('data-statuses',  $data['status_b64'])
			->setAttribute('data-traffic',   $data['traffic_b64'])
			->setAttribute('data-speed',     $data['speed_b64'])
			->setAttribute('data-unmanaged', $data['unmanaged_b64'])
			->setAttribute('data-config',    $data['config_b64'])
			->setAttribute('data-group-id',  implode(',', $data['groupids']))
			->setAttribute('style',
				'position:relative; width:100%; height:calc(100vh - 200px); min-height:500px;'
				. ' background:#0f172a; border-radius:8px; overflow:hidden; box-sizing:border-box;'
			)
			->addItem(
				// Área do grafo SVG
				(new CTag('div', true))
					->setAttribute('id', 'topology-graph')
					->setAttribute('style', 'position:absolute; inset:0; width:100%; height:100%;')
			)
			->addItem(
				// Mensagem quando não há grupo
				!$has_data
					? (new CTag('div', true,
						empty($data['groupids'])
							? _('Selecione um grupo de hosts no filtro acima.')
							: ($data['message'] ?: '')
					))->setAttribute('style',
						'position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);'
						. ' color:#94a3b8; font-size:15px; text-align:center;'
					)
					: ''
			)
			->addItem(
				// Popup de detalhes do nó
				(new CTag('div', true))
					->setAttribute('id', 'topology-popup')
					->setAttribute('style',
						'display:none; position:absolute; z-index:30; width:320px;'
						. ' background:#111827; color:#e5e7eb; border:1px solid #1f2937;'
						. ' border-radius:10px; box-shadow:0 20px 40px rgba(0,0,0,0.35);'
						. ' padding:14px; box-sizing:border-box;'
					)
			)
			->addItem(
				// Botão Resetar layout
				(new CTag('button', true, '↺ Resetar'))
					->setAttribute('id', 'topology-reset-btn')
					->setAttribute('type', 'button')
					->setAttribute('title', _('Resetar posições e zoom'))
					->setAttribute('style',
						'position:absolute; top:12px; left:12px; z-index:25;'
						. ' padding:6px 10px; border-radius:8px; background:#111827; color:#e5e7eb;'
						. ' border:1px solid #374151; cursor:pointer; font-size:12px;'
					)
			)
			->addItem(
				// Botão Voltar (drill-down)
				(new CTag('button', true, '← Voltar'))
					->setAttribute('id', 'topology-back-btn')
					->setAttribute('type', 'button')
					->setAttribute('style',
						'display:none; position:absolute; top:12px; left:90px; z-index:25;'
						. ' padding:6px 12px; border-radius:8px; background:#1e3a5f; color:#93c5fd;'
						. ' border:1px solid #2563eb; cursor:pointer; font-size:12px; font-weight:600;'
					)
			)
	))
	->show();
