import { expect, test } from 'bun:test'
import { runInNewContext } from 'node:vm'
import { renderGraphDashboard } from './graph-dashboard-render'
import type { GraphNode, GraphSnapshot } from './graph-dashboard-store'
import { createGraphDashboardServer, type GraphRenderContext } from './graph-dashboard-server'

const time = '2026-06-01T12:00:00.000Z'
const context: GraphRenderContext = { snapshotPath: '/runs/run-1/snapshot', reportPath: '/runs/run-1/report', renderedAt: time, nonce: 'test-nonce', refreshIntervalMs: 5000, staleAfterMs: 15000 }
function node(id: string, change: Partial<GraphNode> = {}): GraphNode {
  return { id, logicalId: id, label: `Task ${id}`, role: 'reviewer', stage: 'analysis', kind: 'worker', attempt: 1, currentAttempt: true, nativeId: null,
    execution: { state: 'planned', observedAt: null }, verification: { state: 'unverified', reason: null }, gate: null, blocker: null, wait: null, evidence: [], ...change }
}
function fixture(nodes = [node('a')]): GraphSnapshot {
  return { schemaVersion: 1, runId: 'run-1', parentSessionId: 'parent-1', revision: 1, runName: 'MR !68', command: '/gitlab-address-pr-agent-review', currentStage: 'analysis', status: 'active', topology: 'unknown-future', updatedAt: time,
    timestamps: { observerHeartbeatAt: time, lastSourceObservationAt: time, lastWorkerActivityAt: null, lastHtmlRenderAt: null }, nodes, edges: [] }
}
function svg(html: string) { return html.match(/<svg id="dag"[\s\S]*?<\/svg>/)![0] }
function script(html: string) { return html.match(/<script nonce="[^"]*">([\s\S]*?)<\/script>/)![1] }
function nodeMarkup(html: string, id: string) { return svg(html).match(new RegExp(`<g data-node="${id}"[\\s\\S]*?<\\/g><\\/g>`))![0] }

test('loopback report provides matching CSP nonces and the public dashboard label', async () => {
  const snapshot = fixture()
  const server = createGraphDashboardServer({ store: { runId: snapshot.runId, parentSessionId: snapshot.parentSessionId, read: () => snapshot, write: () => { throw new Error('Read only') } }, renderer: renderGraphDashboard })
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/runs/run-1/report`)
    expect(response.status).toBe(200)
    const html = await response.text()
    const nonce = html.match(/<style nonce="([^"]+)"/)![1]
    expect(response.headers.get('content-security-policy')).toContain(`script-src 'nonce-${nonce}'`)
    expect(response.headers.get('content-security-policy')).toContain(`style-src 'nonce-${nonce}'`)
    expect(html).toContain(`<script nonce="${nonce}">`)
    expect(html).toContain('Agent graph dashboard')
  } finally { server.stop(true) }
})

test('branch and worktree are escaped in offline and live reports', async () => {
  const snapshot = fixture()
  snapshot.workspace = { branch: 'feature/<review>&', worktree: '/repo/worktrees/review & checks' }
  const html = renderGraphDashboard(snapshot, context)
  expect(html).toContain('Branch: <code id="branch">feature/&lt;review&gt;&amp;</code>')
  expect(html).toContain('Worktree: <code id="worktree">/repo/worktrees/review &amp; checks</code>')
  const server = createGraphDashboardServer({ store: { runId: snapshot.runId, parentSessionId: snapshot.parentSessionId, read: () => snapshot, write: () => { throw new Error('Read only') } }, renderer: renderGraphDashboard })
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/runs/run-1/report`)
    expect(await response.text()).toContain('id="branch">feature/&lt;review&gt;&amp;</code>')
  } finally { server.stop(true) }
  const legacy = renderGraphDashboard(fixture(), context)
  expect(legacy).toContain('id="branch">Not recorded</code>')
  expect(legacy).toContain('id="worktree">Not recorded</code>')
})

test('hostile text stays data in the offline HTML and executable script', () => {
  const attack = '</script><img src=x onerror="alert(1)">&\' Ω >'
  const snapshot = fixture([node('a', { label: attack, role: attack, verification: { state: 'failed', reason: attack }, evidence: [{ label: attack, reference: 'evidence-1' }] })])
  snapshot.runName = attack
  const html = renderGraphDashboard(snapshot, { ...context, nonce: '"<>&\'' })
  expect(html).not.toContain('<img')
  expect(html).toContain('&lt;/script&gt;&lt;img')
  expect(html.match(/<script /g)).toHaveLength(1)
  expect(html.match(/<style /g)).toHaveLength(1)
  expect(html).toContain('nonce="&quot;&lt;&gt;&amp;&#39;"')
  expect(script(html)).toContain('\\u003c/script\\u003e')
  expect(html).not.toContain('href="evidence-1"')
  // Execute the complete emitted script, not a separately imported helper.
  const browser = boot(html, 'file:')
  expect(browser.fetches).toHaveLength(0)
  expect(browser.element('refresh').textContent).toBe('Offline export. No fetch.')
})

test('node tints follow verification and conditions, not answered receipts or earlier attempts', () => {
  const nodes = [
    node('answered', { execution: { state: 'answered', observedAt: time } }),
    node('verified-parent', { kind: 'parent', verification: { state: 'verified', reason: 'Parent checked' } }),
    node('bad-checks', { execution: { state: 'answered', observedAt: time }, verification: { state: 'failed', reason: 'Checks fail' } }),
    node('blocked', { blocker: { reason: 'Missing evidence', sourceNodeId: 'answered', externalRequirement: null, clearingCondition: 'Supply caller evidence' } }),
    node('waiting', { wait: { reason: 'Normal dependency', sourceNodeId: 'answered', externalRequirement: null, clearingCondition: 'Prerequisite answers' } }),
    node('approval', { kind: 'gate', gate: { state: 'awaiting-approval', clearingCondition: 'Parent approves' } }),
    node('prior', { logicalId: 'retry', currentAttempt: false, execution: { state: 'failed', observedAt: time } }),
    node('retry', { attempt: 2, verification: { state: 'verified', reason: 'Parent checked retry' } }),
  ]
  const html = renderGraphDashboard(fixture(nodes), context)
  for (const [id, word, tint] of [['answered', 'Answered · unverified', 'well'], ['verified-parent', 'Verified', 'ok'], ['bad-checks', 'Verification failed', 'fail'], ['blocked', 'Blocked', 'fail'], ['waiting', 'Waiting', 'well'], ['approval', 'Awaiting approval', 'warn'], ['prior', 'Failed', 'fail'], ['retry', 'Verified', 'ok']]) {
    const markup = nodeMarkup(html, id)
    expect(markup).toContain(word)
    expect(markup).toContain(`fill="var(--${tint})"`)
    expect(markup).toContain('<circle')
    expect(markup).toContain('role="button" tabindex="0"')
  }
  expect(html).toContain('Supply caller evidence')
  expect(html).toContain('Gate clears when: Parent approves')
})

test('arbitrary branching DAG edges point down to their own destination and stay in bounds', () => {
  const snapshot = fixture(['root', 'left', 'right', 'merge', 'end', 'isolated'].map(id => node(id)))
  snapshot.edges = [
    { from: 'root', to: 'left', type: 'native-after' }, { from: 'root', to: 'right', type: 'native-after' },
    { from: 'left', to: 'merge', type: 'parent-gate' }, { from: 'right', to: 'merge', type: 'verification' },
    { from: 'merge', to: 'end', type: 'native-after' }, { from: 'root', to: 'end', type: 'verification' },
  ]
  checkLayout(snapshot)
  const first = svg(renderGraphDashboard(snapshot, context))
  snapshot.nodes.forEach(item => { item.execution.state = 'running' })
  expect(svg(renderGraphDashboard(snapshot, context)).match(/transform="[^"]+"/g)).toEqual(first.match(/transform="[^"]+"/g))
  expect(first).toContain('class="edge" data-from="root" data-to="left"')
  expect(first).toContain('class="edge gate" data-from="right" data-to="merge"')
})

test('512-node wide and deep graphs retain every node and long labels remain available', () => {
  const wide = fixture(Array.from({ length: 512 }, (_, i) => node(`n${i}`, { label: 'Long unbroken identity and task label '.repeat(12) })))
  checkLayout(wide)
  const deep = structuredClone(wide)
  deep.edges = deep.nodes.slice(1).map((item, i) => ({ from: deep.nodes[i].id, to: item.id, type: 'native-after' }))
  deep.edges.push({ from: 'n0', to: 'n511', type: 'verification' })
  checkLayout(deep)
  const html = renderGraphDashboard(deep, context)
  expect(nodeMarkup(html, 'n0')).toContain('clip-path="url(#node-text)"')
  expect(nodeMarkup(html, 'n0')).toContain('…')
  expect(html).toContain(`<h2>${deep.nodes[0].label}</h2>`)
  expect(html).toContain('512 declared nodes shown')
  expect(html.match(/<ol id="node-list">([\s\S]*?)<\/ol>/)![1].match(/<li><button data-node=/g)).toHaveLength(512)
  const empty = renderGraphDashboard(fixture([]), context)
  expect(empty).toContain('No declared nodes')
})

for (const shape of ['wide', 'deep'] as const) {
  for (const width of [288, 1072]) {
    test(`512-node ${shape} fit preserves manual and restored scale at ${width}px`, () => {
      const snapshot = fixture(Array.from({ length: 512 }, (_, i) => node(`n${i}`)))
      if (shape === 'deep') snapshot.edges = snapshot.nodes.slice(1).map((item, i) => ({ from: snapshot.nodes[i].id, to: item.id, type: 'native-after' }))
      const html = renderGraphDashboard(snapshot, context)
      const storage: Record<string, string> = {}
      const browser = boot(html, 'file:', storage, false, width)
      const size = () => [Number(browser.element('dag').getAttribute('width')), Number(browser.element('dag').getAttribute('height'))]
      browser.listeners.get('fit:click')!({})
      const fitted = size()
      expect(fitted[0]).toBeLessThanOrEqual(width)
      expect(fitted[1]).toBeLessThanOrEqual(580)
      expect(Number.parseFloat(browser.element('zoom').textContent)).toBeGreaterThan(0)
      browser.listeners.get('zoom-out:click')!({})
      const smaller = size()
      expect(smaller[0]).toBeGreaterThan(0)
      expect(smaller[0]).toBeLessThan(fitted[0])
      browser.listeners.get('zoom-in:click')!({})
      expect(size()[0]).toBeGreaterThan(smaller[0])
      browser.listeners.get('fit:click')!({})
      const restored = boot(html, 'file:', storage, false, width)
      expect(Number(restored.element('dag').getAttribute('width'))).toBeCloseTo(fitted[0], 8)
      expect(Number(restored.element('dag').getAttribute('height'))).toBeCloseTo(fitted[1], 8)
      // A larger viewport must not make Zoom out increase the current scale.
      browser.element('viewport').clientWidth = width * 2
      browser.element('viewport').clientHeight = 1160
      browser.listeners.get('zoom-out:click')!({})
      expect(size()[0]).toBeLessThan(fitted[0])
    })
  }
}

test('live declared topology replacement preserves zoom until an explicit fit', async () => {
  const snapshot = fixture([node('n0')])
  const storage: Record<string, string> = {}
  const browser = boot(renderGraphDashboard(snapshot, context), 'http:', storage, false, 288)
  browser.listeners.get('fit:click')!({})
  const scale = () => JSON.parse(storage['pi-graph-view:run-1']).zoom as number
  const initial = scale()
  const wider = { ...snapshot, revision: 2, nodes: Array.from({ length: 512 }, (_, i) => node(`n${i}`)) }
  browser.reply(wider)
  await browser.tick()
  expect(scale()).toBe(initial)
  browser.listeners.get('fit:click')!({})
  expect(Number(browser.element('dag').getAttribute('width'))).toBeLessThanOrEqual(288)
  for (let step = 0; step < 26; step++) browser.listeners.get('zoom-out:click')!({})
  const fitted = scale()
  const deeper = { ...wider, revision: 3, edges: wider.nodes.slice(1).map((item, i) => ({ from: wider.nodes[i].id, to: item.id, type: 'native-after' as const })) }
  browser.reply(deeper)
  await browser.tick()
  expect(scale()).toBe(fitted)
  browser.listeners.get('zoom-out:click')!({})
  expect(scale()).toBeLessThanOrEqual(fitted)
  browser.listeners.get('fit:click')!({})
  expect(Number(browser.element('dag').getAttribute('height'))).toBeLessThanOrEqual(580)
})

function checkLayout(snapshot: GraphSnapshot) {
  const graph = svg(renderGraphDashboard(snapshot, context))
  const bounds = graph.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)!
  const width = Number(bounds[1]), height = Number(bounds[2])
  const positions = new Map<string, [number, number]>()
  for (const match of graph.matchAll(/<g data-node="([^"]+)" transform="translate\(([\d.]+) ([\d.]+)\)"/g)) {
    const x = Number(match[2]), y = Number(match[3])
    expect(x).toBeGreaterThanOrEqual(0); expect(y).toBeGreaterThanOrEqual(0)
    expect(x + 230).toBeLessThanOrEqual(width); expect(y + 72).toBeLessThanOrEqual(height)
    positions.set(match[1], [x, y])
  }
  expect(positions.size).toBe(snapshot.nodes.length)
  const paths = Array.from(graph.matchAll(/<path class="edge(?: gate)?" data-from="([^"]+)" data-to="([^"]+)" data-type="[^"]+" d="([^"]+)"/g))
  expect(paths).toHaveLength(snapshot.edges.length)
  for (const match of paths) {
    const from = positions.get(match[1])!, to = positions.get(match[2])!
    expect(to[1]).toBeGreaterThan(from[1] + 72)
    expect(match[3]).toStartWith(`M${from[0] + 115} ${from[1] + 72}V`)
    expect(match[3]).toEndWith(`H${to[0] + 115}V${to[1]}`)
    for (const coordinate of match[3].matchAll(/([HV])([\d.]+)/g)) expect(Number(coordinate[2])).toBeLessThanOrEqual(coordinate[1] === 'H' ? width : height)
  }
}

test('freshness uses source observation, not fresh render, heartbeat, or browser polling', () => {
  const snapshot = fixture()
  const renderTime = '2026-06-01T12:00:15.000Z'
  snapshot.timestamps.observerHeartbeatAt = renderTime
  snapshot.timestamps.lastHtmlRenderAt = renderTime
  snapshot.updatedAt = renderTime
  const html = renderGraphDashboard(snapshot, { ...context, renderedAt: renderTime })
  expect(html).toContain('Stale: 15 s ago')
  expect(html).toContain(`Source observation: ${time}`)
  expect(html).toContain(`Observer heartbeat: ${renderTime}`)
  expect(html).toContain(`This document rendered: ${renderTime}`)
  expect(renderGraphDashboard(snapshot, { ...context, renderedAt: '2026-06-01T12:00:14.999Z' })).toContain('Source observed: 14 s ago')
  snapshot.timestamps.lastSourceObservationAt = null
  expect(renderGraphDashboard(snapshot, context)).toContain('Stale: no source observation')
  snapshot.status = 'partial-failure'
  expect(renderGraphDashboard(snapshot, context)).toContain('Parent status: partial-failure. Automatic refresh stopped.')
})

test('recovery uncertainty stays visible in browser refresh and offline export without changing business state', async () => {
  const snapshot = fixture()
  for (const [recovery, label] of [['pending', 'Recovery pending:'], ['partial-failure', 'Recovery incomplete:']] as const) {
    const uncertain: GraphSnapshot = { ...snapshot, reporting: { recovery } }
    const html = renderGraphDashboard(uncertain, context)
    expect(html).toContain(label)
    expect(boot(html, 'file:').element('freshness').textContent).toContain(label)
    const browser = boot(renderGraphDashboard(snapshot, context))
    browser.reply({ ...uncertain, revision: 2 })
    await browser.tick()
    expect(browser.element('freshness').textContent).toContain(label)
    expect(browser.element('run-status').textContent).toBe('active')
    expect(nodeMarkup(html, 'a')).toContain('Planned')
  }
})

// Minimal browser platform for delivery/lifecycle checks only. It does not implement
// layout, selection rendering, or focus behavior; the parent owns real browser proof.
function boot(html: string, protocol = 'http:', storage: Record<string, string> = {}, deniedStorage = false, viewportWidth = 800) {
  const listeners = new Map<string, (event: any) => void>()
  const intervals = new Map<number, { fn: () => unknown; ms: number }>()
  const elements = new Map<string, any>()
  let sequence = 0
  function element(id: string): any {
    if (!elements.has(id)) elements.set(id, {
      id, innerHTML: '', textContent: '', scrollLeft: 0, scrollTop: 0, open: false, clientWidth: 800, clientHeight: 580,
      attributes: { width: '800', height: '580' },
      getAttribute(name: string) { return this.attributes[name] },
      setAttribute(name: string, value: string) { this.attributes[name] = value },
      addEventListener(name: string, handler: any) { listeners.set(`${id}:${name}`, handler) },
      focus() {},
    })
    return elements.get(id)
  }
  const fetches: { url: string; signal: AbortSignal }[] = []
  let reply: GraphSnapshot | null = null
  const sandbox = {
    document: { getElementById: element, activeElement: null, querySelectorAll: () => [], addEventListener: (name: string, fn: any) => listeners.set(name, fn) },
    window: { addEventListener: (name: string, fn: any) => listeners.set(name, fn) },
    localStorage: { getItem: (key: string) => { if (deniedStorage) throw new Error('Denied'); return storage[key] ?? null }, setItem: (key: string, value: string) => { if (deniedStorage) throw new Error('Denied'); storage[key] = value } },
    location: { protocol, href: `${protocol}//127.0.0.1:1234/runs/run-1/report`, origin: 'http://127.0.0.1:1234' },
    URL, AbortController,
    Date: class extends Date { static now() { return Date.parse(time) + 20000 } },
    setInterval: (fn: () => unknown, ms: number) => { const id = ++sequence; intervals.set(id, { fn, ms }); return id },
    clearInterval: (id: number) => intervals.delete(id),
    setTimeout: () => ++sequence, clearTimeout() {},
    fetch: async (url: URL, options: { signal: AbortSignal }) => { fetches.push({ url: url.href, signal: options.signal }); return { ok: !!reply, json: async () => reply } },
  }
  const dimensions = svg(html).match(/width="([\d.]+)" height="([\d.]+)"/)!
  element('dag').attributes = { width: dimensions[1], height: dimensions[2] }
  element('viewport').clientWidth = viewportWidth
  runInNewContext(script(html), sandbox)
  return { element, fetches, intervals, listeners, storage, reply(value: GraphSnapshot) { reply = value }, async tick() { for (const timer of [...intervals.values()]) if (timer.ms === 5000) timer.fn(); await Bun.sleep(0) } }
}

test('same-origin polling preserves the last graph on errors, pauses for keyboard use, and stops at parent terminal state', async () => {
  const snapshot = fixture([node('a', { execution: { state: 'running', observedAt: time } })])
  const browser = boot(renderGraphDashboard(snapshot, context))
  await browser.tick()
  expect(browser.fetches[0].url).toBe('http://127.0.0.1:1234/runs/run-1/snapshot')
  expect(browser.element('refresh').textContent).toContain('Disconnected')
  browser.listeners.get('keydown')!({ target: { id: 'viewport', closest: () => null }, key: 'Tab' })
  await browser.tick()
  expect(browser.fetches).toHaveLength(1)
  expect(browser.element('pause').textContent).toBe('Resume page refresh')
  const final = structuredClone(snapshot); final.revision = 2; final.status = 'succeeded'
  browser.reply(final)
  browser.element('viewport').scrollLeft = 125; browser.element('viewport').scrollTop = 35; browser.element('inspector').scrollTop = 50
  browser.listeners.get('pause:click')!({})
  await Bun.sleep(0)
  expect(browser.element('run-status').textContent).toBe('succeeded')
  expect(browser.element('viewport').scrollLeft).toBe(125)
  expect(browser.element('viewport').scrollTop).toBe(35)
  expect(browser.element('inspector').scrollTop).toBe(50)
  expect(browser.intervals.size).toBe(0)
  expect(browser.element('pause').disabled).toBe(true)
})

test('file exports, terminal reports, and foreign snapshot paths never fetch', async () => {
  const snapshot = fixture()
  const cases = [boot(renderGraphDashboard(snapshot, context), 'file:'), boot(renderGraphDashboard({ ...snapshot, status: 'interrupted' }, context)), boot(renderGraphDashboard(snapshot, { ...context, snapshotPath: 'https://foreign.example/snapshot' }))]
  for (const browser of cases) {
    await browser.tick()
    expect(browser.fetches).toHaveLength(0)
    expect(browser.intervals.size).toBe(0)
  }
})

test('view preferences tolerate corrupt storage and reject foreign or backward snapshots', async () => {
  const snapshot = fixture()
  const denied = boot(renderGraphDashboard(snapshot, context), 'http:', {}, true)
  denied.listeners.get('zoom-in:click')!({})
  expect(denied.element('zoom').textContent).toBe('125%')
  const storage = { 'pi-graph-view:run-1': '{bad' }
  const browser = boot(renderGraphDashboard(snapshot, context), 'http:', storage)
  browser.reply({ ...snapshot, revision: 2, runId: 'foreign', runName: 'Wrong run' })
  await browser.tick()
  expect(browser.element('run-name').textContent).not.toBe('Wrong run')
  browser.reply({ ...snapshot, revision: 0, runName: 'Old run' })
  await browser.tick()
  expect(browser.element('run-name').textContent).not.toBe('Old run')
  browser.listeners.get('zoom-in:click')!({})
  const saved = JSON.parse(storage['pi-graph-view:run-1'])
  expect(saved.zoom).toBe(1.25)
  expect(Object.keys(saved).sort()).toEqual(['inspectorTop', 'left', 'listOpen', 'selected', 'top', 'zoom'])
  storage['pi-graph-view:run-1'] = JSON.stringify({ ...saved, left: 50, top: 70, inspectorTop: 90, listOpen: true })
  const restored = boot(renderGraphDashboard(snapshot, context), 'http:', storage)
  expect(restored.element('zoom').textContent).toBe('125%')
  expect(restored.element('viewport').scrollLeft).toBe(50)
  expect(restored.element('viewport').scrollTop).toBe(70)
  expect(restored.element('inspector').scrollTop).toBe(90)
  expect(restored.element('overview').open).toBe(true)
})
