(function () {
	'use strict';

	// ── Utilitários ──────────────────────────────────────────────────────────

	function esc(str) {
		return String(str)
			.replace(/&/g, '&amp;').replace(/</g, '&lt;')
			.replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
	}

	function shortName(name, maxLen) {
		maxLen = maxLen || 16;
		name = String(name || '');
		return name.length > maxLen ? name.slice(0, maxLen) + '…' : name;
	}

	function naturalCompare(a, b) {
		return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
	}

	function normalizeName(name) {
		name = String(name || '').trim().toLowerCase();
		if (name.indexOf('.') !== -1) name = name.split('.')[0];
		return name.trim();
	}

	function normalizePort(port) {
		if (!port) return '';
		let p = String(port).trim().replace(/\(.*?\)/g, '').trim().replace(/\s+/g, '').toLowerCase();
		p = p.replace(/^twentyfivegigabitethernet/, 'twe').replace(/^twentyfivegige/, 'twe');
		p = p.replace(/^hundredgigabitethernet/, 'hu').replace(/^hundredgige/, 'hu');
		p = p.replace(/^tengigabitethernet/, 'te').replace(/^gigabitethernet/, 'gi');
		p = p.replace(/^fastethernet/, 'fa').replace(/^ethernet/, 'eth').replace(/^port-channel/, 'po');
		return p;
	}

	// ── Parsers de telemetria ────────────────────────────────────────────────

	function interpretStatus(value) {
		const v = String(value || '').trim().toLowerCase();
		if (v === '1' || v.startsWith('up'))   return 'up';
		if (v === '2' || v.startsWith('down')) return 'down';
		return 'unknown';
	}

	function parseStatusItem(item) {
		const host = normalizeName(item.host || '');
		const match = String(item.name || '').match(/^Interface\s+(.+?)\s*(?:\(.*?\)\s*)?:\s*Operational status$/i);
		if (!match) return null;
		const normPort = normalizePort(match[1].trim());
		if (!host || !normPort) return null;
		return { host, normPort, rawIf: match[1].trim(), value: String(item.value || '') };
	}

	function buildStatusMap(items) {
		const map = {};
		(items || []).forEach(function (item) {
			const p = parseStatusItem(item);
			if (!p) return;
			if (!map[p.host]) map[p.host] = {};
			map[p.host][p.normPort] = { status: interpretStatus(p.value), rawIf: p.rawIf, value: p.value };
		});
		return map;
	}

	function getStatusInfo(statusMap, host, port) {
		const h = normalizeName(host || ''), p = normalizePort(port || '');
		if (!h || !p || !statusMap[h]) return null;
		return statusMap[h][p] || null;
	}

	function aggregateMembersStatus(statusMap, members) {
		if (!members || !members.length) return null;
		let anyUp = false, anyDown = false, anyKnown = false;
		members.forEach(function (m) {
			const info = getStatusInfo(statusMap, m.statusHost, m.statusPort);
			if (!info) return;
			anyKnown = true;
			if (info.status === 'up')   anyUp   = true;
			if (info.status === 'down') anyDown = true;
		});
		if (!anyKnown) return null;
		return anyUp ? 'up' : (anyDown ? 'down' : null);
	}

	function parseTrafficItem(item) {
		const host = normalizeName(item.host || '');
		const match = String(item.name || '').match(/^Interface\s+(.+?)\s*(?:\(.*?\)\s*)?:\s*Bits\s+(received|sent)\s*$/i);
		if (!match) return null;
		const normPort  = normalizePort(match[1].trim());
		const direction = match[2].toLowerCase() === 'received' ? 'in' : 'out';
		if (!host || !normPort) return null;
		return { host, normPort, direction, value: parseFloat(item.value), units: String(item.units || '') };
	}

	function buildTrafficMap(items) {
		const map = {};
		(items || []).forEach(function (item) {
			const p = parseTrafficItem(item);
			if (!p) return;
			if (!map[p.host]) map[p.host] = {};
			if (!map[p.host][p.normPort]) map[p.host][p.normPort] = { rawIf: p.rawIf };
			map[p.host][p.normPort][p.direction] = p.value;
			map[p.host][p.normPort].units = p.units || 'bps';
		});
		return map;
	}

	function getTrafficInfo(trafficMap, host, port) {
		const h = normalizeName(host || ''), p = normalizePort(port || '');
		if (!h || !p || !trafficMap[h]) return null;
		return trafficMap[h][p] || null;
	}

	function aggregateMembersTraffic(trafficMap, members) {
		if (!members || !members.length) return null;
		let inSum = 0, outSum = 0, hasIn = false, hasOut = false;
		members.forEach(function (m) {
			const t = getTrafficInfo(trafficMap, m.statusHost, m.statusPort);
			if (!t) return;
			if (typeof t.in === 'number' && isFinite(t.in))   { inSum  += t.in;  hasIn  = true; }
			if (typeof t.out === 'number' && isFinite(t.out)) { outSum += t.out; hasOut = true; }
		});
		if (!hasIn && !hasOut) return null;
		return { in: hasIn ? inSum : null, out: hasOut ? outSum : null };
	}

	function formatBps(value) {
		if (typeof value !== 'number' || !isFinite(value) || value <= 0) return '0 bps';
		const units = ['bps', 'Kbps', 'Mbps', 'Gbps', 'Tbps'];
		let i = 0, v = value;
		while (v >= 1000 && i < units.length - 1) { v /= 1000; i++; }
		return (v >= 100 ? v.toFixed(0) : v.toFixed(2)) + ' ' + units[i];
	}

	function parseSpeedItem(item) {
		const host = normalizeName(item.host || '');
		const match = String(item.name || '').match(/^Interface\s+(.+?)\s*(?:\(.*?\)\s*)?:\s*Speed\s*$/i);
		if (!match) return null;
		const normPort = normalizePort(match[1].trim());
		if (!host || !normPort) return null;
		let bps = parseFloat(item.value);
		const units = String(item.units || '').toLowerCase();
		if (isFinite(bps)) {
			if (units.indexOf('gbps') !== -1 || units.indexOf('gbit') !== -1) bps *= 1e9;
			else if (units.indexOf('mbps') !== -1 || units.indexOf('mbit') !== -1) bps *= 1e6;
			else if (units.indexOf('kbps') !== -1 || units.indexOf('kbit') !== -1) bps *= 1e3;
		}
		return { host, normPort, bps };
	}

	function buildSpeedMap(items) {
		const map = {};
		(items || []).forEach(function (item) {
			const p = parseSpeedItem(item);
			if (!p || !isFinite(p.bps) || p.bps <= 0) return;
			if (!map[p.host]) map[p.host] = {};
			map[p.host][p.normPort] = p.bps;
		});
		return map;
	}

	function getSpeedBps(speedMap, host, port) {
		const h = normalizeName(host || ''), p = normalizePort(port || '');
		if (!h || !p || !speedMap[h]) return null;
		return speedMap[h][p] || null;
	}

	function aggregateMembersUtilization(trafficMap, speedMap, members) {
		if (!members || !members.length) return null;
		let bestPct = -1, peakBps = 0, speedBps = 0;
		members.forEach(function (m) {
			const t  = getTrafficInfo(trafficMap, m.statusHost, m.statusPort);
			const sp = getSpeedBps(speedMap, m.statusHost, m.statusPort);
			if (!t || !sp || sp <= 0) return;
			const peak = Math.max(typeof t.in === 'number' ? t.in : 0, typeof t.out === 'number' ? t.out : 0);
			const pct  = (peak / sp) * 100;
			if (pct > bestPct) { bestPct = pct; peakBps = peak; speedBps = sp; }
		});
		if (bestPct < 0) return null;
		return { pct: bestPct, peakBps, speedBps };
	}

	function colorForUtilization(pct, warnPct, critPct) {
		if (pct >= critPct) return '#ef4444';
		if (pct >= warnPct) return '#facc15';
		return '#22c55e';
	}

	function strokeForUtilization(pct) {
		if (!isFinite(pct) || pct <= 0) return 1.6;
		return Math.min(7, Math.max(1.6, 1.6 + Math.log10(1 + pct) * 2.2));
	}

	// ── Modelo de grafo ──────────────────────────────────────────────────────

	function buildModel(links) {
		const nodesMap = {}, degreeMap = {}, adjacency = {};
		(links || []).forEach(function (link) {
			const s = normalizeName(link.source || ''), t = normalizeName(link.target || '');
			const proto = String(link.protocol || ''), port = String(link.port || '');
			if (!s || !t) return;
			nodesMap[s] = s; nodesMap[t] = t;
			degreeMap[s] = (degreeMap[s] || 0) + 1;
			degreeMap[t] = (degreeMap[t] || 0) + 1;
			if (!adjacency[s]) adjacency[s] = [];
			if (!adjacency[t]) adjacency[t] = [];
			const edge = { protocol: proto, port: port, rawItem: String(link.raw_item || ''), statusHost: t, statusPort: port };
			adjacency[s].push(Object.assign({ peer: t }, edge));
			adjacency[t].push(Object.assign({ peer: s }, edge));
		});
		Object.keys(adjacency).forEach(function (k) {
			adjacency[k].sort(function (a, b) { return naturalCompare(a.peer, b.peer); });
		});
		return { nodes: Object.keys(nodesMap).sort(naturalCompare), degreeMap, adjacency };
	}

	function buildDrillDownSubgraph(adjacency, root, maxLevels) {
		const visited = new Set(), nodeLevels = {};
		const queue = [{ node: root, level: 0 }];
		while (queue.length > 0) {
			const item = queue.shift();
			if (visited.has(item.node)) continue;
			visited.add(item.node);
			nodeLevels[item.node] = item.level;
			if (item.level < maxLevels) {
				(adjacency[item.node] || []).forEach(function (n) {
					if (!visited.has(n.peer)) queue.push({ node: n.peer, level: item.level + 1 });
				});
			}
		}
		const linkIndex = {}, links = [];
		visited.forEach(function (node) {
			(adjacency[node] || []).forEach(function (n) {
				if (!visited.has(n.peer)) return;
				const pairKey = [node, n.peer].sort(naturalCompare).join('|') + '|' + (n.protocol || '');
				const memberKey = (n.statusHost || '') + '|' + (n.statusPort || '');
				let entry = linkIndex[pairKey];
				if (!entry) {
					entry = { source: node, target: n.peer, protocol: n.protocol || '', port: n.port || '',
						statusHost: n.statusHost || '', statusPort: n.statusPort || '', members: [], _seen: {} };
					linkIndex[pairKey] = entry; links.push(entry);
				}
				if (!entry._seen[memberKey] && n.statusHost) {
					entry._seen[memberKey] = true;
					entry.members.push({ statusHost: n.statusHost, statusPort: n.statusPort });
				}
			});
		});
		links.forEach(function (l) { delete l._seen; });
		return { nodes: Array.from(visited).sort(naturalCompare), links: links, nodeLevels: nodeLevels };
	}

	// ── Anchors / ownership ──────────────────────────────────────────────────

	function anchorGroupKey(name) {
		let base = normalizeName(name).replace(/[-_.]?\d+$/, '').replace(/[-_.]+$/, '');
		return base || normalizeName(name);
	}

	function groupAnchorsBySimilarity(anchors) {
		const map = {};
		anchors.forEach(function (a) {
			const k = anchorGroupKey(a);
			if (!map[k]) map[k] = [];
			map[k].push(a);
		});
		return Object.keys(map).sort(naturalCompare).map(function (k) {
			return { key: k, anchors: map[k].sort(naturalCompare) };
		});
	}

	function buildAnchorOwnership(model, anchors) {
		const ownership = {}, anchorSet = new Set(anchors), ownerLoad = {};
		anchors.forEach(function (a) { ownership[a] = a; ownerLoad[a] = 0; });
		model.nodes.forEach(function (node) {
			if (anchorSet.has(node)) return;
			const neighbors = model.adjacency[node] || [];
			const directAnchors = [], seen = {};
			neighbors.forEach(function (n) {
				if (anchorSet.has(n.peer) && !seen[n.peer]) { seen[n.peer] = true; directAnchors.push(n.peer); }
			});
			if (directAnchors.length > 0) {
				directAnchors.sort(function (a, b) {
					if (ownerLoad[a] !== ownerLoad[b]) return ownerLoad[a] - ownerLoad[b];
					return naturalCompare(a, b);
				});
				ownership[node] = directAnchors[0];
				ownerLoad[directAnchors[0]] += 1;
			}
		});
		return ownership;
	}

	function buildCollapsedVisibleGraph(model, anchors, ownership) {
		const visibleNodes = anchors.slice().sort(naturalCompare);
		const visibleLinks = [], linkIndex = {};
		model.nodes.forEach(function (node) {
			(model.adjacency[node] || []).forEach(function (n) {
				const a = ownership[node], b = ownership[n.peer];
				if (!a || !b || a === b) return;
				const pairKey = [a, b].sort(naturalCompare).join('|') + '|' + (n.protocol || '');
				const memberKey = (n.statusHost || '') + '|' + (n.statusPort || '');
				let entry = linkIndex[pairKey];
				if (!entry) {
					entry = { source: a, target: b, protocol: n.protocol || '', port: '', statusHost: '', statusPort: '', members: [], _seen: {} };
					linkIndex[pairKey] = entry; visibleLinks.push(entry);
				}
				if (!entry._seen[memberKey] && n.statusHost) {
					entry._seen[memberKey] = true;
					entry.members.push({ statusHost: n.statusHost, statusPort: n.statusPort });
				}
			});
		});
		visibleLinks.forEach(function (l) { delete l._seen; });
		return { nodes: visibleNodes, links: visibleLinks };
	}

	function buildExpandedVisibleGraph(model, anchors, expandedState, ownership) {
		const visibleNodes = new Set(), visibleLinks = [], linkIndex = {};
		anchors.forEach(function (a) { visibleNodes.add(a); });
		model.nodes.forEach(function (node) {
			const owner = ownership[node];
			if (owner && node !== owner && expandedState[owner]) visibleNodes.add(node);
		});
		model.nodes.forEach(function (node) {
			(model.adjacency[node] || []).forEach(function (n) {
				let src = node, tgt = n.peer;
				const ownerA = ownership[node], ownerB = ownership[n.peer];
				if (!ownerA || !ownerB) return;
				if (node !== ownerA && !expandedState[ownerA]) src = ownerA;
				if (n.peer !== ownerB && !expandedState[ownerB]) tgt = ownerB;
				if (src === tgt || !visibleNodes.has(src) || !visibleNodes.has(tgt)) return;
				const isAgg = src === ownerA && tgt === ownerB;
				const pairKey = [src, tgt].sort(naturalCompare).join('|') + '|' + (n.protocol || '') + '|' + (isAgg ? 'agg' : (n.port || ''));
				const memberKey = (n.statusHost || '') + '|' + (n.statusPort || '');
				let entry = linkIndex[pairKey];
				if (!entry) {
					entry = { source: src, target: tgt, protocol: n.protocol || '', port: isAgg ? '' : (n.port || ''),
						statusHost: isAgg ? '' : (n.statusHost || ''), statusPort: isAgg ? '' : (n.statusPort || ''),
						members: [], _seen: {} };
					linkIndex[pairKey] = entry; visibleLinks.push(entry);
				}
				if (!entry._seen[memberKey] && n.statusHost) {
					entry._seen[memberKey] = true;
					entry.members.push({ statusHost: n.statusHost, statusPort: n.statusPort });
				}
			});
		});
		visibleLinks.forEach(function (l) { delete l._seen; });
		return { nodes: Array.from(visibleNodes).sort(naturalCompare), links: visibleLinks };
	}

	// ── Layout ───────────────────────────────────────────────────────────────

	function layoutCollapsedAnchors(anchors, width, height) {
		const positions = {};
		const groups = groupAnchorsBySimilarity(anchors);
		const ordered = [];
		groups.forEach(function (g) { g.anchors.forEach(function (a) { ordered.push(a); }); });
		const cx = width / 2, cy = height * 0.53;
		const rx = Math.min(430, Math.max(240, width * 0.24));
		const ry = Math.min(260, Math.max(150, height * 0.18));
		if (ordered.length === 1) { positions[ordered[0]] = { x: cx, y: cy }; return positions; }
		const gapUnits = 0.9;
		let totalUnits = 0;
		groups.forEach(function (g, i) { totalUnits += g.anchors.length; if (i < groups.length - 1) totalUnits += gapUnits; });
		let cursor = 0;
		const startAngle = -Math.PI / 2;
		groups.forEach(function (g, gi) {
			g.anchors.forEach(function (anchor) {
				const angle = startAngle + ((cursor / totalUnits) * Math.PI * 2);
				positions[anchor] = { x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry };
				cursor += 1;
			});
			if (gi < groups.length - 1) cursor += gapUnits;
		});
		return positions;
	}

	function layoutExpandedGraph(model, anchors, expandedState, ownership, width, height, savedPositions) {
		const positions = layoutCollapsedAnchors(anchors, width, height);
		const cx = width / 2, cy = height * 0.53;
		const anchorSet = new Set(anchors);
		if (savedPositions) {
			anchors.forEach(function (a) {
				if (savedPositions[a]) positions[a] = { x: savedPositions[a].x, y: savedPositions[a].y };
			});
		}
		function placeFan(children, anchorPos, baseAngle, maxSpread, chunkSize, baseRadius, radiusStep) {
			if (!children.length) return;
			maxSpread   = maxSpread   || 165;
			chunkSize   = chunkSize   || 10;
			baseRadius  = baseRadius  || 170;
			radiusStep  = radiusStep  || 80;
			for (let i = 0; i < children.length; i += chunkSize) {
				const chunk = children.slice(i, i + chunkSize);
				const radius = baseRadius + Math.floor(i / chunkSize) * radiusStep;
				const spread = Math.min(maxSpread, 50 + chunk.length * 7);
				const half   = (spread / 2) * Math.PI / 180;
				if (chunk.length === 1) {
					positions[chunk[0]] = { x: anchorPos.x + Math.cos(baseAngle) * radius, y: anchorPos.y + Math.sin(baseAngle) * radius };
				} else {
					chunk.forEach(function (node, idx) {
						const t = idx / (chunk.length - 1);
						const ang = baseAngle - half + (half * 2 * t);
						positions[node] = { x: anchorPos.x + Math.cos(ang) * radius, y: anchorPos.y + Math.sin(ang) * radius };
					});
				}
			}
		}
		anchors.forEach(function (anchor) {
			if (!expandedState[anchor]) return;
			const apos = positions[anchor];
			const owned = model.nodes.filter(function (n) {
				return n !== anchor && ownership[n] === anchor;
			}).sort(function (a, b) {
				const da = model.degreeMap[a] || 0, db = model.degreeMap[b] || 0;
				return db !== da ? db - da : naturalCompare(a, b);
			});
			const purelyOwned = [], sharedByOther = {};
			owned.forEach(function (child) {
				const otherAnchors = (model.adjacency[child] || [])
					.map(function (p) { return p.peer; })
					.filter(function (p) { return p !== anchor && anchorSet.has(p); });
				if (otherAnchors.length === 0) {
					purelyOwned.push(child);
				} else {
					otherAnchors.sort(naturalCompare);
					const primary = otherAnchors[0];
					if (!sharedByOther[primary]) sharedByOther[primary] = [];
					sharedByOther[primary].push(child);
				}
			});
			const outward = Math.atan2(apos.y - cy, apos.x - cx);
			placeFan(purelyOwned, apos, outward);
			Object.keys(sharedByOther).forEach(function (other) {
				const opos = positions[other];
				if (!opos) return;
				const ddx = opos.x - apos.x, ddy = opos.y - apos.y;
				const dist = Math.hypot(ddx, ddy) || 1;
				const angleToOther = Math.atan2(ddy, ddx);
				const baseR = Math.max(140, Math.min(dist * 0.35, 260));
				placeFan(sharedByOther[other], apos, angleToOther, 60, 8, baseR, 70);
			});
		});
		return positions;
	}

	function layoutDrillDown(root, nodeLevels, nodes, width, height) {
		const positions = {}, cx = width / 2, cy = height / 2;
		const byLevel = {};
		nodes.forEach(function (node) {
			const level = nodeLevels[node] !== undefined ? nodeLevels[node] : 0;
			if (!byLevel[level]) byLevel[level] = [];
			byLevel[level].push(node);
		});
		positions[root] = { x: cx, y: cy };
		Object.keys(byLevel).forEach(function (ls) {
			const level = parseInt(ls, 10);
			if (level === 0) return;
			const nodesAtLevel = byLevel[level].slice().sort(naturalCompare);
			const radius = 190 + (level - 1) * 210;
			nodesAtLevel.forEach(function (node, idx) {
				const angle = -Math.PI / 2 + (idx / nodesAtLevel.length) * Math.PI * 2;
				positions[node] = { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
			});
		});
		return positions;
	}

	// ── Popup de detalhes ────────────────────────────────────────────────────

	function renderPopupContent(node, model, hostLevels, statusMap, trafficMap, speedMap, unmanagedSet, utilWarnPct, utilCritPct) {
		const neighbors = (model.adjacency[node] || []).slice().sort(function (a, b) { return naturalCompare(a.peer, b.peer); });
		const degree = model.degreeMap[node] || 0;
		const level  = (hostLevels && Object.prototype.hasOwnProperty.call(hostLevels, node)) ? hostLevels[node] : null;
		const isUnmanaged = unmanagedSet.has(node);
		let tier = 'Borda';
		if (degree >= 4) tier = 'Core'; else if (degree >= 2) tier = 'Distribuição';
		let html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">';
		html += '<div style="font-size:17px;font-weight:700;">' + esc(node) + '</div>';
		html += '<button type="button" class="topo-popup-close" style="background:#1f2937;color:#e5e7eb;border:1px solid #374151;border-radius:6px;padding:4px 8px;cursor:pointer;">Fechar</button>';
		html += '</div>';
		if (isUnmanaged) html += '<div style="margin-bottom:8px;padding:6px 8px;background:#1e293b;border:1px dashed #94a3b8;border-radius:6px;color:#fbbf24;">⚠ Host não cadastrado no Zabbix.</div>';
		html += '<div style="margin-bottom:8px;"><strong>Camada:</strong> ' + esc(tier) + '</div>';
		html += '<div style="margin-bottom:8px;"><strong>Grau:</strong> ' + degree + '</div>';
		html += '<div style="margin-bottom:12px;"><strong>Nível:</strong> ' + (level === null ? '—' : ('N' + level)) + '</div>';
		html += '<div style="font-size:14px;font-weight:700;margin-bottom:8px;">Conexões</div>';
		html += '<div style="max-height:280px;overflow:auto;border-top:1px solid #1f2937;padding-top:8px;">';
		neighbors.forEach(function (n) {
			const info    = getStatusInfo(statusMap, n.statusHost, n.statusPort);
			const status  = info ? info.status : null;
			const sColor  = status === 'up' ? '#22c55e' : status === 'down' ? '#ef4444' : '#94a3b8';
			const traffic = getTrafficInfo(trafficMap, n.statusHost, n.statusPort);
			const speed   = getSpeedBps(speedMap, n.statusHost, n.statusPort);
			html += '<div style="padding:8px 0;border-bottom:1px solid #1f2937;">';
			html += '<div style="font-weight:600;">' + esc(n.peer) + (unmanagedSet.has(n.peer) ? ' <span style="color:#fbbf24;">(?) </span>' : '') + '</div>';
			html += '<div style="font-size:12px;color:#cbd5e1;">Protocolo: ' + esc(n.protocol || '-') + '</div>';
			html += '<div style="font-size:12px;color:#cbd5e1;">Porta: ' + esc(n.port || '-') + '</div>';
			if (status) html += '<div style="font-size:12px;color:' + sColor + ';font-weight:600;">Status: ' + esc(status) + '</div>';
			if (traffic && (typeof traffic.in === 'number' || typeof traffic.out === 'number')) {
				html += '<div style="font-size:12px;color:#a7f3d0;">↓ ' + esc(formatBps(traffic.in || 0)) + ' ↑ ' + esc(formatBps(traffic.out || 0)) + '</div>';
			}
			if (speed && traffic) {
				const peak = Math.max(traffic.in || 0, traffic.out || 0);
				const pct  = (peak / speed) * 100;
				html += '<div style="font-size:12px;color:' + colorForUtilization(pct, utilWarnPct, utilCritPct) + ';font-weight:600;">Util: ' + pct.toFixed(1) + '%</div>';
			}
			html += '</div>';
		});
		html += '</div>';
		return html;
	}

	// ── Drag helpers ─────────────────────────────────────────────────────────

	function clientDeltaToSvg(svgEl, x1, y1, x2, y2) {
		const rect = svgEl.getBoundingClientRect();
		const vb   = svgEl.viewBox.baseVal;
		const scale = Math.max(vb.width / rect.width, vb.height / rect.height);
		return { dx: (x2 - x1) * scale, dy: (y2 - y1) * scale };
	}

	function buildMoveGroup(model, startNode, anchorSet, visibleNodesSet) {
		const visited = new Set(), moveSet = new Set();
		function walk(node) {
			if (visited.has(node) || !visibleNodesSet.has(node)) return;
			visited.add(node); moveSet.add(node);
			const nodeDeg = model.degreeMap[node] || 0;
			(model.adjacency[node] || []).forEach(function (n) {
				const peer = n.peer;
				if (!visibleNodesSet.has(peer)) return;
				if (anchorSet.has(peer) && peer !== startNode) return;
				if ((model.degreeMap[peer] || 0) <= nodeDeg) walk(peer);
			});
		}
		walk(startNode);
		return Array.from(moveSet);
	}

	// ── Inicialização da página ──────────────────────────────────────────────

	function initTopologyMap() {
		const rootEl = document.getElementById('topology-map-root');
		if (!rootEl) return;

		const graphEl  = document.getElementById('topology-graph');
		const popupEl  = document.getElementById('topology-popup');
		const resetBtn = document.getElementById('topology-reset-btn');
		const backBtn  = document.getElementById('topology-back-btn');
		if (!graphEl || !popupEl) return;

		// Decodifica dados do backend
		function decode(attr, fallback) {
			try { return JSON.parse(atob(rootEl.dataset[attr] || '')); }
			catch (e) { return fallback; }
		}

		const allLinks     = decode('links',    []);
		const hostLevels   = decode('levels',   {});
		const statusItems  = decode('statuses', []);
		const trafficItems = decode('traffic',  []);
		const speedItems   = decode('speed',    []);
		const unmanagedArr = decode('unmanaged',[]);
		const config       = decode('config',   {});

		const utilWarnPct  = parseInt(config.util_warn_pct, 10) || 60;
		const utilCritPct  = parseInt(config.util_crit_pct, 10) || 85;
		const maxLevels    = parseInt(config.max_levels,    10) || 2;

		const unmanagedSet = new Set((unmanagedArr || []).map(normalizeName));
		const statusMap    = buildStatusMap(statusItems);
		const trafficMap   = buildTrafficMap(trafficItems);
		const speedMap     = buildSpeedMap(speedItems);
		const model        = buildModel(allLinks);

		// Garante hosts de nível 0 no modelo
		const nodesInModel = new Set(model.nodes);
		Object.keys(hostLevels).forEach(function (n) {
			if (hostLevels[n] === 0 && !nodesInModel.has(n)) {
				model.nodes.push(n);
				nodesInModel.add(n);
				if (!model.adjacency[n]) model.adjacency[n] = [];
				if (!model.degreeMap[n]) model.degreeMap[n] = 0;
			}
		});
		model.nodes.sort(naturalCompare);

		const lvl0Anchors = Object.keys(hostLevels).filter(function (n) {
			return hostLevels[n] === 0 && nodesInModel.has(n);
		});
		const anchors = lvl0Anchors.length
			? lvl0Anchors
			: model.nodes.filter(function (n) { return (model.degreeMap[n] || 0) >= 4; });

		const groupId    = rootEl.dataset.groupId || 'default';
		const storageKey = 'automap:layout:' + groupId + ':' + anchors.slice().sort(naturalCompare).join('|');
		const viewKey    = storageKey + ':vb';

		function loadJSON(key) {
			try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : null; } catch (e) { return null; }
		}
		function saveJSON(key, val) {
			try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
		}

		const savedPositions = loadJSON(storageKey) || {};
		const expandedState  = loadJSON(storageKey + ':exp') || {};
		anchors.forEach(function (a) { if (typeof expandedState[a] === 'undefined') expandedState[a] = false; });

		const VIEW_W = 1800, VIEW_H = 1100;
		let viewBox  = loadJSON(viewKey) || { x: 0, y: 0, w: VIEW_W, h: VIEW_H };

		let selectedNode = '';
		let drillDownNode = null, drillDownData = null;
		let framePending = false, dragState = null, suppressClickUntil = 0;
		const ownership = buildAnchorOwnership(model, anchors);

		function scheduleDraw() {
			if (framePending) return;
			framePending = true;
			window.requestAnimationFrame(function () { framePending = false; draw(); });
		}

		function saveViewBox() { saveJSON(viewKey, viewBox); }

		function setSvgViewBox() {
			const svgEl = graphEl.querySelector('svg');
			if (svgEl) svgEl.setAttribute('viewBox', viewBox.x + ' ' + viewBox.y + ' ' + viewBox.w + ' ' + viewBox.h);
		}

		function hidePopup() { if (popupEl) popupEl.style.display = 'none'; }

		function showPopup(html, clientX, clientY) {
			const rootRect = rootEl.getBoundingClientRect();
			let left = clientX - rootRect.left + 12, top = clientY - rootRect.top + 12;
			const pw = 320, ph = 360;
			if (left + pw > rootRect.width  - 12) left = rootRect.width  - pw - 12;
			if (top  + ph > rootRect.height - 12) top  = rootRect.height - ph - 12;
			if (left < 12) left = 12; if (top < 12) top = 12;
			popupEl.innerHTML = html;
			popupEl.style.left = left + 'px'; popupEl.style.top = top + 'px'; popupEl.style.display = 'block';
			const closeBtn = popupEl.querySelector('.topo-popup-close');
			if (closeBtn) closeBtn.addEventListener('click', function (e) { e.stopPropagation(); hidePopup(); });
		}

		function clearFocus() {
			hidePopup();
			if (drillDownNode) { drillDownNode = null; drillDownData = null; viewBox = { x: 0, y: 0, w: VIEW_W, h: VIEW_H }; }
			selectedNode = '';
			if (backBtn) backBtn.style.display = 'none';
			scheduleDraw();
		}

		function applyDragUpdate(moveNodes) {
			if (!moveNodes || !moveNodes.length) return;
			const moveSet = new Set(moveNodes);
			moveNodes.forEach(function (node) {
				const pos = savedPositions[node]; if (!pos) return;
				const g = graphEl.querySelector('.topo-node[data-node="' + CSS.escape(node) + '"]'); if (!g) return;
				const circle = g.querySelector('.topo-node-circle');
				const halo   = g.querySelector('.topo-node-halo');
				const letter = g.querySelector('.topo-node-letter');
				const label  = g.querySelector('.topo-node-label');
				if (circle) { circle.setAttribute('cx', pos.x); circle.setAttribute('cy', pos.y); }
				if (halo)   { halo.setAttribute('cx', pos.x);   halo.setAttribute('cy', pos.y);   }
				if (letter) { letter.setAttribute('x', pos.x);  letter.setAttribute('y', pos.y + 4); }
				if (label)  { label.setAttribute('x', pos.x);   label.setAttribute('y', pos.y + (parseFloat(label.dataset.r) || 19) + 18); }
				const toggle = g.querySelector('.topo-toggle');
				if (toggle) {
					const r = parseFloat(toggle.dataset.r) || 30;
					const tc = toggle.querySelector('.topo-toggle-circle'), tt = toggle.querySelector('.topo-toggle-text');
					if (tc) { tc.setAttribute('cx', pos.x + r - 2); tc.setAttribute('cy', pos.y - r + 2); }
					if (tt) { tt.setAttribute('x', pos.x + r - 2);  tt.setAttribute('y', pos.y - r + 6);  }
				}
			});
			graphEl.querySelectorAll('.topo-link-line,.topo-link-hit').forEach(function (line) {
				const src = line.getAttribute('data-src'), tgt = line.getAttribute('data-tgt');
				if (moveSet.has(src)) { const p = savedPositions[src]; if (p) { line.setAttribute('x1', p.x); line.setAttribute('y1', p.y); } }
				if (moveSet.has(tgt)) { const p = savedPositions[tgt]; if (p) { line.setAttribute('x2', p.x); line.setAttribute('y2', p.y); } }
			});
		}

		// ── Draw principal ───────────────────────────────────────────────────

		function draw() {
			const W = 1800, H = 1100;
			let visible, positions, effectiveNodeLevels;
			let effectiveStatusMap = statusMap, effectiveTrafficMap = trafficMap;
			let effectiveSpeedMap = speedMap, effectiveUnmanagedSet = unmanagedSet;

			if (drillDownNode) {
				if (drillDownData && !drillDownData.error) {
					const sub = buildDrillDownSubgraph(drillDownData.model.adjacency, drillDownNode, 99);
					effectiveNodeLevels    = drillDownData.hostLevels;
					effectiveStatusMap     = drillDownData.statusMap;
					effectiveTrafficMap    = drillDownData.trafficMap;
					effectiveSpeedMap      = drillDownData.speedMap;
					effectiveUnmanagedSet  = drillDownData.unmanagedSet;
					visible   = { nodes: sub.nodes, links: sub.links };
					positions = layoutDrillDown(drillDownNode, drillDownData.hostLevels, sub.nodes, W, H);
				} else {
					effectiveNodeLevels = {}; effectiveNodeLevels[drillDownNode] = 0;
					visible   = { nodes: [drillDownNode], links: [] };
					positions = {}; positions[drillDownNode] = { x: W / 2, y: H / 2 };
				}
				if (backBtn) backBtn.style.display = 'block';
			} else {
				effectiveNodeLevels = hostLevels;
				const anyExpanded = anchors.some(function (a) { return expandedState[a]; });
				visible   = anyExpanded
					? buildExpandedVisibleGraph(model, anchors, expandedState, ownership)
					: buildCollapsedVisibleGraph(model, anchors, ownership);
				positions = anyExpanded
					? layoutExpandedGraph(model, anchors, expandedState, ownership, W, H, savedPositions)
					: layoutCollapsedAnchors(anchors, W, H);
				Object.keys(savedPositions).forEach(function (node) {
					if (positions[node]) positions[node] = { x: savedPositions[node].x, y: savedPositions[node].y };
				});
				if (backBtn) backBtn.style.display = 'none';
			}

			const visibleNodesSet = new Set(visible.nodes);
			const anchorSet = drillDownNode ? new Set([drillDownNode]) : new Set(anchors);

			let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"'
				+ ' viewBox="' + viewBox.x + ' ' + viewBox.y + ' ' + viewBox.w + ' ' + viewBox.h + '"'
				+ ' preserveAspectRatio="xMidYMid meet"'
				+ ' style="display:block;width:100%;height:100%;user-select:none;">';
			svg += '<rect class="topo-bg" x="-100000" y="-100000" width="200000" height="200000" fill="#0f172a" pointer-events="all"/>';

			if (drillDownNode) {
				svg += '<text x="900" y="42" fill="#93c5fd" font-size="15" font-weight="700" text-anchor="middle" font-family="Arial,sans-serif" pointer-events="none">Visão de: ' + esc(drillDownNode) + '</text>';
				if (!drillDownData)           svg += '<text x="900" y="64" fill="#64748b" font-size="12" text-anchor="middle" font-family="Arial,sans-serif" pointer-events="none">Buscando vizinhos…</text>';
				else if (drillDownData.error) svg += '<text x="900" y="64" fill="#ef4444" font-size="12" text-anchor="middle" font-family="Arial,sans-serif" pointer-events="none">Erro ao buscar vizinhos. Use ← Voltar.</text>';
			}

			// Links
			visible.links.forEach(function (link, linkIdx) {
				const s = link.source, t = link.target;
				if (!positions[s] || !positions[t]) return;
				const active = !selectedNode || s === selectedNode || t === selectedNode;
				let aggStatus = aggregateMembersStatus(effectiveStatusMap, link.members);
				if (!aggStatus && link.statusHost) {
					const si = getStatusInfo(effectiveStatusMap, link.statusHost, link.statusPort);
					if (si) aggStatus = si.status;
				}
				const util = aggregateMembersUtilization(effectiveTrafficMap, effectiveSpeedMap, link.members);
				let color = '#60a5fa', dash = '';
				if (String(link.protocol || '').toUpperCase() === 'LLDP') { color = '#34d399'; dash = ' stroke-dasharray="6 3"'; }
				if (aggStatus === 'down') { color = '#ef4444'; dash = ' stroke-dasharray="8 4"'; }
				else if (aggStatus === 'up') { color = util ? colorForUtilization(util.pct, utilWarnPct, utilCritPct) : '#22c55e'; dash = ''; }
				let sw = active ? 2.6 : 1.2;
				if (util) { sw = strokeForUtilization(util.pct); if (!active) sw = Math.max(1.2, sw * 0.5); }
				const opacity = active ? 0.92 : 0.2;
				const x1 = positions[s].x, y1 = positions[s].y, x2 = positions[t].x, y2 = positions[t].y;
				svg += '<line class="topo-link-line" data-src="' + esc(s) + '" data-tgt="' + esc(t) + '"'
					+ ' x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '"'
					+ ' stroke="' + color + '" stroke-width="' + sw + '" opacity="' + opacity + '"' + dash + ' pointer-events="none"/>';
				svg += '<line class="topo-link-hit" data-link-idx="' + linkIdx + '" data-src="' + esc(s) + '" data-tgt="' + esc(t) + '"'
					+ ' x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '"'
					+ ' stroke="#000" stroke-opacity="0" stroke-width="14" pointer-events="stroke" style="cursor:help;"/>';
			});

			// Nós
			visible.nodes.forEach(function (node) {
				if (!positions[node]) return;
				const isCentral   = anchorSet.has(node);
				const isExpanded  = !!expandedState[node];
				const isSelected  = selectedNode === node;
				const isNeighbor  = selectedNode && (model.adjacency[selectedNode] || []).some(function (n) { return n.peer === node; });
				const isUnmanaged = effectiveUnmanagedSet.has(node);
				const level       = (effectiveNodeLevels && Object.prototype.hasOwnProperty.call(effectiveNodeLevels, node)) ? effectiveNodeLevels[node] : null;
				const fills = ['#2563eb', '#0891b2', '#7c3aed', '#475569', '#334155', '#1e293b'];
				let fill = isCentral ? fills[0] : (level !== null && level >= 1 ? fills[Math.min(level, fills.length - 1)] : '#475569');
				if (isUnmanaged) fill = '#1f2937';
				const radius  = isCentral ? 30 : 19;
				let nodeOpacity = 1;
				if (selectedNode && !isSelected && !isNeighbor) nodeOpacity = 0.25;
				let stroke = isCentral ? '#fbbf24' : '#ffffff', strokeWidth = isCentral ? 3 : 2, strokeDash = '';
				if (isUnmanaged) { stroke = '#94a3b8'; strokeWidth = 2; strokeDash = ' stroke-dasharray="4 3"'; }
				if (isSelected)  { stroke = '#facc15'; strokeWidth = 5; strokeDash = ''; }
				const x = positions[node].x, y = positions[node].y;
				const letter = isUnmanaged ? '?' : (isCentral ? 'C' : 'R');
				svg += '<g class="topo-node" data-node="' + esc(node) + '" style="cursor:grab;">';
				if (isCentral && !isUnmanaged) svg += '<circle class="topo-node-halo" cx="' + x + '" cy="' + y + '" r="' + (radius + 6) + '" fill="none" stroke="#fbbf24" stroke-width="1.5" opacity="' + (nodeOpacity * 0.45) + '"/>';
				svg += '<circle class="topo-node-circle" cx="' + x + '" cy="' + y + '" r="' + radius + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + strokeWidth + '"' + strokeDash + ' opacity="' + nodeOpacity + '"/>';
				svg += '<text class="topo-node-letter" x="' + x + '" y="' + (y + 4) + '" fill="#fff" font-size="' + (isCentral ? 13 : 11) + '" font-weight="700" text-anchor="middle" font-family="Arial,sans-serif" opacity="' + nodeOpacity + '">' + letter + '</text>';
				svg += '<text class="topo-node-label" data-r="' + radius + '" x="' + x + '" y="' + (y + radius + 18) + '" fill="' + (isUnmanaged ? '#94a3b8' : (isCentral ? '#fde68a' : '#e2e8f0')) + '" font-size="' + (isCentral ? 12 : 11) + '" font-weight="' + (isCentral ? 700 : 400) + '" text-anchor="middle" font-family="Arial,sans-serif" opacity="' + nodeOpacity + '">' + esc(shortName(node, 16)) + (isUnmanaged ? ' (?)' : '') + '</text>';
				if (isCentral && !drillDownNode) {
					svg += '<g class="topo-toggle" data-node="' + esc(node) + '" data-r="' + radius + '" style="cursor:pointer;">';
					svg += '<circle class="topo-toggle-circle" cx="' + (x + radius - 2) + '" cy="' + (y - radius + 2) + '" r="11" fill="#111827" stroke="#94a3b8" stroke-width="1.5"/>';
					svg += '<text class="topo-toggle-text" x="' + (x + radius - 2) + '" y="' + (y - radius + 6) + '" fill="#f8fafc" font-size="14" text-anchor="middle" font-family="Arial,sans-serif" font-weight="700">' + (isExpanded ? '−' : '+') + '</text>';
					svg += '</g>';
				}
				svg += '</g>';
			});

			// Legenda
			const lw = 240, lh = 84, lx = 1800 - lw - 10, ly = 1100 - lh - 10;
			svg += '<g class="topo-legend" pointer-events="none" font-family="Arial,sans-serif">';
			svg += '<rect x="' + lx + '" y="' + ly + '" width="' + lw + '" height="' + lh + '" rx="6" fill="#0b1220" stroke="#334155" stroke-width="1" opacity="0.92"/>';
			svg += '<text x="' + (lx + 10) + '" y="' + (ly + 16) + '" fill="#e2e8f0" font-size="11" font-weight="700">Linhas</text>';
			svg += '<line x1="' + (lx + 10) + '" y1="' + (ly + 30) + '" x2="' + (lx + 30) + '" y2="' + (ly + 30) + '" stroke="#22c55e" stroke-width="3"/><text x="' + (lx + 36) + '" y="' + (ly + 33) + '" fill="#cbd5e1" font-size="10">UP &lt; ' + utilWarnPct + '%</text>';
			svg += '<line x1="' + (lx + 110) + '" y1="' + (ly + 30) + '" x2="' + (lx + 130) + '" y2="' + (ly + 30) + '" stroke="#facc15" stroke-width="3"/><text x="' + (lx + 136) + '" y="' + (ly + 33) + '" fill="#cbd5e1" font-size="10">' + utilWarnPct + '–' + utilCritPct + '%</text>';
			svg += '<line x1="' + (lx + 10) + '" y1="' + (ly + 46) + '" x2="' + (lx + 30) + '" y2="' + (ly + 46) + '" stroke="#ef4444" stroke-width="3"/><text x="' + (lx + 36) + '" y="' + (ly + 49) + '" fill="#cbd5e1" font-size="10">≥ ' + utilCritPct + '%</text>';
			svg += '<line x1="' + (lx + 110) + '" y1="' + (ly + 46) + '" x2="' + (lx + 130) + '" y2="' + (ly + 46) + '" stroke="#ef4444" stroke-width="3" stroke-dasharray="6 4"/><text x="' + (lx + 136) + '" y="' + (ly + 49) + '" fill="#cbd5e1" font-size="10">DOWN</text>';
			svg += '<circle cx="' + (lx + 18) + '" cy="' + (ly + 68) + '" r="7" fill="#1f2937" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="3 2"/>';
			svg += '<text x="' + (lx + 18) + '" y="' + (ly + 71) + '" fill="#fbbf24" font-size="9" font-weight="700" text-anchor="middle">?</text>';
			svg += '<text x="' + (lx + 32) + '" y="' + (ly + 71) + '" fill="#cbd5e1" font-size="10">Não cadastrado</text>';
			svg += '</g>';
			svg += '</svg>';
			graphEl.innerHTML = svg;

			// ── Eventos do SVG ────────────────────────────────────────────────

			const svgEl = graphEl.querySelector('svg');
			if (!svgEl) return;

			function screenToSvg(cx, cy) {
				const rect = svgEl.getBoundingClientRect();
				if (!rect.width || !rect.height) return { x: viewBox.x, y: viewBox.y };
				const scale = Math.min(rect.width / viewBox.w, rect.height / viewBox.h);
				const rendW = viewBox.w * scale, rendH = viewBox.h * scale;
				const offX  = (rect.width - rendW) / 2, offY = (rect.height - rendH) / 2;
				return { x: viewBox.x + (cx - rect.left - offX) / scale, y: viewBox.y + (cy - rect.top - offY) / scale };
			}

			// Zoom
			svgEl.addEventListener('wheel', function (e) {
				e.preventDefault();
				const factor = e.deltaY < 0 ? (1 / 1.15) : 1.15;
				const newW = Math.max(200, Math.min(VIEW_W * 6, viewBox.w * factor));
				const newH = Math.max(200, Math.min(VIEW_H * 6, viewBox.h * factor));
				const pt = screenToSvg(e.clientX, e.clientY);
				const rx = (pt.x - viewBox.x) / viewBox.w, ry = (pt.y - viewBox.y) / viewBox.h;
				viewBox = { x: pt.x - rx * newW, y: pt.y - ry * newH, w: newW, h: newH };
				setSvgViewBox(); saveViewBox();
			}, { passive: false });

			// Pan
			let panState = null;
			svgEl.addEventListener('pointerdown', function (e) {
				if (!e.target || !e.target.classList.contains('topo-bg')) return;
				e.preventDefault();
				panState = { pid: e.pointerId, sx: e.clientX, sy: e.clientY, ovb: { x: viewBox.x, y: viewBox.y }, moved: false };
				try { svgEl.setPointerCapture(e.pointerId); } catch (_) {}
				svgEl.style.cursor = 'grabbing';
			});
			svgEl.addEventListener('pointermove', function (e) {
				if (!panState || panState.pid !== e.pointerId) return;
				const rect = svgEl.getBoundingClientRect();
				const scale = Math.min(rect.width / viewBox.w, rect.height / viewBox.h);
				if (!scale) return;
				viewBox.x = panState.ovb.x - (e.clientX - panState.sx) / scale;
				viewBox.y = panState.ovb.y - (e.clientY - panState.sy) / scale;
				if (Math.abs(e.clientX - panState.sx) > 2 || Math.abs(e.clientY - panState.sy) > 2) panState.moved = true;
				setSvgViewBox();
			});
			function endPan(e) {
				if (!panState || panState.pid !== e.pointerId) return;
				try { svgEl.releasePointerCapture(e.pointerId); } catch (_) {}
				svgEl.style.cursor = '';
				if (panState.moved) suppressClickUntil = Date.now() + 220;
				panState = null; saveViewBox();
			}
			svgEl.addEventListener('pointerup', endPan);
			svgEl.addEventListener('pointercancel', endPan);

			// Tooltip de links
			let tooltipEl = rootEl.querySelector('.topo-link-tooltip');
			if (!tooltipEl) {
				tooltipEl = document.createElement('div');
				tooltipEl.className = 'topo-link-tooltip';
				tooltipEl.style.cssText = 'display:none;position:absolute;z-index:40;pointer-events:none;background:#0b1220;color:#e5e7eb;border:1px solid #334155;border-radius:6px;padding:6px 9px;font-size:12px;font-family:Arial,sans-serif;box-shadow:0 6px 16px rgba(0,0,0,.4);max-width:340px;line-height:1.45;';
				rootEl.appendChild(tooltipEl);
			}
			function hideTip() { tooltipEl.style.display = 'none'; }
			function moveTip(cx, cy) {
				const rr = rootEl.getBoundingClientRect(), tr = tooltipEl.getBoundingClientRect();
				let left = cx - rr.left + 14, top = cy - rr.top + 14;
				if (left + tr.width  > rr.width  - 8) left = rr.width  - tr.width  - 8;
				if (top  + tr.height > rr.height - 8) top  = rr.height - tr.height - 8;
				if (left < 8) left = 8; if (top < 8) top = 8;
				tooltipEl.style.left = left + 'px'; tooltipEl.style.top = top + 'px';
			}
			graphEl.querySelectorAll('.topo-link-hit').forEach(function (el) {
				el.addEventListener('mouseenter', function (e) {
					const link = visible.links[parseInt(this.dataset.linkIdx, 10)];
					if (!link) return;
					const status = aggregateMembersStatus(effectiveStatusMap, link.members) || 'desconhecido';
					const sColor = status === 'up' ? '#22c55e' : status === 'down' ? '#ef4444' : '#94a3b8';
					let traffic = aggregateMembersTraffic(effectiveTrafficMap, link.members);
					const util  = aggregateMembersUtilization(effectiveTrafficMap, effectiveSpeedMap, link.members);
					let html = '<div style="font-weight:700;margin-bottom:4px;">' + esc(link.source) + ' ↔ ' + esc(link.target) + '</div>';
					html += '<div style="color:#cbd5e1;">Protocolo: ' + esc(link.protocol || '-') + '</div>';
					if (link.port) html += '<div style="color:#cbd5e1;">Porta: ' + esc(link.port) + '</div>';
					html += '<div style="color:' + sColor + ';font-weight:600;">Status: ' + esc(status) + '</div>';
					if (traffic) html += '<div style="margin-top:4px;color:#a7f3d0;">↓ ' + esc(formatBps(traffic.in || 0)) + ' ↑ ' + esc(formatBps(traffic.out || 0)) + '</div>';
					if (util) { const uc = colorForUtilization(util.pct, utilWarnPct, utilCritPct); html += '<div style="color:' + uc + ';font-weight:600;">Util: ' + util.pct.toFixed(1) + '%</div>'; }
					tooltipEl.innerHTML = html;
					tooltipEl.style.display = 'block';
					moveTip(e.clientX, e.clientY);
				});
				el.addEventListener('mousemove', function (e) { if (tooltipEl.style.display === 'block') moveTip(e.clientX, e.clientY); });
				el.addEventListener('mouseleave', hideTip);
			});

			// Toggle expand/collapse (event delegation)
			graphEl.addEventListener('click', function (e) {
				const tg = e.target && e.target.closest ? e.target.closest('.topo-toggle') : null;
				if (!tg || !graphEl.contains(tg)) return;
				e.preventDefault(); e.stopPropagation();
				const node = tg.getAttribute('data-node') || '';
				if (!node) return;
				expandedState[node] = !expandedState[node];
				saveJSON(storageKey + ':exp', expandedState);
				hidePopup(); scheduleDraw();
			}, true);

			// Clique no fundo → deseleciona
			graphEl.addEventListener('click', function (e) {
				if (Date.now() < suppressClickUntil) return;
				if (e.target && e.target.closest && e.target.closest('.topo-toggle')) return;
				if (e.target === svgEl || e.target === graphEl || (e.target && e.target.classList && e.target.classList.contains('topo-bg'))) {
					clearFocus();
				}
			});

			// Nós: drag + click (drill-down)
			graphEl.querySelectorAll('.topo-node').forEach(function (el) {
				el.addEventListener('pointerdown', function (e) {
					const node = this.dataset.node || '';
					if (!node || !positions[node]) return;
					if (e.target && e.target.closest && e.target.closest('.topo-toggle')) return;
					e.preventDefault(); e.stopPropagation();
					hidePopup();
					const moveNodes = buildMoveGroup(model, node, anchorSet, visibleNodesSet);
					const originPos = {};
					moveNodes.forEach(function (mn) {
						if (positions[mn]) originPos[mn] = { x: positions[mn].x, y: positions[mn].y };
					});
					dragState = { node: node, moveNodes: moveNodes, originPos: originPos, sx: e.clientX, sy: e.clientY, moved: false, pid: e.pointerId };
					try { this.setPointerCapture(e.pointerId); } catch (_) {}
					document.body.style.userSelect = 'none';
					document.body.style.cursor = 'grabbing';
					this.style.cursor = 'grabbing';
				});

				el.addEventListener('pointermove', function (e) {
					if (!dragState || dragState.pid !== e.pointerId) return;
					const delta = clientDeltaToSvg(svgEl, dragState.sx, dragState.sy, e.clientX, e.clientY);
					if (Math.abs(e.clientX - dragState.sx) > 1 || Math.abs(e.clientY - dragState.sy) > 1) dragState.moved = true;
					dragState.moveNodes.forEach(function (mn) {
						const origin = dragState.originPos[mn];
						if (origin) savedPositions[mn] = { x: origin.x + delta.dx, y: origin.y + delta.dy };
					});
					applyDragUpdate(dragState.moveNodes);
				});

				el.addEventListener('pointerup', function (e) {
					if (!dragState || dragState.pid !== e.pointerId) return;
					if (dragState.moved) {
						if (!drillDownNode) saveJSON(storageKey, savedPositions);
						suppressClickUntil = Date.now() + 220;
					}
					try { this.releasePointerCapture(e.pointerId); } catch (_) {}
					document.body.style.userSelect = '';
					document.body.style.cursor = '';
					this.style.cursor = 'grab';
					dragState = null;
				});

				el.addEventListener('pointercancel', function (e) {
					if (!dragState || dragState.pid !== e.pointerId) return;
					try { this.releasePointerCapture(e.pointerId); } catch (_) {}
					document.body.style.userSelect = '';
					document.body.style.cursor = '';
					this.style.cursor = 'grab';
					dragState = null;
				});

				// Clique → drill-down
				el.addEventListener('click', function (e) {
					if (Date.now() < suppressClickUntil) return;
					if (e.target && e.target.closest && e.target.closest('.topo-toggle')) return;
					const node = this.dataset.node || '';
					if (!node) return;
					e.stopPropagation();
					drillDownNode = node;
					drillDownData = null;
					selectedNode  = '';
					hidePopup();
					viewBox = { x: 0, y: 0, w: VIEW_W, h: VIEW_H };
					scheduleDraw();
					// Fetch vizinhos frescos
					const url = 'zabbix.php?action=automap.topology.view'
						+ '&drilldown_host=' + encodeURIComponent(node)
						+ '&max_levels=' + maxLevels;
					fetch(url).then(function (r) { return r.text(); }).then(function (text) {
						if (drillDownNode !== node) return;
						var tmp = document.createElement('div');
						tmp.innerHTML = text;
						var ddRoot = tmp.querySelector('#topology-map-root');
						if (!ddRoot) { drillDownData = { error: true }; scheduleDraw(); return; }
						try {
							function dec(attr, fb) { try { return JSON.parse(atob(ddRoot.dataset[attr] || '')); } catch (_) { return fb; } }
							drillDownData = {
								model:        buildModel(dec('links', [])),
								hostLevels:   dec('levels', {}),
								statusMap:    buildStatusMap(dec('statuses', [])),
								trafficMap:   buildTrafficMap(dec('traffic', [])),
								speedMap:     buildSpeedMap(dec('speed', [])),
								unmanagedSet: new Set((dec('unmanaged', []) || []).map(normalizeName))
							};
							viewBox = { x: 0, y: 0, w: VIEW_W, h: VIEW_H };
							scheduleDraw();
						} catch (_) { drillDownData = { error: true }; scheduleDraw(); }
					}).catch(function () { if (drillDownNode === node) { drillDownData = { error: true }; scheduleDraw(); } });
				});
			});
		}

		// Botões fora do SVG
		if (resetBtn) {
			resetBtn.addEventListener('click', function () {
				if (!confirm('Resetar posições e zoom?')) return;
				try { localStorage.removeItem(storageKey); localStorage.removeItem(storageKey + ':exp'); localStorage.removeItem(viewKey); } catch (_) {}
				Object.keys(savedPositions).forEach(function (k) { delete savedPositions[k]; });
				Object.keys(expandedState).forEach(function (k) { delete expandedState[k]; });
				viewBox = { x: 0, y: 0, w: VIEW_W, h: VIEW_H };
				selectedNode = '';
				scheduleDraw();
			});
		}

		if (backBtn) {
			backBtn.addEventListener('click', function () {
				drillDownNode = null; drillDownData = null; selectedNode = '';
				hidePopup(); viewBox = { x: 0, y: 0, w: VIEW_W, h: VIEW_H };
				backBtn.style.display = 'none';
				scheduleDraw();
			});
		}

		document.addEventListener('keydown', function (e) {
			if (e.key === 'Escape') clearFocus();
		});

		scheduleDraw();
	}

	// ── Inicializa ao carregar a página ──────────────────────────────────────

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', initTopologyMap);
	} else {
		initTopologyMap();
	}

})();
