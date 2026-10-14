import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGraphDashboardStore, type GraphSnapshot } from './graph-dashboard-store'
import { createGraphDashboardServer } from './graph-dashboard-server'

const roots: string[] = []
const servers: ReturnType<typeof createGraphDashboardServer>[] = []
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true)
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'graph-dashboard-'))
  roots.push(root)
  const options = { directory: join(root, 'private'), runId: 'run-1', parentSessionId: 'parent-1' }
  return { root, options, store: createGraphDashboardStore(options) }
}
function fixture(revision = 1): GraphSnapshot {
  return {
    schemaVersion: 1, runId: 'run-1', parentSessionId: 'parent-1', revision,
    runName: 'Local graph', command: '/df-implement-tickets', currentStage: 'analysis',
    status: 'active', topology: 'unknown-future', updatedAt: '2026-06-01T12:00:00.000Z',
    timestamps: { observerHeartbeatAt: null, lastSourceObservationAt: null, lastWorkerActivityAt: null, lastHtmlRenderAt: null },
    nodes: [{ id: 'analysis-1', logicalId: 'analysis', label: 'Analysis', role: 'reviewer', stage: 'analysis', kind: 'worker', attempt: 1, currentAttempt: true, nativeId: null,
      execution: { state: 'planned', observedAt: null }, verification: { state: 'unverified', reason: null }, gate: null, blocker: null, wait: null, evidence: [] }],
    edges: [],
  }
}
test('private snapshots survive restart and reads do not fabricate observation timestamps', () => {
  const { store, options } = setup()
  const input = fixture()
  expect(store.read()).toBeNull()
  expect(store.write(input)).toEqual(input)
  expect(createGraphDashboardStore(options).read()).toEqual(input)
  expect(statSync(options.directory).mode & 0o777).toBe(0o700)
  expect(statSync(join(options.directory, 'run-1.json')).mode & 0o777).toBe(0o600)
  expect(JSON.parse(readFileSync(join(options.directory, 'run-1.json'), 'utf8'))).toEqual(input)
})
test('stale revisions, foreign runs, and foreign parent ownership preserve the last valid snapshot', () => {
  const { store, options } = setup()
  store.write(fixture(2))
  for (const input of [fixture(1), fixture(2), { ...fixture(3), runId: 'other' }, { ...fixture(3), parentSessionId: 'other' }]) {
    expect(() => store.write(input)).toThrow()
    expect(store.read()?.revision).toBe(2)
  }
  expect(() => createGraphDashboardStore({ ...options, parentSessionId: 'foreign' }).read()).toThrow()
})
test('malformed input, raw results, tasks, secrets, and excessive input fail before persistence', () => {
  const { store } = setup()
  const invalid: unknown[] = [null, [], {}, { ...fixture(), tasks: [] }, { ...fixture(), rawResults: 'secret' },
    { ...fixture(), secrets: {} }, { ...fixture(), revision: 1.5 }, { ...fixture(), updatedAt: 'not-time' },
    { ...fixture(), runName: 'x'.repeat(513) }, { ...fixture(), nodes: Array(513).fill(fixture().nodes[0]) },
    { ...fixture(), nodes: [{ ...fixture().nodes[0], execution: { state: 'answered', observedAt: null, output: 'secret' } }] },
    { ...fixture(), nodes: [{ ...fixture().nodes[0], evidence: [{ label: 'unsafe', href: 'javascript:alert(1)' }] }] }]
  for (const input of invalid) expect(() => store.write(input)).toThrow()
  expect(store.read()).toBeNull()
})
test('optional reporting recovery metadata accepts old snapshots and rejects invalid recovery states', () => {
  const { store } = setup()
  store.write(fixture())
  expect(store.read()).toEqual(fixture())
  for (const recovery of ['ready', 'pending', 'partial-failure'] as const) {
    const next = { ...store.read()!, revision: store.read()!.revision + 1, reporting: { recovery } }
    expect(store.write(next).reporting).toEqual({ recovery })
  }
  const before = store.read()
  for (const reporting of [null, {}, { recovery: 'verified' }, { recovery: 'ready', gate: 'cleared' }]) {
    expect(() => store.write({ ...before, revision: before!.revision + 1, reporting })).toThrow()
    expect(store.read()).toEqual(before)
  }
})
test('unknown dependencies, duplicate edges, and cycles fail; typed DAG edges persist', () => {
  const { store } = setup()
  const a = fixture().nodes[0]
  const b = { ...a, id: 'checks-1', logicalId: 'checks', label: 'Checks' }
  const input: GraphSnapshot = { ...fixture(), nodes: [a, b], edges: [{ from: a.id, to: b.id, type: 'native-after' }] }
  for (const edges of [[{ from: a.id, to: 'missing', type: 'native-after' }],
    [...input.edges, { from: b.id, to: a.id, type: 'parent-gate' }], [...input.edges, ...input.edges]]) {
    expect(() => store.write({ ...input, edges })).toThrow()
  }
  expect(store.write(input).edges).toEqual(input.edges)
})
test('retry appends retain failed attempts; answered does not imply verification or clear a gate', () => {
  const { store } = setup()
  const first = fixture()
  first.nodes[0].execution.state = 'answered'
  first.nodes[0].verification = { state: 'failed', reason: 'Checks fail' }
  first.nodes.push({ ...fixture().nodes[0], id: 'approval-1', logicalId: 'approval', kind: 'gate', gate: { state: 'waiting', clearingCondition: 'Parent approves checks' } })
  first.edges.push({ from: 'analysis-1', to: 'approval-1', type: 'parent-gate' })
  store.write(first)
  const retry = structuredClone(first)
  retry.revision = 2
  retry.nodes[0].currentAttempt = false
  retry.nodes.push({ ...fixture().nodes[0], id: 'analysis-2', attempt: 2 })
  retry.edges.push({ from: 'analysis-2', to: 'approval-1', type: 'verification' })
  expect(store.write(retry).nodes[0].verification.state).toBe('failed')
  expect(store.read()?.nodes[1].gate?.state).toBe('waiting')
  expect(store.read()?.nodes[2].verification.state).toBe('unverified')
  const removed = { ...structuredClone(retry), revision: 3, nodes: retry.nodes.slice(1), edges: retry.edges.slice(1) }
  expect(() => store.write(removed)).toThrow()
  const overwritten = structuredClone(retry)
  overwritten.revision = 3
  overwritten.nodes[0].verification.state = 'verified'
  expect(() => store.write(overwritten)).toThrow()
})
test('historical attempts remain unchanged when an input changes object key order', () => {
  const { store } = setup()
  const input = fixture()
  input.nodes[0].currentAttempt = false
  input.nodes.push({ ...fixture().nodes[0], id: 'analysis-2', attempt: 2 })
  store.write(input)
  const next = structuredClone(input)
  next.revision = 2
  next.nodes[0].verification = { reason: null, state: 'unverified' }
  expect(store.write(next)).toEqual(next)
})
test('locked writers, changed declarations, removed edges, and older observations preserve the snapshot', () => {
  const { store, options } = setup()
  const input = fixture()
  input.nodes.push({ ...fixture().nodes[0], id: 'checks-1', logicalId: 'checks' })
  input.edges.push({ from: 'analysis-1', to: 'checks-1', type: 'verification' })
  input.timestamps.lastSourceObservationAt = input.updatedAt
  store.write(input)
  const next = { ...structuredClone(input), revision: 2 }
  mkdirSync(join(options.directory, 'run-1.lock'), { mode: 0o700 })
  expect(() => store.write(next)).toThrow('lock')
  expect(store.read()).toEqual(input)
  rmSync(join(options.directory, 'run-1.lock'), { recursive: true })
  const changed = structuredClone(next)
  changed.nodes[0].attempt = 2
  const stale = structuredClone(next)
  stale.timestamps.lastSourceObservationAt = null
  for (const bad of [changed, stale, { ...next, edges: [] }]) expect(() => store.write(bad)).toThrow()
  expect(store.read()).toEqual(input)
})
test('atomic replacement lets a concurrent reader see only complete snapshots', async () => {
  const { store, options } = setup()
  store.write(fixture())
  const moduleUrl = new URL('./graph-dashboard-store.ts', import.meta.url).href
  const child = Bun.spawn([process.execPath, '--eval', `
    import { createGraphDashboardStore } from ${JSON.stringify(moduleUrl)};
    const store = createGraphDashboardStore(${JSON.stringify(options)});
    for (let revision = 2; revision <= 40; revision++) {
      const next = store.read(); next.revision = revision;
      next.runName = String(revision).padEnd(512, 'x');
      store.write(next); await Bun.sleep(2);
    }
  `], { stdout: 'ignore', stderr: 'pipe' })
  let previous = 1
  try {
    while (child.exitCode === null) {
      const snapshot = store.read()!
      expect(snapshot.revision).toBeGreaterThanOrEqual(previous)
      previous = snapshot.revision
      expect(snapshot.nodes).toEqual(fixture().nodes)
      await Bun.sleep(1)
    }
    expect(await child.exited).toBe(0)
    expect(store.read()?.revision).toBe(40)
  } finally { child.kill(); await child.exited }
})
test('unsafe labels remain literal data and no store evaluation occurs', () => {
  const { store } = setup()
  const input = fixture()
  input.nodes[0].label = '</script><img src=x onerror=alert(1)>'
  expect(store.write(input).nodes[0].label).toBe(input.nodes[0].label)
  expect(store.read()?.nodes[0].label).toBe(input.nodes[0].label)
})
test('unsafe permissions, symlink snapshots, and malformed disk data fail closed', () => {
  const { store, options, root } = setup()
  store.write(fixture())
  chmodSync(join(options.directory, 'run-1.json'), 0o644)
  expect(() => store.read()).toThrow()
  chmodSync(join(options.directory, 'run-1.json'), 0o600)
  writeFileSync(join(options.directory, 'run-1.json'), '{')
  expect(() => store.write(fixture(2))).toThrow()
  rmSync(join(options.directory, 'run-1.json'))
  writeFileSync(join(root, 'outside'), JSON.stringify(fixture()), { mode: 0o600 })
  symlinkSync(join(root, 'outside'), join(options.directory, 'run-1.json'))
  expect(() => store.read()).toThrow()
  chmodSync(options.directory, 0o755)
  expect(() => createGraphDashboardStore(options)).toThrow()
})
function serve(allowedHosts: string[] = []) {
  const state = setup()
  state.store.write(fixture())
  const server = createGraphDashboardServer({ store: state.store, port: 0, allowedHosts, renderer: (snapshot, context) =>
    `<!doctype html><title>${snapshot.runId}</title><p>${context.snapshotPath}</p>` })
  servers.push(server)
  return { ...state, server, base: `http://127.0.0.1:${server.port}` }
}
test('loopback HTTP serves only health and exact known run artifacts, with no browser write API', async () => {
  const { base, store, server } = serve()
  expect(server.hostname).toBe('127.0.0.1')
  expect((await fetch(`${base}/health`)).status).toBe(200)
  const snapshot = await fetch(`${base}/runs/run-1/snapshot`)
  expect(await snapshot.json()).toEqual(fixture())
  expect(snapshot.headers.get('access-control-allow-origin')).toBeNull()
  expect(snapshot.headers.get('cache-control')).toBe('no-store')
  const report = await fetch(`${base}/runs/run-1/report`)
  expect(report.headers.get('content-type')).toContain('text/html')
  expect(report.headers.get('content-security-policy')).toContain("connect-src 'self'")
  expect(await report.text()).toContain('/runs/run-1/snapshot')
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']) {
    expect((await fetch(`${base}/runs/run-1/snapshot`, { method })).status).toBe(405)
  }
  for (const path of ['/runs/other/snapshot', '/runs/run-1', '/etc/passwd', '/runs/run-1/%2e%2e%2fsnapshot', '/runs/run-1/snapshot?path=/etc/passwd']) {
    expect((await fetch(`${base}${path}`)).status).toBe(404)
  }
  expect(store.read()).toEqual(fixture())
})
test('hostile Host, Origin, and browser cross-site requests fail closed', async () => {
  const { base } = serve()
  const hostileHeaders: Record<string, string>[] = [{ Host: 'evil.example' }, { Host: 'localhost' }, { Origin: 'https://evil.example' },
    { Origin: 'null' }, { 'Sec-Fetch-Site': 'cross-site' }, { Host: '127.0.0.1:0' }, { Host: '127.0.0.1:65536' }]
  for (const headers of hostileHeaders) {
    expect((await fetch(`${base}/health`, { headers })).status).toBe(403)
  }
  expect((await fetch(`${base}/health`, { headers: { Origin: base } })).status).toBe(200)
})
test('SSH forwarding accepts a different loopback port but rejects mismatched origins', async () => {
  const { base, server } = serve()
  const localPort = server.port === 39615 ? 39616 : 39615
  const host = `127.0.0.1:${localPort}`
  const origin = `http://${host}`
  const headers = { Host: host, Origin: origin, 'Sec-Fetch-Site': 'same-origin' }
  expect((await fetch(`${base}/runs/run-1/report`, { headers })).status).toBe(200)
  const snapshot = await fetch(`${base}/runs/run-1/snapshot`, { headers })
  expect(snapshot.status).toBe(200)
  expect(await snapshot.json()).toEqual(fixture())
  expect((await fetch(`${base}/health`, { headers: { Host: host, 'Sec-Fetch-Site': 'none' } })).status).toBe(200)
  expect((await fetch(`${base}/health`, { headers: { ...headers, Origin: base } })).status).toBe(403)
  expect((await fetch(`${base}/health`, { headers: { ...headers, 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(403)
})
test('localhost forwarding and explicit host allowlists retain same-origin protection', async () => {
  const { base } = serve(['dashboard.example'])
  for (const host of ['localhost:52356', 'dashboard.example:52356']) {
    const headers = { Host: host, Origin: `http://${host}`, 'Sec-Fetch-Site': 'same-origin' }
    expect((await fetch(`${base}/runs/run-1/report`, { headers })).status).toBe(200)
    expect((await fetch(`${base}/runs/run-1/snapshot`, { headers })).status).toBe(200)
    expect((await fetch(`${base}/health`, { headers: { ...headers, Origin: base } })).status).toBe(403)
    expect((await fetch(`${base}/health`, { headers: { ...headers, 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(403)
  }
  for (const host of ['evil.example:52356', 'localhost.evil.example:52356', 'localhost:65536']) {
    expect((await fetch(`${base}/health`, { headers: { Host: host } })).status).toBe(403)
  }
  const defaults = serve()
  expect((await fetch(`${defaults.base}/health`, { headers: { Host: 'dashboard.example:52356' } })).status).toBe(403)
})
test('the server works without a renderer and does not publish an absent run', async () => {
  const { store } = setup()
  const server = createGraphDashboardServer({ store, port: 0 })
  servers.push(server)
  const base = `http://127.0.0.1:${server.port}`
  expect((await fetch(`${base}/runs/run-1/snapshot`)).status).toBe(404)
  store.write(fixture())
  expect((await fetch(`${base}/runs/run-1/snapshot`)).status).toBe(200)
  expect((await fetch(`${base}/runs/run-1/report`)).status).toBe(503)
})
test('renderer failures disclose no details and leave persisted snapshot intact', async () => {
  const { store } = setup()
  store.write(fixture())
  const server = createGraphDashboardServer({ store, port: 0, renderer: () => { throw new Error('private-path-secret') } })
  servers.push(server)
  const response = await fetch(`http://127.0.0.1:${server.port}/runs/run-1/report`)
  expect(response.status).toBe(500)
  expect(await response.text()).not.toContain('private-path-secret')
  expect(store.read()).toEqual(fixture())
})
