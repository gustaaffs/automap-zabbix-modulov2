<?php

/**
 * @var CView  $this
 * @var array  $data   { topology: {...}, all_hosts: [...] }
 */

use CCsrfTokenHelper;
?>
<div class="topology-widget"
     data-topology="<?= htmlspecialchars(json_encode($data['topology']), ENT_QUOTES) ?>"
     data-all-hosts="<?= htmlspecialchars(json_encode($data['all_hosts']), ENT_QUOTES) ?>">

    <div class="topology-toolbar">
        <button class="btn-topo btn-topo-discover" title="Re-descobrir via CDP/LLDP">
            &#8635; Auto-descobrir
        </button>
        <button class="btn-topo btn-topo-add-link" title="Adicionar conexão manual">
            + Conectar
        </button>
        <button class="btn-topo btn-topo-save-pos" title="Salvar posições dos nós">
            &#128190; Salvar layout
        </button>
        <span class="topo-status"></span>
    </div>

    <canvas class="topology-canvas"></canvas>

    <?php if (!empty($data['topology']['unresolved'])): ?>
    <div class="topo-unresolved-panel">
        <span class="topo-unresolved-title">&#9888; Vizinhos não resolvidos</span>
        <ul>
        <?php foreach ($data['topology']['unresolved'] as $u): ?>
            <li data-neighbor="<?= htmlspecialchars($u['name'], ENT_QUOTES) ?>">
                <span class="topo-unresolved-name"><?= htmlspecialchars($u['name']) ?></span>
                <button class="btn-topo-resolve"
                        data-neighbor="<?= htmlspecialchars($u['name'], ENT_QUOTES) ?>">
                    Resolver
                </button>
            </li>
        <?php endforeach; ?>
        </ul>
    </div>
    <?php endif; ?>

    <!-- Modal: adicionar link manual -->
    <div class="topo-modal" id="topo-modal-link" style="display:none">
        <div class="topo-modal-box">
            <h3 class="topo-modal-title">Adicionar conexão manual</h3>
            <label>Host origem</label>
            <select class="topo-select topo-select-from"></select>
            <label>Host destino</label>
            <select class="topo-select topo-select-to"></select>
            <label>Label (opcional)</label>
            <input type="text" class="topo-input topo-link-label" placeholder="Ex: Gi0/1 ↔ Gi0/2">
            <div class="topo-modal-actions">
                <button class="btn-topo btn-modal-confirm">Confirmar</button>
                <button class="btn-topo btn-modal-cancel">Cancelar</button>
            </div>
        </div>
    </div>

    <!-- Modal: resolver vizinho -->
    <div class="topo-modal" id="topo-modal-resolve" style="display:none">
        <div class="topo-modal-box">
            <h3 class="topo-modal-title">Resolver vizinho</h3>
            <p>Vizinho: <strong class="topo-resolve-name"></strong></p>
            <label>Mapear para host Zabbix</label>
            <select class="topo-select topo-resolve-host"></select>
            <div class="topo-modal-actions">
                <button class="btn-topo btn-resolve-confirm">Confirmar</button>
                <button class="btn-topo btn-resolve-cancel">Cancelar</button>
            </div>
        </div>
    </div>

</div>
