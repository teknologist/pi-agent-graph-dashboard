import type { GraphNode, GraphSnapshot } from './graph-dashboard-store'
import type { GraphRenderContext } from './graph-dashboard-server'

function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
}
function nodeState(node: GraphNode) {
  if (node.blocker || node.gate?.state === 'blocked') return { word: 'Blocked', tint: 'fail', dot: 'red' }
  if (node.verification.state === 'failed') return { word: 'Verification failed', tint: 'fail', dot: 'red' }
  if (node.execution.state === 'failed') return { word: 'Failed', tint: 'fail', dot: 'red' }
  // Only the explicit parent-owned verification fact grants the green state.
  if (node.verification.state === 'verified') return { word: 'Verified', tint: 'ok', dot: 'green' }
  if (node.gate?.state === 'awaiting-approval') return { word: 'Awaiting approval', tint: 'warn', dot: 'amber' }
  if (node.gate?.state === 'waiting' || node.wait) return { word: 'Waiting', tint: 'well', dot: 'neutral' }
  if (node.gate?.state === 'cleared') return { word: 'Cleared · unverified', tint: 'well', dot: 'neutral' }
  if (node.execution.state === 'running') return { word: 'Running', tint: 'run', dot: 'blue' }
  const state = node.execution.state
  return { word: state === 'answered' ? 'Answered · unverified' : state[0].toUpperCase() + state.slice(1), tint: 'well', dot: 'neutral' }
}

/** Longest-path layers, declaration order within a layer. State changes cannot move nodes.
 * Long edges use outside lanes so that they do not pass through intermediate nodes.
 */
function layoutGraph(snapshot: GraphSnapshot) {
  const rank = new Map(snapshot.nodes.map(node => [node.id, 0]))
  const degree = new Map(snapshot.nodes.map(node => [node.id, 0]))
  const outgoing = new Map<string, string[]>()
  for (const edge of snapshot.edges) {
    degree.set(edge.to, degree.get(edge.to)! + 1)
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to])
  }
  const ready = snapshot.nodes.filter(node => degree.get(node.id) === 0).map(node => node.id)
  for (let i = 0; i < ready.length; i++) {
    const id = ready[i]
    for (const next of outgoing.get(id) ?? []) {
      rank.set(next, Math.max(rank.get(next)!, rank.get(id)! + 1))
      degree.set(next, degree.get(next)! - 1)
      if (degree.get(next) === 0) ready.push(next)
    }
  }
  if (ready.length !== snapshot.nodes.length) throw new Error('Graph dashboard: dependency cycle')
  const layers: GraphNode[][] = []
  for (const node of snapshot.nodes) (layers[rank.get(node.id)!] ??= []).push(node)
  const baseWidth = Math.max(800, ...layers.map(layer => layer.length * 380 + 40))
  const positions = new Map<string, { x: number; y: number }>()
  layers.forEach((layer, depth) => layer.forEach((node, index) => positions.set(node.id, {
    x: baseWidth / 2 + (index - (layer.length - 1) / 2) * 380 - 115, y: 8 + depth * 114,
  })))
  let lane = 0
  const edges = snapshot.edges.map(edge => {
    const from = positions.get(edge.from)!, to = positions.get(edge.to)!
    const x1 = from.x + 115, y1 = from.y + 72, x2 = to.x + 115, y2 = to.y
    let path: string
    if (rank.get(edge.to)! - rank.get(edge.from)! > 1) {
      const outside = baseWidth - 12 + (++lane) * 10
      path = `M${x1} ${y1}V${y1 + 16}H${outside}V${y2 - 16}H${x2}V${y2}`
    } else path = `M${x1} ${y1}V${(y1 + y2) / 2}H${x2}V${y2}`
    return { ...edge, path }
  })
  return { positions, edges, width: baseWidth + lane * 10, height: Math.max(580, layers.length * 114 + 8) }
}
function shortText(value: string, limit: number) {
  const letters = Array.from(value)
  return letters.length > limit ? letters.slice(0, limit - 1).join('') + '…' : value
}
function freshness(snapshot: GraphSnapshot, now: number, staleAfter: number): string {
  if (snapshot.reporting?.recovery === 'pending') return 'Recovery pending: recorded worker states need direct native status reconciliation. Last known graph retained.'
  if (snapshot.reporting?.recovery === 'partial-failure') return 'Recovery incomplete: some native status reads failed. Unreconciled workers retain their last observations. Last known graph retained.'
  if (snapshot.status !== 'active') return `Parent status: ${snapshot.status}. Automatic refresh stopped.`
  const observation = snapshot.timestamps.lastSourceObservationAt
  if (!observation) return 'Stale: no source observation. Worker state is not confirmed stopped.'
  const age = Math.max(0, now - Date.parse(observation))
  return `${age >= staleAfter ? 'Stale' : 'Source observed'}: ${Math.floor(age / 1000)} s ago. Task-level starts/stops only; no internal-operation tracking.`
}
function inspector(snapshot: GraphSnapshot, selected: string): string {
  const node = snapshot.nodes.find(item => item.id === selected)
  if (!node) return '<h2>No declared nodes</h2><p>No future work is inferred.</p>'
  const h = escapeHtml, state = nodeState(node)
  const field = (name: string, value: string) => `<dt>${h(name)}</dt><dd>${value}</dd>`
  const dependencies = snapshot.edges.filter(edge => edge.to === node.id).map(edge => {
    const source = snapshot.nodes.find(item => item.id === edge.from)!
    return `<li>${h(source.label)} <code>${h(source.id)}</code> (${h(edge.type)})</li>`
  })
  const condition = (value: GraphNode['blocker']) => value ? `${h(value.reason)}<br>Source: ${h(value.sourceNodeId ?? 'Not specified')}<br>External requirement: ${h(value.externalRequirement ?? 'None')}<br>Clears when: ${h(value.clearingCondition)}` : 'None observed.'
  return `<small>SELECTED NODE</small><h2>${h(node.label)}</h2><p><i class="dot ${state.dot}" aria-hidden="true"></i>${h(state.word)}</p><dl>${
    field('Role / stage', `${h(node.role)} / ${h(node.stage)} (${h(node.kind)})`) +
    field('Agent identity', `<code>${h(node.nativeId ?? 'Not assigned')}</code>`) +
    field('Node identity', `<code>${h(node.id)}</code><br>Logical: <code>${h(node.logicalId)}</code>`) +
    field('Attempt', `${node.attempt} · ${node.currentAttempt ? 'Current attempt' : 'Earlier attempt'}`) +
    field('Execution', h(node.execution.state)) +
    field('Depends on', dependencies.length ? `<ul>${dependencies.join('')}</ul>` : 'No declared prerequisites.') +
    field('Verification outcome', `${h(node.verification.state)}${node.verification.reason ? `<br>${h(node.verification.reason)}` : ''}`) +
    field('Gate', node.gate ? `${h(node.gate.state)}<br>Clears when: ${h(node.gate.clearingCondition)}` : 'Not a gate.') +
    field('Blocker', condition(node.blocker)) + field('Wait', condition(node.wait)) +
    field('Last node observation', h(node.execution.observedAt ?? 'Not observed')) +
    field('Evidence references', node.evidence.length ? `<ul>${node.evidence.map(item => `<li>${h(item.label)}: <code>${h(item.reference)}</code></li>`).join('')}</ul>` : 'None declared.')
  }</dl><p class="meta">Read-only report. Evidence identifiers are not links. Native dependencies do not grant verification or approval.</p>`
}
function graphView(snapshot: GraphSnapshot, selected: string) {
  const h = escapeHtml, layout = layoutGraph(snapshot)
  const svg = `<svg id="dag" viewBox="0 0 ${layout.width} ${layout.height}" width="${layout.width}" height="${layout.height}" role="group" aria-label="Top-to-bottom execution graph. Select a node with Enter or Space. Arrow keys move between nodes."><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10" fill="var(--edge)"/></marker><clipPath id="node-text"><rect x="14" y="6" width="202" height="62"/></clipPath></defs>${layout.edges.map(edge => `<path class="edge${edge.type === 'native-after' ? '' : ' gate'}" data-from="${h(edge.from)}" data-to="${h(edge.to)}" data-type="${h(edge.type)}" d="${edge.path}"><title>${h(edge.from)} → ${h(edge.to)} (${h(edge.type)})</title></path>`).join('')}${snapshot.nodes.map(node => {
    const position = layout.positions.get(node.id)!, state = nodeState(node)
    return `<g data-node="${h(node.id)}" transform="translate(${position.x} ${position.y})" role="button" tabindex="0" aria-pressed="${node.id === selected}" aria-label="${h(`${node.label}, ${node.id}, ${state.word}, ${node.currentAttempt ? 'current' : 'earlier'} attempt ${node.attempt}`)}"><title>${h(node.label)} · ${h(node.id)} · ${h(state.word)}</title><rect class="node${node.id === selected ? ' selected' : ''}" width="230" height="72" rx="8" fill="var(--${state.tint})"/><g clip-path="url(#node-text)"><text class="label" x="16" y="23">${h(shortText(node.label, 26))}</text><text class="id" x="16" y="41">${h(shortText(node.nativeId ?? node.id, 28))}</text><circle class="state-dot ${state.dot}" cx="19" cy="57" r="3.5"/><text class="state" x="30" y="61">${h(shortText(`${state.word} · ${node.currentAttempt ? 'current' : 'earlier'} ${node.attempt}`, 27))}</text></g></g>`
  }).join('')}</svg>`
  const list = snapshot.nodes.map(node => {
    const state = nodeState(node)
    const dependencies = snapshot.edges.filter(edge => edge.to === node.id).map(edge => `${edge.from} (${edge.type})`).join(', ')
    return `<li><button data-node="${h(node.id)}" aria-pressed="${node.id === selected}">${h(node.label)}</button> <code>${h(node.id)}</code> · <i class="dot ${state.dot}" aria-hidden="true"></i>${h(state.word)} · ${node.currentAttempt ? 'Current' : 'Earlier'} attempt ${node.attempt}<br>Depends on: ${h(dependencies || 'None declared')}${node.gate ? `<br>Gate clears when: ${h(node.gate.clearingCondition)}` : ''}${node.blocker ? `<br>Blocker: ${h(node.blocker.reason)}. Clears when: ${h(node.blocker.clearingCondition)}` : ''}${node.wait ? `<br>Wait: ${h(node.wait.reason)}. Clears when: ${h(node.wait.clearingCondition)}` : ''}</li>`
  }).join('')
  return { svg, list, inspector: inspector(snapshot, selected), width: layout.width, height: layout.height }
}

// These tokens and base rules match the approved self-contained reference.
const styles = `:root{--canvas:oklch(98% .003 270);--surface:oklch(99.3% .002 270);--ink:oklch(19.5% .01 270);--muted:oklch(54% .012 270);--line:oklch(85.5% .008 270);--blue:oklch(52% .195 264);--run:oklch(96.5% .022 264);--ok:oklch(96.5% .03 155);--fail:oklch(96.6% .022 25);--warn:oklch(97% .035 80);--well:oklch(96.4% .004 270);--edge:oklch(60% .012 270);color-scheme:light}@media(prefers-color-scheme:dark){:root{--canvas:oklch(19% .008 270);--surface:oklch(23% .008 270);--ink:oklch(93% .008 270);--muted:oklch(73% .012 270);--line:oklch(46% .015 270);--blue:oklch(72% .15 264);--run:oklch(29% .04 264);--ok:oklch(29% .04 155);--fail:oklch(29% .04 25);--warn:oklch(29% .035 80);--well:oklch(21% .008 270);--edge:oklch(60% .012 270);color-scheme:dark}}*{box-sizing:border-box}body{margin:0;background:var(--canvas);color:var(--ink);font:14px/1.5 Geist,system-ui,sans-serif}header{padding:22px 28px;border-bottom:1px solid var(--line);background:var(--surface)}small,.meta{color:var(--muted);font-size:12px}h1{font-size:26px;letter-spacing:-.03em;margin:8px 0}code{font:12px ui-monospace,monospace}a{color:var(--blue)}.bar{display:flex;flex-wrap:wrap;gap:12px 24px;align-items:center}.bar span{font-variant-numeric:tabular-nums}.layout{display:grid;grid-template-columns:minmax(700px,1fr) 320px;min-height:680px}.graph{padding:20px 24px;min-width:0}.tools{display:flex;flex-wrap:wrap;gap:12px;align-items:center;font-size:12px;margin-bottom:10px}button{border:1px solid var(--line);background:var(--surface);border-radius:6px;padding:6px 12px;color:var(--ink);cursor:pointer}button:disabled{cursor:default;opacity:.6}aside{background:var(--surface);border-left:1px solid var(--line);padding:24px;max-height:740px;overflow:auto}h2{font-size:16px;margin:8px 0 16px}dt{font-size:12px;color:var(--muted);margin-top:18px}dd{margin:4px 0}.legend{display:flex;flex-wrap:wrap;gap:12px 22px;font-size:12px;border-top:1px solid var(--line);padding-top:14px}.dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:6px;background:var(--blue)}.red{background:oklch(60.5% .215 25);fill:oklch(60.5% .215 25)}.green{background:oklch(62% .15 155);fill:oklch(62% .15 155)}.amber{background:oklch(78% .165 70);fill:oklch(78% .165 70)}.neutral{background:var(--muted);fill:var(--muted)}.blue{fill:var(--blue)}.notice{padding:14px 28px;border-top:1px solid var(--line);font-size:12px;color:var(--muted)}svg{display:block}svg text{font-family:Geist,system-ui,sans-serif;fill:var(--ink)}.label{font-size:13px;font-weight:600}.state{font-size:12px}.id{font:11px ui-monospace,monospace;fill:var(--muted)}.edge{fill:none;stroke:var(--edge);stroke-width:1.5;marker-end:url(#arrow)}.gate{stroke-dasharray:5 4}.node{stroke:var(--line);stroke-width:1;rx:8}.selected,[data-node]:focus-visible .node{stroke:var(--blue);stroke-width:2}[data-node]{cursor:pointer}.viewport:focus-visible,button:focus-visible,a:focus-visible,summary:focus-visible,aside:focus-visible{outline:2px solid var(--blue);outline-offset:-2px}.footer{background:var(--well);padding:12px 28px;font-size:12px;display:flex;flex-wrap:wrap;gap:12px 24px;border-top:1px solid var(--line)}.viewport{overflow:auto;max-width:100%;height:580px;margin-bottom:14px}.bar,aside,.overview,.notice,.footer{overflow-wrap:anywhere}.overview{margin-top:16px}.overview li{margin:12px 0}summary{cursor:pointer}aside ul{padding-left:18px}p{max-width:72ch}@media(max-width:1000px){.layout{display:block}.graph{max-width:100%}aside{border-top:1px solid var(--line);border-left:0}}@media(max-width:600px){header,aside,.notice,.footer{padding:16px}.graph{padding:16px}.bar code,dd code{overflow-wrap:anywhere}.bar .meta{flex-basis:100%}}`

/** Browser view state only. This function has no execution authority. */
function startBrowser(initial: GraphSnapshot, context: GraphRenderContext) {
  let snapshot = initial
  const get = (id: string) => document.getElementById(id)!
  const viewport = get('viewport'), detail = get('inspector'), overview = get('overview') as HTMLDetailsElement
  const pauseButton = get('pause') as HTMLButtonElement
  const key = `pi-graph-view:${snapshot.runId}`
  let selected = snapshot.nodes.find(node => node.execution.state === 'running')?.id ?? snapshot.nodes[0]?.id ?? ''
  let zoom = 1, paused = false, disconnected = false, pending: AbortController | null = null
  let graphWidth = Number(get('dag').getAttribute('width')), graphHeight = Number(get('dag').getAttribute('height'))
  const online = location.protocol !== 'file:' && (location.protocol === 'http:' || location.protocol === 'https:')
  let endpoint: URL | null = null
  if (online) {
    try { const url = new URL(context.snapshotPath, location.href); if (url.origin === location.origin) endpoint = url } catch { /* Keep the last report. */ }
  }
  function save() {
    try { localStorage.setItem(key, JSON.stringify({ selected, zoom, left: viewport.scrollLeft, top: viewport.scrollTop, inspectorTop: detail.scrollTop, listOpen: overview.open })) } catch { /* Storage is optional. */ }
  }
  function minimumZoom() {
    return Math.min(.01, zoom, 1 / graphWidth, 1 / graphHeight)
  }
  function resizeGraph() {
    const svg = get('dag')
    svg.setAttribute('width', String(graphWidth * zoom)); svg.setAttribute('height', String(graphHeight * zoom))
    get('zoom').textContent = zoom < .01 ? `${Number((zoom * 100).toPrecision(2))}%` : `${Math.round(zoom * 100)}%`
  }
  function showStatus() {
    get('freshness').textContent = freshness(snapshot, Date.now(), context.staleAfterMs)
    get('refresh').textContent = !online ? 'Offline export. No fetch.' : snapshot.status !== 'active' ? 'Parent terminal status. Refresh stopped.' : paused ? 'Refresh paused for interaction. Select Resume page refresh.' : disconnected ? 'Disconnected. Last known graph retained; retry every 5 s.' : endpoint ? 'Refresh: 5 s' : 'Snapshot path unavailable. Last known graph retained.'
    pauseButton.textContent = paused ? 'Resume page refresh' : 'Pause page refresh'
    pauseButton.disabled = !endpoint || snapshot.status !== 'active'
  }
  function pause() { paused = true; pending?.abort(); showStatus() }
  function paint() {
    const active = document.activeElement as HTMLElement | null
    const focusNode = active?.dataset.node, focusId = active?.id
    const fromList = !!active?.closest('#node-list')
    const left = viewport.scrollLeft, top = viewport.scrollTop, inspectorTop = detail.scrollTop
    if (!snapshot.nodes.some(node => node.id === selected)) selected = snapshot.nodes[0]?.id ?? ''
    const view = graphView(snapshot, selected)
    get('drawing').innerHTML = view.svg
    get('node-list').innerHTML = view.list
    if (detail.innerHTML !== view.inspector) detail.innerHTML = view.inspector
    graphWidth = view.width; graphHeight = view.height; resizeGraph()
    get('run-name').textContent = snapshot.runName
    get('run-status').textContent = snapshot.status
    get('stage').textContent = snapshot.currentStage
    get('branch').textContent = snapshot.workspace ? snapshot.workspace.branch ?? 'Detached HEAD' : 'Not recorded'
    get('worktree').textContent = snapshot.workspace?.worktree ?? 'Not recorded'
    get('timestamps').innerHTML = timestampView(snapshot, context)
    get('topology').textContent = topologyText(snapshot)
    if (focusNode) {
      const candidates = Array.from(document.querySelectorAll<HTMLElement>(fromList ? '#node-list [data-node]' : '#drawing [data-node]'))
      candidates.find(node => node.dataset.node === focusNode)?.focus({ preventScroll: true })
    } else if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true })
    viewport.scrollLeft = left; viewport.scrollTop = top; detail.scrollTop = inspectorTop
    showStatus(); save()
  }
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null')
    if (saved && typeof saved === 'object') {
      if (typeof saved.selected === 'string' && snapshot.nodes.some(node => node.id === saved.selected)) selected = saved.selected
      if (Number.isFinite(saved.zoom)) zoom = Math.max(minimumZoom(), Math.min(2, saved.zoom))
      paint()
      if (Number.isFinite(saved.left)) viewport.scrollLeft = Math.max(0, saved.left)
      if (Number.isFinite(saved.top)) viewport.scrollTop = Math.max(0, saved.top)
      if (Number.isFinite(saved.inspectorTop)) detail.scrollTop = Math.max(0, saved.inspectorTop)
      overview.open = saved.listOpen === true
    }
  } catch { /* Invalid or denied storage must not prevent reading. */ }
  resizeGraph(); showStatus()
  document.addEventListener('keydown', event => {
    // Pause before a keyboard-driven focus or selection change. Resume is explicit.
    if ((event.target as HTMLElement).id !== 'pause') pause()
    const target = (event.target as Element).closest<HTMLElement>('[data-node]')
    if (!target) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault(); selected = target.dataset.node!; paint()
    } else if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault()
      const scope = target.closest('#node-list') ? '#node-list' : '#drawing'
      const nodes = Array.from(document.querySelectorAll<HTMLElement>(`${scope} [data-node]`))
      const index = nodes.indexOf(target), direction = event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1
      nodes[(index + direction + nodes.length) % nodes.length]?.focus()
    }
  })
  document.addEventListener('click', event => {
    const node = (event.target as Element).closest<HTMLElement>('[data-node]')
    if (node) { selected = node.dataset.node!; paint() }
  })
  pauseButton.addEventListener('click', () => { if (paused) { paused = false; showStatus(); void poll() } else pause() })
  get('fit').addEventListener('click', () => {
    zoom = Math.max(minimumZoom(), Math.min(1, viewport.clientWidth / graphWidth, viewport.clientHeight / graphHeight))
    resizeGraph(); viewport.scrollLeft = 0; viewport.scrollTop = 0; save()
  })
  for (const [id, multiplier] of [['zoom-out', .8], ['zoom-in', 1.25]] as const) get(id).addEventListener('click', () => {
    zoom = Math.max(minimumZoom(), Math.min(2, zoom * multiplier)); resizeGraph(); save()
  })
  viewport.addEventListener('scroll', save, { passive: true }); detail.addEventListener('scroll', save, { passive: true })
  overview.addEventListener('toggle', save)
  window.addEventListener('pagehide', save)
  async function poll() {
    if (!endpoint || paused || snapshot.status !== 'active' || pending) return
    const controller = new AbortController(); pending = controller
    const timeout = setTimeout(() => controller.abort(), 4500)
    try {
      const response = await fetch(endpoint, { cache: 'no-store', credentials: 'same-origin', signal: controller.signal })
      if (!response.ok) throw new Error('Snapshot unavailable')
      const next: GraphSnapshot = await response.json()
      if (paused || controller.signal.aborted) return
      if (next.schemaVersion !== 1 || next.runId !== snapshot.runId || next.parentSessionId !== snapshot.parentSessionId || !Number.isSafeInteger(next.revision) || next.revision < snapshot.revision) throw new Error('Foreign or stale snapshot')
      // Build before committing so a malformed response cannot erase the last graph.
      graphView(next, selected)
      disconnected = false
      if (next.revision > snapshot.revision) { snapshot = next; paint() }
      showStatus()
      if (snapshot.status !== 'active') { clearInterval(refreshTimer); clearInterval(ageTimer) }
    } catch { if (!paused) { disconnected = true; showStatus() } }
    finally { clearTimeout(timeout); if (pending === controller) pending = null }
  }
  const refreshTimer = setInterval(() => { void poll() }, context.refreshIntervalMs)
  const ageTimer = setInterval(showStatus, 1000)
  if (!endpoint || snapshot.status !== 'active') { clearInterval(refreshTimer); clearInterval(ageTimer) }
}
function topologyText(snapshot: GraphSnapshot) {
  return `${snapshot.nodes.length} declared nodes shown · ${snapshot.topology === 'unknown-future' ? 'Future topology unknown; no work inferred' : 'Declared topology'}`
}
function timestampView(snapshot: GraphSnapshot, context: GraphRenderContext) {
  const h = escapeHtml
  return `Snapshot: ${h(snapshot.updatedAt)} · Observer heartbeat: ${h(snapshot.timestamps.observerHeartbeatAt ?? 'Not observed')} · Source observation: ${h(snapshot.timestamps.lastSourceObservationAt ?? 'Not observed')} · Worker activity: ${h(snapshot.timestamps.lastWorkerActivityAt ?? 'Not observed')} · Last HTML export: ${h(snapshot.timestamps.lastHtmlRenderAt ?? 'Not recorded')} · This document rendered: ${h(context.renderedAt)}`
}

export function renderGraphDashboard(snapshot: GraphSnapshot, context: GraphRenderContext): string {
  const selected = snapshot.nodes.find(node => node.execution.state === 'running')?.id ?? snapshot.nodes[0]?.id ?? ''
  const view = graphView(snapshot, selected), h = escapeHtml
  // JSON is JavaScript data, never HTML. Escaping angle brackets also defeats </script>.
  const json = (value: unknown) => JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`)
  const functions = [escapeHtml, nodeState, layoutGraph, shortText, freshness, inspector, graphView, topologyText, timestampView]
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${h(snapshot.runName)} · Agent graph dashboard</title><style nonce="${h(context.nonce)}">${styles}</style></head><body><header><small>Agent graph dashboard · READ ONLY</small><h1 id="run-name">${h(snapshot.runName)}</h1><div class="bar"><code>${h(snapshot.command)}</code><span id="run-status">${h(snapshot.status)}</span><span>Stage: <span id="stage">${h(snapshot.currentStage)}</span></span><span class="meta">Run: <code>${h(snapshot.runId)}</code> · Parent: <code>${h(snapshot.parentSessionId)}</code></span><span class="meta">Branch: <code id="branch">${h(snapshot.workspace ? snapshot.workspace.branch ?? 'Detached HEAD' : 'Not recorded')}</code></span><span class="meta">Worktree: <code id="worktree">${h(snapshot.workspace?.worktree ?? 'Not recorded')}</code></span><span class="meta" id="timestamps">${timestampView(snapshot, context)}</span></div><p class="meta" id="freshness">${h(freshness(snapshot, Date.parse(context.renderedAt), context.staleAfterMs))}</p></header><main class="layout"><section class="graph" aria-label="Execution graph"><div class="tools"><button id="fit">Fit graph</button><button id="zoom-out" aria-label="Zoom out">−</button><span id="zoom">100%</span><button id="zoom-in" aria-label="Zoom in">+</button><button id="pause">Pause page refresh</button><span id="refresh" class="meta">Refresh: 5 s when served locally</span><a href="#inspector">Selected node details</a><a href="#overview">Readable dependency list</a></div><div class="viewport" id="viewport" tabindex="0" aria-label="Graph viewport. Scroll to pan horizontally or vertically."><div id="drawing">${view.svg}</div></div><div class="legend"><span>── Native work dependency</span><span>┄┄ Parent gate / verification</span><span id="topology">${h(topologyText(snapshot))}</span></div><details id="overview" class="overview"><summary>All nodes and dependencies (readable overview)</summary><ol id="node-list">${view.list}</ol></details></section><aside id="inspector" tabindex="0" aria-label="Selected node details">${view.inspector}</aside></main><div class="notice">Task-level starts/stops only. Old observations do not prove a worker stopped. This report cannot edit code, approve work, or publish updates.</div><footer class="footer"><span>Host-local read-only report</span><span>Scroll the graph to pan. Use Tab, arrow keys, and Enter or Space to inspect nodes.</span></footer><script nonce="${h(context.nonce)}">${functions.map(fn => fn.toString()).join('\n')}\n(${startBrowser.toString()})(${json(snapshot)},${json(context)});</script></body></html>`
}
