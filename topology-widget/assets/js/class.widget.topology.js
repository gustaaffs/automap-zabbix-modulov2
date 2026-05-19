'use strict';

class WidgetTopology extends CWidget {

    static TYPE = 'topology';

    onInitialize() {
        this._graph   = null;
        this._allHosts = [];
        this._container = null;
    }

    onActivate() {
        this._startUpdating();
    }

    onDeactivate() {
        this._stopUpdating();
        if (this._graph) {
            this._graph.destroy();
            this._graph = null;
        }
    }

    onDataSucceeded(response) {
        this._container = this.getBody().querySelector('.topology-widget');
        if (!this._container) return;

        const topology  = JSON.parse(this._container.dataset.topology  || '{}');
        this._allHosts  = JSON.parse(this._container.dataset.allHosts || '[]');

        this._initGraph(topology);
        this._bindToolbar();
        this._bindUnresolved();
    }

    // ──────────────────────────────────────────────────────────────
    // Grafo (Canvas 2D + force-directed layout)
    // ──────────────────────────────────────────────────────────────

    _initGraph(topology) {
        const canvas = this._container.querySelector('.topology-canvas');
        if (!canvas) return;

        // Ajusta canvas ao container
        const resize = () => {
            canvas.width  = canvas.offsetWidth;
            canvas.height = canvas.offsetHeight;
            if (this._graph) this._graph.resize(canvas.width, canvas.height);
        };
        resize();

        this._resizeObserver = new ResizeObserver(resize);
        this._resizeObserver.observe(canvas);

        this._graph = new TopoGraph(canvas);
        this._graph.setData(topology.nodes || [], topology.edges || [], topology.positions || {});
    }

    // ──────────────────────────────────────────────────────────────
    // Toolbar
    // ──────────────────────────────────────────────────────────────

    _bindToolbar() {
        const c = this._container;

        c.querySelector('.btn-topo-discover')?.addEventListener('click', () => {
            this._setStatus('Redescobrindo...');
            this._startUpdating();
        });

        c.querySelector('.btn-topo-add-link')?.addEventListener('click', () => {
            this._openAddLinkModal();
        });

        c.querySelector('.btn-topo-save-pos')?.addEventListener('click', () => {
            this._savePositions();
        });
    }

    _setStatus(msg) {
        const el = this._container.querySelector('.topo-status');
        if (el) el.textContent = msg;
        setTimeout(() => { if (el) el.textContent = ''; }, 3000);
    }

    // ──────────────────────────────────────────────────────────────
    // Modal: adicionar link manual
    // ──────────────────────────────────────────────────────────────

    _openAddLinkModal() {
        const modal   = this._container.querySelector('#topo-modal-link');
        const selFrom = modal.querySelector('.topo-select-from');
        const selTo   = modal.querySelector('.topo-select-to');

        selFrom.innerHTML = '';
        selTo.innerHTML   = '';

        this._allHosts.forEach(h => {
            const opt = `<option value="${h.hostid}">${this._esc(h.name)}</option>`;
            selFrom.insertAdjacentHTML('beforeend', opt);
            selTo.insertAdjacentHTML('beforeend', opt);
        });

        modal.style.display = 'flex';

        modal.querySelector('.btn-modal-confirm').onclick = () => {
            const from  = selFrom.value;
            const to    = selTo.value;
            const label = modal.querySelector('.topo-link-label').value.trim();

            if (from === to) {
                alert('Origem e destino devem ser diferentes.');
                return;
            }

            this._apiPost('topology.save_link', { from, to, label })
                .then(res => {
                    modal.style.display = 'none';
                    if (res.status === 'ok') {
                        this._setStatus('Conexão salva.');
                        this._startUpdating();
                    } else if (res.status === 'exists') {
                        this._setStatus('Conexão já existe.');
                    }
                });
        };

        modal.querySelector('.btn-modal-cancel').onclick = () => {
            modal.style.display = 'none';
        };
    }

    // ──────────────────────────────────────────────────────────────
    // Painel de vizinhos não resolvidos
    // ──────────────────────────────────────────────────────────────

    _bindUnresolved() {
        const c = this._container;
        c.querySelectorAll('.btn-topo-resolve').forEach(btn => {
            btn.addEventListener('click', () => {
                this._openResolveModal(btn.dataset.neighbor);
            });
        });
    }

    _openResolveModal(neighborName) {
        const modal = this._container.querySelector('#topo-modal-resolve');
        modal.querySelector('.topo-resolve-name').textContent = neighborName;

        const sel = modal.querySelector('.topo-resolve-host');
        sel.innerHTML = '';
        this._allHosts.forEach(h => {
            sel.insertAdjacentHTML('beforeend',
                `<option value="${h.hostid}">${this._esc(h.name)}</option>`);
        });

        modal.style.display = 'flex';

        modal.querySelector('.btn-resolve-confirm').onclick = () => {
            const hostid = sel.value;
            this._apiPost('topology.set_override', {
                neighbor_name: neighborName,
                hostid
            }).then(() => {
                modal.style.display = 'none';
                this._setStatus('Override salvo. Redescobrindo...');
                this._startUpdating();
            });
        };

        modal.querySelector('.btn-resolve-cancel').onclick = () => {
            modal.style.display = 'none';
        };
    }

    // ──────────────────────────────────────────────────────────────
    // Salvar posições dos nós
    // ──────────────────────────────────────────────────────────────

    _savePositions() {
        if (!this._graph) return;
        const positions = this._graph.getPositions();
        this._apiPost('topology.save_link', { _action: 'positions', positions: JSON.stringify(positions) })
            .catch(() => {});
        // Persiste via endpoint de posições — ver TopologySavePositions.php
        // Por ora salva localmente no localStorage como fallback
        try {
            localStorage.setItem('topo_positions', JSON.stringify(positions));
            this._setStatus('Layout salvo (local).');
        } catch (_) {}
    }

    // ──────────────────────────────────────────────────────────────
    // Helper AJAX
    // ──────────────────────────────────────────────────────────────

    _apiPost(action, params) {
        const body = new URLSearchParams({ ...params });
        return fetch(`zabbix.php?action=${action}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'X-Requested-With': 'XMLHttpRequest'
            },
            body
        }).then(r => r.json()).catch(() => ({}));
    }

    _esc(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }
}

// ══════════════════════════════════════════════════════════════════
//  TopoGraph — grafo force-directed sobre Canvas 2D (sem dependência)
// ══════════════════════════════════════════════════════════════════

class TopoGraph {

    constructor(canvas) {
        this.canvas   = canvas;
        this.ctx      = canvas.getContext('2d');
        this.nodes    = [];   // { id, label, group, x, y, vx, vy, fixed }
        this.edges    = [];   // { from, to, label, type }
        this.nodeMap  = new Map();

        this._drag     = null;
        this._panning  = false;
        this._panStart = null;
        this._tx       = 0;
        this._ty       = 0;
        this._scale    = 1;
        this._raf      = null;
        this._simRunning = false;

        this._bindEvents();
    }

    setData(nodes, edges, savedPositions = {}) {
        const W = this.canvas.width  || 600;
        const H = this.canvas.height || 400;

        // Tenta recuperar posições do localStorage se não vierem do servidor
        let localPos = {};
        try { localPos = JSON.parse(localStorage.getItem('topo_positions') || '{}'); } catch (_) {}
        const pos = Object.assign({}, localPos, savedPositions);

        this.nodes = nodes.map((n, i) => {
            const saved = pos[n.id];
            return {
                ...n,
                x:     saved ? saved.x : W / 2 + Math.cos(2 * Math.PI * i / nodes.length) * 180,
                y:     saved ? saved.y : H / 2 + Math.sin(2 * Math.PI * i / nodes.length) * 180,
                vx:    0,
                vy:    0,
                fixed: !!saved
            };
        });
        this.edges   = edges;
        this.nodeMap = new Map(this.nodes.map(n => [n.id, n]));

        // Roda layout estático antes de exibir
        this._layoutStatic(400);
        this._draw();
    }

    getPositions() {
        const out = {};
        this.nodes.forEach(n => { out[n.id] = { x: Math.round(n.x), y: Math.round(n.y) }; });
        return out;
    }

    resize(w, h) {
        this._draw();
    }

    destroy() {
        if (this._raf) cancelAnimationFrame(this._raf);
    }

    // ── Layout Fruchterman-Reingold estático ──────────────────────

    _layoutStatic(iterations) {
        const W = this.canvas.width  || 600;
        const H = this.canvas.height || 400;
        const area = W * H;
        const k    = Math.sqrt(area / Math.max(this.nodes.length, 1)) * 0.9;

        for (let iter = 0; iter < iterations; iter++) {
            const temp = k * Math.max(0.01, 1 - iter / iterations);

            // Repulsão
            for (let i = 0; i < this.nodes.length; i++) {
                this.nodes[i]._dx = 0;
                this.nodes[i]._dy = 0;
                for (let j = 0; j < this.nodes.length; j++) {
                    if (i === j) continue;
                    const dx   = this.nodes[i].x - this.nodes[j].x;
                    const dy   = this.nodes[i].y - this.nodes[j].y;
                    const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
                    const f    = k * k / dist;
                    this.nodes[i]._dx += (dx / dist) * f;
                    this.nodes[i]._dy += (dy / dist) * f;
                }
            }

            // Atração
            this.edges.forEach(e => {
                const u = this.nodeMap.get(e.from);
                const v = this.nodeMap.get(e.to);
                if (!u || !v) return;
                const dx   = u.x - v.x;
                const dy   = u.y - v.y;
                const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
                const f    = dist * dist / k;
                u._dx -= (dx / dist) * f;
                u._dy -= (dy / dist) * f;
                v._dx += (dx / dist) * f;
                v._dy += (dy / dist) * f;
            });

            // Aplica com temperatura decrescente
            this.nodes.forEach(n => {
                if (n.fixed) return;
                const len = Math.sqrt(n._dx * n._dx + n._dy * n._dy) || 0.01;
                const move = Math.min(len, temp);
                n.x = Math.max(50, Math.min(W - 50, n.x + (n._dx / len) * move));
                n.y = Math.max(50, Math.min(H - 50, n.y + (n._dy / len) * move));
            });
        }
    }

    // ── Desenho ───────────────────────────────────────────────────

    _draw() {
        const ctx = this.ctx;
        const W   = this.canvas.width;
        const H   = this.canvas.height;

        ctx.clearRect(0, 0, W, H);
        ctx.save();
        ctx.translate(this._tx, this._ty);
        ctx.scale(this._scale, this._scale);

        // Arestas
        this.edges.forEach(e => this._drawEdge(e));

        // Nós
        this.nodes.forEach(n => this._drawNode(n));

        ctx.restore();
    }

    _drawEdge(e) {
        const ctx  = this.ctx;
        const from = this.nodeMap.get(e.from);
        const to   = this.nodeMap.get(e.to);
        if (!from || !to) return;

        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.strokeStyle = e.type === 'manual' ? '#e67e22' : '#5dade2';
        ctx.lineWidth   = e.type === 'manual' ? 2.5 : 1.8;
        ctx.setLineDash(e.type === 'manual' ? [6, 3] : []);
        ctx.stroke();
        ctx.setLineDash([]);

        // Label da aresta
        if (e.label) {
            const mx = (from.x + to.x) / 2;
            const my = (from.y + to.y) / 2;
            ctx.save();
            ctx.fillStyle    = '#fff';
            ctx.strokeStyle  = '#aaa';
            ctx.lineWidth    = 1;
            const tw = ctx.measureText(e.label).width + 8;
            ctx.fillRect(mx - tw / 2, my - 8, tw, 14);
            ctx.strokeRect(mx - tw / 2, my - 8, tw, 14);
            ctx.fillStyle  = '#555';
            ctx.font       = '9px monospace';
            ctx.textAlign  = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(e.label, mx, my);
            ctx.restore();
        }
    }

    _drawNode(n) {
        const ctx = this.ctx;
        const R   = 22;

        // Sombra suave
        ctx.shadowColor   = 'rgba(0,0,0,0.15)';
        ctx.shadowBlur    = 6;
        ctx.shadowOffsetY = 2;

        // Círculo
        ctx.beginPath();
        ctx.arc(n.x, n.y, R, 0, 2 * Math.PI);
        ctx.fillStyle = n.group === 'unresolved' ? '#e74c3c'
                      : n._highlight             ? '#f39c12'
                      : '#2980b9';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth   = 2.5;
        ctx.stroke();
        ctx.shadowColor = 'transparent';

        // Ícone de switch/roteador (texto Unicode simples)
        ctx.fillStyle    = '#fff';
        ctx.font         = '13px sans-serif';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(n.group === 'unresolved' ? '?' : '⬡', n.x, n.y);

        // Label abaixo
        const maxLen = 18;
        const label  = n.label.length > maxLen ? n.label.slice(0, maxLen - 1) + '…' : n.label;
        ctx.fillStyle    = '#222';
        ctx.font         = '11px sans-serif';
        ctx.textBaseline = 'top';
        ctx.fillText(label, n.x, n.y + R + 4);
    }

    // ── Eventos de mouse ──────────────────────────────────────────

    _bindEvents() {
        const canvas = this.canvas;

        canvas.addEventListener('mousedown',  e => this._onMouseDown(e));
        canvas.addEventListener('mousemove',  e => this._onMouseMove(e));
        canvas.addEventListener('mouseup',    e => this._onMouseUp(e));
        canvas.addEventListener('wheel',      e => this._onWheel(e), { passive: false });
        canvas.addEventListener('contextmenu', e => e.preventDefault());
    }

    _onMouseDown(e) {
        const pos  = this._toGraph(e);
        const node = this._hitNode(pos);

        if (e.button === 2) {
            // Clique direito: remover link manual (se clicar numa aresta)
            return;
        }

        if (node) {
            this._drag     = { node, startX: node.x, startY: node.y };
            this._hasMoved = false;
        } else {
            // Pan
            this._panning  = true;
            this._panStart = { x: e.clientX - this._tx, y: e.clientY - this._ty };
        }
    }

    _onMouseMove(e) {
        if (this._drag) {
            const pos = this._toGraph(e);
            this._drag.node.x     = pos.x;
            this._drag.node.y     = pos.y;
            this._drag.node.fixed = true;
            this._hasMoved = true;
            this._draw();
        } else if (this._panning) {
            this._tx = e.clientX - this._panStart.x;
            this._ty = e.clientY - this._panStart.y;
            this._draw();
        }
    }

    _onMouseUp(e) {
        if (this._drag && !this._hasMoved) {
            // Click sem arrastar — destaque
            const n = this._drag.node;
            n._highlight = !n._highlight;
            this._draw();
        }
        this._drag    = null;
        this._panning = false;
    }

    _onWheel(e) {
        e.preventDefault();
        const factor = e.deltaY > 0 ? 0.9 : 1.1;
        const pos    = this._toGraph(e);

        this._scale  = Math.max(0.2, Math.min(4, this._scale * factor));

        // Zoom centrado no cursor
        this._tx = e.clientX - pos.x * this._scale;
        this._ty = e.clientY - pos.y * this._scale;

        this._draw();
    }

    // ── Utilitários ───────────────────────────────────────────────

    _toGraph(e) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left - this._tx) / this._scale,
            y: (e.clientY - rect.top  - this._ty) / this._scale
        };
    }

    _hitNode({ x, y }) {
        return this.nodes.find(n => {
            const dx = n.x - x, dy = n.y - y;
            return Math.sqrt(dx * dx + dy * dy) < 24;
        }) || null;
    }
}
