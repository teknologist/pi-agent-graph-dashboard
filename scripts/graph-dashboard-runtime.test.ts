import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { createGraphDashboardRuntime, type DashboardContext, type DashboardInput, type Declaration } from './graph-dashboard-runtime'
import { createGraphDashboardStore, type GraphSnapshot } from './graph-dashboard-store'

// Primary owner: the production runtime called by the Pi adapter. These tests
// exercise public receipts/events, real persistence, and branch checkpoints.
// The host supplies Pi's public context; it does not implement runtime rules.
const roots: string[] = []
const runtimes: ReturnType<typeof createGraphDashboardRuntime>[] = []
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
const parent = 'parent-1'
const oldTime = '2026-06-01T12:00:00.000Z'
function host(sessionId = parent) {
  const entries: { type: string; id: string; customType?: string; data?: unknown; message?: { role: string; toolName: string; toolCallId: string; isError: boolean; content: unknown; details: unknown } | { role: 'custom'; customType: string; timestamp: number; content: string; details: unknown } }[] = []
  const statuses: (string | undefined)[] = []
  const errors: string[] = []
  const calls: { name: string; args: unknown }[] = []
  let failCheckpointCountdown = 0
  let status: (args: unknown) => Promise<unknown> = async () => executionResult(receipt([]), true)
  const ctx: DashboardContext = {
    hasUI: true,
    sessionManager: {
      getSessionId: () => sessionId,
      getSessionFile: () => `/unused-public-session-reference/${sessionId}.jsonl`,
      getBranch: () => entries,
      getLeafId: () => entries.at(-1)?.id ?? null,
    },
    ui: { notify: (text: string) => errors.push(text), setStatus: (_key, value) => { statuses.push(value) } },
    executeTool: async (name: string, args: unknown) => { calls.push({ name, args }); return status(args) },
  }
  return {
    ctx, entries, calls, errors, statuses,
    failCheckpoint: (count: number) => { failCheckpointCountdown = count },
    appendEntry: (customType: string, data: unknown) => {
      if (customType === 'agent-graph-dashboard:v1' && failCheckpointCountdown > 0 && --failCheckpointCountdown === 0) throw new Error('injected checkpoint append failure')
      entries.push({ type: 'custom', id: `entry-${entries.length}`, customType, data: structuredClone(data) })
    },
    status: (handler: typeof status) => { status = handler },
  }
}
function setup(owner = host()) {
  const root = mkdtempSync(join(tmpdir(), 'graph runtime-'))
  roots.push(root)
  const directory = join(root, 'private')
  const runtime = createGraphDashboardRuntime({ directory, appendEntry: owner.appendEntry })
  runtimes.push(runtime)
  return { runtime, owner, directory }
}
function declaration(id = 'analysis-1', nativeName = 'local-analysis-r1'): Declaration {
  return { id, logicalId: id, label: id, role: 'reviewer', stage: 'analysis', kind: 'worker', attempt: 1, nativeName, gate: null }
}
function create(nodes = [declaration()]): Extract<DashboardInput, { operation: 'create' }> {
  return { operation: 'create', runName: 'Local review', command: '/gitlab-address-pr-agent-review', currentStage: 'analysis', topology: 'unknown-future', nodes, edges: [] }
}
// The public AgentToolDetails shape comes from installed pi-agents tools.ts.
// Task, output, and activity contain sentinel text to catch accidental export.
function agent(name: string, id: string, state = 'working') {
  return { id, name, task: 'DO-NOT-EXPORT-TASK', cwd: '/unused', state, closed: false,
    createdAt: Date.parse(oldTime), stateSince: Date.parse(oldTime), lastActivityAt: Date.parse(oldTime),
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }, activity: { summary: 'DO-NOT-EXPORT-REASONING' } }
}
function receipt(agents: ReturnType<typeof agent>[], at = Date.now()) {
  return { content: [{ type: 'text', text: 'DO-NOT-EXPORT-OUTPUT' }], details: { at, started: true, agents } }
}
// Installed diagnostic confirms executeTool returns this execution wrapper,
// not a tool receipt at the top level. Unused toolCall metadata stays inert.
function executionResult(result: ReturnType<typeof receipt>, isError = false) {
  return { durationMs: 0, isError, result: { ...result, structuredContent: undefined }, toolCall: { type: 'toolCall', id: 'status-call', name: 'agent_status', arguments: {} } }
}
async function launch(state: Pick<ReturnType<typeof setup>, 'runtime' | 'owner'>, callId = 'launch-1', agents = [agent('local-analysis-r1', 'native-1')]) {
  // Drive the real public event boundary. The runtime, not this fixture, records
  // launch ownership. The raw public receipt remains available on the branch.
  await state.runtime.observe({ type: 'tool_execution_start', toolName: 'agent_spawn', toolCallId: callId, args: { name: agents[0].name } }, state.owner.ctx)
  const result = receipt(agents)
  state.owner.entries.push({ type: 'message', id: `receipt-${callId}`, message: { role: 'toolResult', toolName: 'agent_spawn', toolCallId: callId, isError: false, ...result } })
  await state.runtime.observe({ type: 'tool_execution_end', toolName: 'agent_spawn', toolCallId: callId, isError: false, result }, state.owner.ctx)
}
function read(directory: string, runId: string): GraphSnapshot {
  return createGraphDashboardStore({ directory, runId, parentSessionId: parent }).read()!
}
async function bound(state: ReturnType<typeof setup>) {
  const result = await state.runtime.execute(create(), state.owner.ctx)
  await launch(state)
  await state.runtime.execute({ operation: 'bind', runId: result.runId, launchToolCallId: 'launch-1', nodeIds: ['analysis-1'] }, state.owner.ctx)
  return result.runId as string
}

test('footer shows colored activity, current stage, and parallel current nodes', async () => {
  const state = setup()
  const nodes: Declaration[] = ['analysis-1', 'analysis-2'].map(id => ({ ...declaration(id), kind: 'parent', nativeName: null }))
  const result = await state.runtime.execute(create(nodes), state.owner.ctx)
  await state.runtime.execute({ operation: 'update', runId: result.runId, nodes: [
    { id: 'analysis-1', execution: 'running' }, { id: 'analysis-2', execution: 'running' },
  ] }, state.owner.ctx)
  expect(state.owner.statuses.at(-1)).toContain('\x1b[34mrunning\x1b[39m · analysis · analysis-1 +1')
  expect(state.owner.statuses.at(-1)).toContain('\x1b]8;;')
  await state.runtime.execute({ operation: 'update', runId: result.runId, nodes: [
    { id: 'analysis-1', execution: 'failed' },
  ] }, state.owner.ctx)
  expect(state.owner.statuses.at(-1)).toContain('\x1b[31mblocked\x1b[39m · analysis · analysis-1')
  await state.runtime.execute({ operation: 'update', runId: result.runId, status: 'succeeded' }, state.owner.ctx)
  expect(state.owner.statuses.at(-1)).toContain('\x1b[32msucceeded\x1b[39m · analysis')
  expect(state.owner.statuses.at(-1)).not.toContain('analysis-1')
})

// MR75's first public checkpoint declares these phases with only two edges.
// Names remain checkpoint metadata; topology must not supply native receipts.
test('MR75 sparse declarations produce connected command phases and parallel analysis prerequisites', async () => {
  const state = setup()
  const stages = ['MR identity', 'shared review-data fetch', 'analysis', 'selection approval', 'serial edits', 'checks', 'independent audit', 'GitLab publication', 'Linear sync', 'final report']
  const nodes: Declaration[] = stages.map((stage, index) => ({ id: `phase-${index}`, logicalId: `phase-${index}`, label: stage, role: 'parent phase', stage, kind: 'parent', attempt: 1, nativeName: null, gate: null }))
  nodes.push({ id: 'approval', logicalId: 'approval', label: 'Scope approval', role: 'approval gate', stage: 'selection approval', kind: 'gate', attempt: 1, nativeName: null, gate: { state: 'waiting', clearingCondition: 'Confirmed scope' } })
  const { runId } = await state.runtime.execute({ ...create(nodes), edges: [{ from: 'phase-2', to: 'approval', type: 'parent-gate' }, { from: 'approval', to: 'phase-4', type: 'parent-gate' }] }, state.owner.ctx)
  const initial = read(state.directory, runId)
  for (let index = 1; index < stages.length; index++) expect(initial.edges).toContainEqual({ from: `phase-${index - 1}`, to: `phase-${index}`, type: 'parent-gate' })
  const workers = ['lifecycle', 'mapping', 'policy'].map(role => declaration(`analysis-${role}`, `mr-75-analysis-b1-${role}-test`))
  await state.runtime.execute({ operation: 'declare', runId, nodes: workers, edges: workers.map(worker => ({ from: worker.id, to: 'phase-2', type: 'verification' })) }, state.owner.ctx)
  const snapshot = read(state.directory, runId)
  expect(snapshot.nodes.filter(node => !snapshot.edges.some(edge => edge.to === node.id)).map(node => node.id)).toEqual(['phase-0'])
  for (const worker of workers) {
    expect(snapshot.edges).toContainEqual({ from: 'phase-1', to: worker.id, type: 'parent-gate' })
    expect(snapshot.edges).toContainEqual({ from: worker.id, to: 'phase-2', type: 'verification' })
    expect(snapshot.nodes.find(node => node.id === worker.id)?.nativeId).toBeNull()
    expect(snapshot.nodes.find(node => node.id === worker.id)?.execution).toEqual({ state: 'planned', observedAt: null })
  }
  expect(snapshot.edges.some(edge => workers.some(worker => worker.id === edge.from) && workers.some(worker => worker.id === edge.to))).toBe(false)
  // Publication remains per item. No gate for item X can block item Y.
  const gates: Declaration[] = ['X', 'Y'].map(item => ({ id: `publish-${item}`, logicalId: `publish-${item}`, label: item, role: 'publication gate', stage: 'GitLab publication', kind: 'gate', attempt: 1, nativeName: null, gate: { state: 'waiting', clearingCondition: 'Item checks and audit' } }))
  await state.runtime.execute({ operation: 'declare', runId, nodes: gates, edges: [] }, state.owner.ctx)
  await state.runtime.execute({ operation: 'update', runId, nodes: [{ id: 'publish-X', gate: { state: 'cleared', clearingCondition: 'Item checks and audit' } }, { id: 'publish-Y', gate: { state: 'blocked', clearingCondition: 'Item checks and audit' } }] }, state.owner.ctx)
  const partial = read(state.directory, runId)
  expect(partial.nodes.find(node => node.id === 'publish-X')?.gate?.state).toBe('cleared')
  expect(partial.edges.filter(edge => edge.from.startsWith('publish-') || edge.to.startsWith('publish-'))).toEqual([])
})

test('empty MR create supplies phases and approval while DF conditional topology stays caller-declared', async () => {
  const mr = setup(), df = setup()
  const result = await mr.runtime.execute(create([]), mr.owner.ctx)
  const snapshot = read(mr.directory, result.runId)
  expect(snapshot.nodes.filter(node => node.kind === 'parent')).toHaveLength(10)
  expect(snapshot.nodes.filter(node => !snapshot.edges.some(edge => edge.to === node.id)).map(node => node.stage)).toEqual(['MR identity'])
  expect(snapshot.nodes.find(node => node.id === 'command-selection-approval')?.gate?.state).toBe('waiting')
  expect(snapshot.nodes.every(node => node.execution.state === 'planned' && node.verification.state === 'unverified' && node.nativeId === null)).toBe(true)
  const dfResult = await df.runtime.execute({ ...create([]), command: '/df-implement-tickets' }, df.owner.ctx)
  expect(read(df.directory, dfResult.runId).nodes).toEqual([])
  expect(read(df.directory, dfResult.runId).edges).toEqual([])
})

test.each([null, '', '   '])('nameless worker %j cannot persist a declaration', async nativeName => {
  const state = setup()
  await expect(state.runtime.execute(create([{ ...declaration(), nativeName }]), state.owner.ctx)).rejects.toThrow('native name')
  expect(state.owner.entries).toEqual([])
  expect(readdirSync(join(state.directory, '..'))).toEqual([])
})

test('MR delivery node sits between audit and publication without changing fixed phases', async () => {
  const state = setup()
  const { runId } = await state.runtime.execute(create([]), state.owner.ctx)
  const node: Declaration = { id: 'command-commit-push', logicalId: 'command-commit-push', label: 'Commit and push', role: 'verified Git delivery', stage: 'GitLab publication', kind: 'parent', attempt: 1, nativeName: null, gate: null }
  await state.runtime.execute({ operation: 'declare', runId, nodes: [node], edges: [{ from: 'command-phase-6', to: node.id, type: 'parent-gate' }, { from: node.id, to: 'command-phase-7', type: 'verification' }] }, state.owner.ctx)
  await state.runtime.execute({ operation: 'update', runId, nodes: [{ id: node.id, execution: 'answered', verification: { state: 'verified', reason: 'Remote and MR head match delivered SHA' } }] }, state.owner.ctx)
  const snapshot = read(state.directory, runId)
  expect(snapshot.nodes.filter(item => item.kind === 'parent' && item.id.startsWith('command-phase-'))).toHaveLength(10)
  expect(snapshot.edges).toContainEqual({ from: 'command-phase-6', to: node.id, type: 'parent-gate' })
  expect(snapshot.edges).toContainEqual({ from: node.id, to: 'command-phase-7', type: 'verification' })
  expect(snapshot.nodes.find(item => item.id === node.id)?.verification.state).toBe('verified')
})

test('workspace is captured from Git and explicit worktree updates persist safely', async () => {
  const state = setup()
  const cwd = join(state.directory, '..', 'repo')
  mkdirSync(cwd)
  execFileSync('git', ['init', '--quiet', '--initial-branch=dashboard-test', cwd])
  state.owner.ctx.cwd = cwd
  const { runId } = await state.runtime.execute(create([]), state.owner.ctx)
  const captured = read(state.directory, runId).workspace!
  expect(captured.branch).toBe('dashboard-test')
  expect(captured.worktree).toBe(execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim())
  const workspace = { branch: 'feature/review', worktree: '/repo/worktrees/review' }
  await state.runtime.execute({ operation: 'update', runId, workspace }, state.owner.ctx)
  expect(read(state.directory, runId).workspace).toEqual(workspace)
  await expect(state.runtime.execute({ operation: 'update', runId, workspace: { branch: 'bad\\nbranch', worktree: 'relative' } }, state.owner.ctx)).rejects.toThrow()
  expect(read(state.directory, runId).workspace).toEqual(workspace)
  await state.runtime.execute({ operation: 'update', runId, workspace: { ...workspace, branch: null } }, state.owner.ctx)
  expect(read(state.directory, runId).workspace?.branch).toBeNull()
})

test('adapter launch observation binds exact declared workers without a parent bind call', async () => {
  const state = setup()
  const { runId } = await state.runtime.execute(create(), state.owner.ctx)
  await state.runtime.observe({ type: 'tool_execution_start', toolName: 'agent_spawn', toolCallId: 'automatic-launch', args: { name: 'local-analysis-r1' } }, state.owner.ctx, true)
  const result = receipt([agent('local-analysis-r1', 'native-automatic', 'idle')])
  await state.runtime.observe({ type: 'tool_execution_end', toolName: 'agent_spawn', toolCallId: 'automatic-launch', isError: false, result }, state.owner.ctx, true)
  expect(read(state.directory, runId).nodes.find(node => node.id === 'analysis-1')?.nativeId).toBe('native-automatic')
  expect(read(state.directory, runId).nodes.find(node => node.id === 'analysis-1')?.execution.state).toBe('answered')
  expect(read(state.directory, runId).nodes.find(node => node.id === 'analysis-1')?.verification.state).toBe('unverified')
  await state.runtime.execute({ operation: 'bind', runId, launchToolCallId: 'automatic-launch', nodeIds: ['analysis-1'] }, state.owner.ctx)
  const checkpoint = state.owner.entries.filter(entry => entry.customType === 'agent-graph-dashboard:v1').at(-1)!.data as { bindings: unknown[] }
  expect(checkpoint.bindings).toHaveLength(1)
})

test('adapter binds a parallel graph only from a complete matching launch receipt', async () => {
  const state = setup()
  const workers = [declaration('worker-a', 'worker-a'), declaration('worker-b', 'worker-b')]
  const { runId } = await state.runtime.execute(create(workers), state.owner.ctx)
  await state.runtime.observe({ type: 'tool_execution_start', toolName: 'agent_spawn_graph', toolCallId: 'outer/graph', args: { agents: workers.map(worker => ({ name: worker.nativeName })) } }, state.owner.ctx, true)
  const agents = [agent('worker-a', 'native-a', 'idle'), agent('worker-b', 'native-b', 'working')]
  await state.runtime.observe({ type: 'tool_execution_end', toolName: 'agent_spawn_graph', toolCallId: 'outer/graph', isError: false, result: receipt(agents.slice(0, 1)) }, state.owner.ctx, true)
  expect(read(state.directory, runId).nodes.filter(node => node.kind === 'worker').every(node => node.nativeId === null)).toBe(true)
  await state.runtime.observe({ type: 'tool_execution_end', toolName: 'agent_spawn_graph', toolCallId: 'outer/graph', isError: false, result: receipt(agents) }, state.owner.ctx, true)
  expect(read(state.directory, runId).nodes.filter(node => node.kind === 'worker').map(node => [node.nativeId, node.execution.state])).toEqual([['native-a', 'answered'], ['native-b', 'running']])
  await expect(state.runtime.execute({ operation: 'bind', runId, launchToolCallId: 'foreign-launch', nodeIds: ['worker-a'] }, state.owner.ctx)).rejects.toThrow('does not belong')
})

test('adapter cannot bind a same-name result without an owned launch start', async () => {
  const state = setup()
  const { runId } = await state.runtime.execute(create(), state.owner.ctx)
  await state.runtime.observe({ type: 'tool_execution_end', toolName: 'agent_spawn', toolCallId: 'foreign-launch', isError: false, result: receipt([agent('local-analysis-r1', 'foreign-id', 'idle')]) }, state.owner.ctx, true)
  expect(read(state.directory, runId).nodes.find(node => node.id === 'analysis-1')?.nativeId).toBeNull()
})

// Regression r6: every published snapshot owner must contain its complete
// declaration names and bindings. Use actual production checkpoints/prefixes.
for (const operation of ['declare', 'bind'] as const) {
  async function prepareCheckpointCase() {
    const state = setup()
    const { runId } = await state.runtime.execute(create(), state.owner.ctx)
    if (operation === 'bind') await launch(state)
    const input: DashboardInput = operation === 'bind'
      ? { operation, runId, launchToolCallId: 'launch-1', nodeIds: ['analysis-1'] }
      : { operation, runId, nodes: [declaration('checks-1', 'local-checks-r1')], edges: [] }
    return { ...state, runId, input }
  }

  test(`checkpoint metadata ${operation} is complete in every accepted publication`, async () => {
    const state = await prepareCheckpointCase()
    const start = state.owner.entries.length
    await state.runtime.execute(state.input, state.owner.ctx)
    const emitted = state.owner.entries.slice(start).filter(entry => entry.customType === 'agent-graph-dashboard:v1')
    expect(emitted.length).toBeGreaterThan(0)
    for (const entry of emitted) {
      const saved = entry.data as { snapshot: GraphSnapshot; names: Record<string, string>; bindings: unknown[] }
      expect(saved.snapshot).toEqual(read(state.directory, state.runId))
      if (operation === 'bind') expect(saved.bindings).toEqual([{ nodeId: 'analysis-1', name: 'local-analysis-r1', nativeId: 'native-1', launchToolCallId: 'launch-1' }])
      else expect(saved.names).toEqual({ 'analysis-1': 'local-analysis-r1', 'checks-1': 'local-checks-r1' })
    }
    expect(emitted).toHaveLength(1)
  })

  test(`checkpoint metadata ${operation} incomplete same-revision prefix fails visibly`, async () => {
    const state = await prepareCheckpointCase()
    const start = state.owner.entries.length
    await state.runtime.execute(state.input, state.owner.ctx)
    const index = state.owner.entries.findIndex((entry, index) => index >= start && entry.customType === 'agent-graph-dashboard:v1')
    const saved = state.owner.entries[index].data as { snapshot: GraphSnapshot; names: Record<string, string>; bindings: unknown[] }
    expect(saved.snapshot).toEqual(read(state.directory, state.runId))
    // Current production already emits this incomplete prefix. After repair,
    // remove just that metadata to exercise legacy malformed checkpoint rejection.
    if (operation === 'bind') saved.bindings = []
    else delete saved.names['checks-1']
    state.owner.entries.splice(index + 1)
    await state.runtime.close()
    const runtime = createGraphDashboardRuntime({ directory: state.directory, appendEntry: state.owner.appendEntry })
    runtimes.push(runtime)
    const before = read(state.directory, state.runId)
    const entries = structuredClone(state.owner.entries)
    await runtime.restore(state.owner.ctx)
    expect(state.owner.errors.some(text => /checkpoint.*(failed|invalid|inconsistent)/i.test(text))).toBe(true)
    expect(read(state.directory, state.runId)).toEqual(before)
    expect(state.owner.entries).toEqual(entries)
    await expect(runtime.execute({ operation: 'recover', runId: state.runId }, state.owner.ctx)).rejects.toThrow()
    expect(state.owner.calls).toHaveLength(0)
  })

  test(`checkpoint metadata ${operation} avoids incomplete first publication when second append fails`, async () => {
    const state = await prepareCheckpointCase()
    const start = state.owner.entries.length
    state.owner.failCheckpoint(2)
    // One complete publication must suffice: a second append is unnecessary.
    await state.runtime.execute(state.input, state.owner.ctx)
    state.owner.failCheckpoint(0)
    const emitted = state.owner.entries.slice(start).filter(entry => entry.customType === 'agent-graph-dashboard:v1')
    expect(emitted).toHaveLength(1)
    await state.runtime.close()
    const runtime = createGraphDashboardRuntime({ directory: state.directory, appendEntry: state.owner.appendEntry })
    runtimes.push(runtime)
    await runtime.restore(state.owner.ctx)
    if (operation === 'bind') {
      state.owner.status(async () => executionResult(receipt([agent('local-analysis-r1', 'native-1', 'idle')])))
      await runtime.execute({ operation: 'recover', runId: state.runId }, state.owner.ctx)
      expect(state.owner.calls).toEqual([{ name: 'agent_status', args: { name: 'local-analysis-r1' } }])
      expect(read(state.directory, state.runId).nodes[0].execution.state).toBe('answered')
    } else {
      await launch({ runtime, owner: state.owner }, 'launch-checks', [agent('local-checks-r1', 'native-2')])
      await runtime.execute({ operation: 'bind', runId: state.runId, launchToolCallId: 'launch-checks', nodeIds: ['checks-1'] }, state.owner.ctx)
      expect(read(state.directory, state.runId).nodes.find(node => node.id === 'checks-1')?.nativeId).toBe('native-2')
    }
    expect(state.owner.errors).toHaveLength(0)
  })

  test(`checkpoint metadata ${operation} first append failure restores visibly read-only`, async () => {
    const state = await prepareCheckpointCase()
    const entries = structuredClone(state.owner.entries)
    state.owner.failCheckpoint(1)
    await expect(state.runtime.execute(state.input, state.owner.ctx)).rejects.toThrow('injected checkpoint append failure')
    expect(state.owner.entries).toEqual(entries)
    const persisted = read(state.directory, state.runId)
    await state.runtime.close()
    const runtime = createGraphDashboardRuntime({ directory: state.directory, appendEntry: state.owner.appendEntry })
    runtimes.push(runtime)
    await runtime.restore(state.owner.ctx)
    expect(state.owner.errors.some(text => /checkpoint|read-only/i.test(text))).toBe(true)
    expect(read(state.directory, state.runId)).toEqual(persisted)
    await expect(runtime.execute({ operation: 'recover', runId: state.runId }, state.owner.ctx)).rejects.toThrow()
    expect(state.owner.calls).toHaveLength(0)
  })

  test(`checkpoint metadata ${operation} primary writer rejection preserves original owner`, async () => {
    const state = await prepareCheckpointCase()
    const original = read(state.directory, state.runId)
    const entries = structuredClone(state.owner.entries)
    const lock = join(state.directory, `${state.runId}.lock`)
    mkdirSync(lock, { mode: 0o700 })
    try { await expect(state.runtime.execute(state.input, state.owner.ctx)).rejects.toThrow('writer lock') }
    finally { rmSync(lock, { recursive: true }) }
    expect(read(state.directory, state.runId)).toEqual(original)
    expect(state.owner.entries).toEqual(entries)
    await state.runtime.close()
    const runtime = createGraphDashboardRuntime({ directory: state.directory, appendEntry: state.owner.appendEntry })
    runtimes.push(runtime)
    await runtime.restore(state.owner.ctx)
    await runtime.execute(state.input, state.owner.ctx)
    const after = read(state.directory, state.runId)
    expect(after.nodes.find(node => node.id === (operation === 'bind' ? 'analysis-1' : 'checks-1'))?.nativeId).toBe(operation === 'bind' ? 'native-1' : null)
    expect(after.nodes.filter(node => node.kind === 'worker')).toHaveLength(operation === 'bind' ? 1 : 2)
    expect(state.owner.errors).toHaveLength(0)
  })
}

// Regression r5: delayed binding must merge supported native observations,
// not only terminal custom messages. Replaying the identical event after bind
// is the causal control: only delivery order changes, not receipt validity.
const prebindOrders = [
  { order: 'graph-status', toolName: 'agent_status', nativeState: 'working', expected: 'running', updateOnly: false },
  { order: 'terminal-send', toolName: 'agent_send', nativeState: 'working', expected: 'running', updateOnly: false },
  { order: 'wait', toolName: 'agent_wait', nativeState: 'idle', expected: 'answered', updateOnly: false },
  { order: 'stop', toolName: 'agent_stop', nativeState: 'interrupted', expected: 'interrupted', updateOnly: false },
  { order: 'wait-update-only', toolName: 'agent_wait', nativeState: 'idle', expected: 'answered', updateOnly: true },
  // Regression r9: nested calls emit events but have no transcript toolResult.
  // No partial update exists to retain this completed pre-bind status receipt.
  { order: 'nested-status-end', toolName: 'agent_status', nativeState: 'working', expected: 'running', updateOnly: false },
] as const
for (const { order, toolName, nativeState, expected, updateOnly } of prebindOrders) for (const restart of [false, true]) {
  test(`prebind native receipt ${order} restart=${restart} retains newest exact owned observation`, async () => {
    const state = setup()
    const input = create(order === 'graph-status' ? [declaration(), declaration('source-1', 'source-r1')] : [declaration()])
    if (order === 'graph-status') input.edges.push({ from: 'source-1', to: 'analysis-1', type: 'native-after' })
    const { runId } = await state.runtime.execute(input, state.owner.ctx)
    const nested = order === 'nested-status-end'
    const nestedFields = nested ? { parentToolCallId: 'outer' } : {}
    const launchCallId = nested ? 'outer/1' : 'launch-prebind'
    const launchTool = order === 'graph-status' ? 'agent_spawn_graph' : 'agent_spawn'
    const args = order === 'graph-status' ? { name: 'owned-graph', agents: [{ name: 'source-r1' }, { name: 'local-analysis-r1', after: ['source-r1'] }] } : { name: 'local-analysis-r1' }
    await state.runtime.observe({ type: 'tool_execution_start', toolName: launchTool, toolCallId: launchCallId, ...nestedFields, args }, state.owner.ctx)
    const base = Date.now() - 100
    const launched = receipt([agent('local-analysis-r1', 'native-1', order === 'graph-status' || nested ? 'waiting' : 'working'), ...(order === 'graph-status' ? [agent('source-r1', 'native-source')] : [])], base)
    if (!nested) state.owner.entries.push({ type: 'message', id: 'prebind-launch', message: { role: 'toolResult', toolName: launchTool, toolCallId: launchCallId, isError: false, ...launched } })
    await state.runtime.observe({ type: 'tool_execution_end', toolName: launchTool, toolCallId: launchCallId, ...nestedFields, isError: false, result: launched }, state.owner.ctx)
    if (order === 'terminal-send') {
      const message = { role: 'custom' as const, customType: 'pi-agents:result', timestamp: base + 10, content: 'DO-NOT-EXPORT-OUTPUT', details: { version: 1, agentId: 'native-1', name: 'local-analysis-r1', kind: 'answered', body: 'DO-NOT-EXPORT-OUTPUT' } }
      state.owner.entries.push({ type: 'message', id: 'prebind-terminal', message })
      await state.runtime.observe({ type: 'message_end', message }, state.owner.ctx)
    }
    const newer = receipt([agent('local-analysis-r1', 'native-1', nativeState)], base + 20)
    const observationCallId = nested ? 'outer/2' : 'newer-prebind'
    if (nested) await state.runtime.observe({ type: 'tool_execution_start', toolName, toolCallId: observationCallId, ...nestedFields, args: { name: 'local-analysis-r1' } }, state.owner.ctx)
    const event = updateOnly
      ? { type: 'tool_execution_update', toolName, toolCallId: observationCallId, partialResult: newer }
      : { type: 'tool_execution_end', toolName, toolCallId: observationCallId, ...nestedFields, isError: false, result: newer }
    // Ordinary completed tools supply transcript results. Nested completed
    // calls and partial updates must remain replayable without those entries.
    if (!updateOnly && !nested) state.owner.entries.push({ type: 'message', id: 'prebind-newer', message: { role: 'toolResult', toolName, toolCallId: observationCallId, isError: false, ...newer } })
    await state.runtime.observe(event, state.owner.ctx)
    if (updateOnly) {
      const saved = state.owner.entries.filter(entry => entry.customType === 'agent-graph-dashboard:observation:v1')
      expect(saved.map(entry => entry.data)).toEqual([{ version: 1, parentSessionId: parent, runId, launchToolCallId: 'launch-prebind', receipt: { at: base + 20, agents: [{ id: 'native-1', name: 'local-analysis-r1', state: 'answered', stateSince: Date.parse(oldTime) }] } }])
      expect(JSON.stringify(saved)).not.toContain('DO-NOT-EXPORT')
    }
    // Newer foreign/name-mismatched, failed, and unsupported tool results must
    // not replace the owned state. A late-delivered old exact receipt is stale.
    for (const [index, rejected] of [
      { toolName, isError: false, info: agent('local-analysis-r1', 'foreign-id', 'failed'), at: base + 30 },
      { toolName, isError: false, info: agent('foreign-name', 'native-1', 'failed'), at: base + 40 },
      { toolName, isError: true, info: agent('local-analysis-r1', 'native-1', 'failed'), at: base + 50 },
      { toolName: 'non_native_tool', isError: false, info: agent('local-analysis-r1', 'native-1', 'failed'), at: base + 60 },
      { toolName, isError: false, info: agent('local-analysis-r1', 'native-1', 'failed'), at: base - 1 },
    ].entries()) {
      const result = receipt([rejected.info], rejected.at)
      const toolCallId = `rejected-prebind-${index}`
      if (!nested) state.owner.entries.push({ type: 'message', id: toolCallId, message: { role: 'toolResult', toolName: rejected.toolName, toolCallId, isError: rejected.isError, ...result } })
      await state.runtime.observe({ type: 'tool_execution_end', toolName: rejected.toolName, toolCallId, ...nestedFields, isError: rejected.isError, result }, state.owner.ctx)
    }
    let runtime = state.runtime
    if (restart) {
      await runtime.close()
      runtime = createGraphDashboardRuntime({ directory: state.directory, appendEntry: state.owner.appendEntry })
      runtimes.push(runtime)
      await runtime.restore(state.owner.ctx)
    }
    if (updateOnly) {
      const original = read(state.directory, runId)
      const entries = structuredClone(state.owner.entries)
      const lock = join(state.directory, `${runId}.lock`)
      mkdirSync(lock, { mode: 0o700 })
      try { await expect(runtime.execute({ operation: 'bind', runId, launchToolCallId: launchCallId, nodeIds: ['analysis-1'] }, state.owner.ctx)).rejects.toThrow('writer lock') }
      finally { rmSync(lock, { recursive: true }) }
      expect(read(state.directory, runId)).toEqual(original)
      expect(state.owner.entries).toEqual(entries)
    }
    if (nested) expect(state.owner.entries.filter(entry => entry.type === 'message')).toHaveLength(0)
    await runtime.execute({ operation: 'bind', runId, launchToolCallId: launchCallId, nodeIds: ['analysis-1'] }, state.owner.ctx)
    const before = read(state.directory, runId)
    await runtime.observe(event, state.owner.ctx)
    const control = read(state.directory, runId)
    expect(control.nodes[0].execution.state).toBe(expected)
    expect(control.nodes[0].execution.observedAt).toBe(new Date(base + 20).toISOString())
    expect(control.nodes[0].nativeId).toBe('native-1')
    expect(control.nodes[0].verification.state).toBe('unverified')
    expect(state.owner.errors).toHaveLength(0)
    expect(state.owner.calls).toHaveLength(0)
    expect(before.nodes[0].nativeId).toBe('native-1')
    expect(before.nodes[0].verification.state).toBe('unverified')
    expect(before.nodes[0].execution.state).toBe(expected)
    expect(before.nodes[0].execution.observedAt).toBe(new Date(base + 20).toISOString())
    expect(before.timestamps.lastSourceObservationAt).toBe(new Date(base + 20).toISOString())
    expect(before.reporting?.recovery).toBe('ready')
    if (order === 'graph-status') expect(before.nodes[1].nativeId).toBeNull()
    expect(JSON.stringify(before)).not.toContain('DO-NOT-EXPORT')
  })
}

test('prebind native receipt saved partial cannot cross reporting runs with reused fixture IDs', async () => {
  const state = setup()
  const { runId: previous } = await state.runtime.execute(create(), state.owner.ctx)
  await launch(state)
  // Reuse fixture IDs deliberately: run ownership must reject the saved partial
  // even when its timestamp is newer and its ID/name/tool-call fields match.
  const partial = receipt([agent('local-analysis-r1', 'native-1', 'idle')], Date.now() + 900)
  await state.runtime.observe({ type: 'tool_execution_update', toolName: 'agent_wait', toolCallId: 'previous-wait', partialResult: partial }, state.owner.ctx)
  expect(state.owner.entries.some(entry => entry.customType === 'agent-graph-dashboard:observation:v1')).toBe(true)
  await state.runtime.execute({ operation: 'update', runId: previous, status: 'succeeded' }, state.owner.ctx)
  const original = read(state.directory, previous)
  const { runId } = await state.runtime.execute(create(), state.owner.ctx)
  await launch(state)
  await state.runtime.execute({ operation: 'bind', runId, launchToolCallId: 'launch-1', nodeIds: ['analysis-1'] }, state.owner.ctx)
  const after = read(state.directory, runId)
  expect(after.nodes[0].execution.state).toBe('running')
  expect(after.nodes[0].execution.observedAt).not.toBe(new Date(partial.details.at).toISOString())
  expect(after.nodes[0].verification.state).toBe('unverified')
  expect(read(state.directory, previous)).toEqual(original)
})

// Regression r4: a short worker can answer before bind. Retain exact owned
// observations across both public result formats and same-run parent restart.
// Later foreign same-name results must never replace the owned native identity.
for (const kind of ['single', 'graph'] as const) for (const restart of [false, true]) {
  test(`terminal before bind ${kind} restart=${restart} retains exact owned result without name fallback`, async () => {
    const state = setup()
    const names = kind === 'single' ? ['local-analysis-r1'] : ['local-analysis-r1', 'local-checks-r1']
    const ids = names.map((_, index) => `native-${index + 1}`)
    const declarations = names.map((name, index) => declaration(`task-${index + 1}`, name))
    const { runId } = await state.runtime.execute(create(declarations), state.owner.ctx)
    const toolName = kind === 'single' ? 'agent_spawn' : 'agent_spawn_graph'
    const args = kind === 'single' ? { name: names[0] } : { name: 'owned-graph', agents: names.map(name => ({ name })) }
    await state.runtime.observe({ type: 'tool_execution_start', toolName, toolCallId: 'launch-early', args }, state.owner.ctx)
    const launchedAt = Date.now()
    await state.runtime.observe({ type: 'tool_execution_end', toolName, toolCallId: 'launch-early', isError: false, result: receipt(names.map((name, index) => agent(name, ids[index])), launchedAt) }, state.owner.ctx)
    const terminalAt = Math.max(Date.now(), launchedAt + 1)
    for (const { foreign, stale } of [{ foreign: false, stale: false }, { foreign: true, stale: false }, { foreign: false, stale: true }]) {
      const timestamp = stale ? launchedAt - 1 : terminalAt + (foreign ? 1 : 0)
      const nodes = names.map((name, index) => ({ agentId: foreign ? `foreign-${index + 1}` : ids[index], name, kind: stale ? 'failed' : 'answered', body: 'DO-NOT-EXPORT-OUTPUT', end: true, inputs: [] }))
      const details = kind === 'single' ? { version: 1, ...nodes[0] } : { version: 1, graphId: foreign ? 'foreign-graph' : 'owned-graph-id', name: 'owned-graph', policy: 'allSettled', nodes }
      const message = { role: 'custom' as const, customType: kind === 'single' ? 'pi-agents:result' : 'pi-agents:graph-result', timestamp, content: 'DO-NOT-EXPORT-OUTPUT', details }
      state.owner.entries.push({ type: 'message', id: `terminal-${foreign}-${stale}`, message })
      await state.runtime.observe({ type: 'message_end', message }, state.owner.ctx)
    }
    let runtime = state.runtime
    if (restart) {
      await runtime.close()
      runtime = createGraphDashboardRuntime({ directory: state.directory, appendEntry: state.owner.appendEntry })
      runtimes.push(runtime)
      await runtime.restore(state.owner.ctx)
    }
    await runtime.execute({ operation: 'bind', runId, launchToolCallId: 'launch-early', nodeIds: declarations.map(node => node.id) }, state.owner.ctx)
    const after = read(state.directory, runId)
    expect(after.nodes.filter(node => node.kind === 'worker').map(node => node.execution.state)).toEqual(names.map(() => 'answered'))
    expect(after.nodes.filter(node => node.kind === 'worker').map(node => node.nativeId)).toEqual(ids)
    expect(after.nodes.filter(node => node.kind === 'worker').map(node => node.execution.observedAt)).toEqual(names.map(() => new Date(terminalAt).toISOString()))
    expect(after.nodes.filter(node => node.kind === 'worker').map(node => node.verification.state)).toEqual(names.map(() => 'unverified'))
    expect(after.timestamps.lastSourceObservationAt).toBe(new Date(terminalAt).toISOString())
    expect(JSON.stringify(after)).not.toContain('DO-NOT-EXPORT')
    expect(state.owner.calls).toHaveLength(0)
  })
}

// Regression r4: direct status success must not clear pending tracking when the
// real snapshot write fails. The next exact ordinary event must remain suppressed.
test('successful status with failed recovery write preserves pending observation filtering', async () => {
  const state = setup()
  const runId = await bound(state)
  await state.runtime.close()
  const runtime = createGraphDashboardRuntime({ directory: state.directory, appendEntry: state.owner.appendEntry })
  runtimes.push(runtime)
  await runtime.restore(state.owner.ctx)
  const before = read(state.directory, runId)
  const entries = structuredClone(state.owner.entries)
  const observedAt = Math.max(Date.now(), Date.parse(before.nodes[0].execution.observedAt!) + 1)
  state.owner.status(async () => executionResult(receipt([agent('local-analysis-r1', 'native-1', 'idle')], observedAt)))
  const lock = join(state.directory, `${runId}.lock`)
  mkdirSync(lock, { mode: 0o700 })
  try { await expect(runtime.execute({ operation: 'recover', runId }, state.owner.ctx)).rejects.toThrow('writer lock') }
  finally { rmSync(lock, { recursive: true }) }
  expect(state.owner.calls).toEqual([{ name: 'agent_status', args: { name: 'local-analysis-r1' } }])
  expect(read(state.directory, runId)).toEqual(before)
  expect(state.owner.entries).toEqual(entries)
  await runtime.observe({ type: 'tool_execution_end', toolName: 'agent_status', toolCallId: 'ordinary-status', isError: false, result: receipt([agent('local-analysis-r1', 'native-1', 'idle')], observedAt + 1) }, state.owner.ctx)
  expect(read(state.directory, runId)).toEqual(before)
  expect(state.owner.statuses.at(-1)).toContain('reconciliation pending')
})

// Regression r4, opposite direction: a rejected read plus failed persistence
// cannot add recovery tracking while the durable report still claims ready.
test('rejected status with failed recovery write preserves ready observation filtering', async () => {
  const state = setup()
  const runId = await bound(state)
  const before = read(state.directory, runId)
  const entries = structuredClone(state.owner.entries)
  state.owner.status(async () => { throw new Error('status transport rejected') })
  const lock = join(state.directory, `${runId}.lock`)
  mkdirSync(lock, { mode: 0o700 })
  try { await expect(state.runtime.execute({ operation: 'recover', runId }, state.owner.ctx)).rejects.toThrow('writer lock') }
  finally { rmSync(lock, { recursive: true }) }
  expect(read(state.directory, runId)).toEqual(before)
  expect(state.owner.entries).toEqual(entries)
  const observedAt = Math.max(Date.now(), Date.parse(before.nodes[0].execution.observedAt!) + 1)
  await state.runtime.observe({ type: 'tool_execution_end', toolName: 'agent_status', toolCallId: 'ordinary-status', isError: false, result: receipt([agent('local-analysis-r1', 'native-1', 'idle')], observedAt) }, state.owner.ctx)
  const after = read(state.directory, runId)
  expect(after.nodes[0].execution.state).toBe('answered')
  expect(after.nodes[0].execution.observedAt).toBe(new Date(observedAt).toISOString())
  expect(after.reporting?.recovery).toBe('ready')
  expect(after.nodes[0].verification.state).toBe('unverified')
  expect(state.owner.statuses.at(-1)).not.toContain('reconciliation pending')
})

// Regression: an inherited or previous-run public launch receipt has the same
// declared name but belongs to a different reporting owner. Existing branch tests
// reject writes to the original run; these protect allocation in a NEW run.
for (const scenario of ['fork', 'previous-run'] as const) {
  test(`launch ownership rejects ${scenario} receipts when a new run declares the same worker name`, async () => {
    const original = setup()
    const originalRunId = await bound(original)
    const originalSnapshot = read(original.directory, originalRunId)
    let owner = original.owner
    let runtime = original.runtime
    if (scenario === 'fork') {
      owner = host('fork-parent')
      owner.entries.push(...structuredClone(original.owner.entries))
      runtime = createGraphDashboardRuntime({ directory: original.directory, appendEntry: owner.appendEntry })
      runtimes.push(runtime)
      await runtime.restore(owner.ctx)
    } else {
      await runtime.execute({ operation: 'update', runId: originalRunId, status: 'succeeded' }, owner.ctx)
    }
    const { runId } = await runtime.execute(create(), owner.ctx)
    const newStore = createGraphDashboardStore({ directory: original.directory, runId, parentSessionId: owner.ctx.sessionManager.getSessionId() })
    await expect(runtime.execute({ operation: 'bind', runId, launchToolCallId: 'launch-1', nodeIds: ['analysis-1'] }, owner.ctx)).rejects.toThrow()
    expect(newStore.read()!.nodes[0].nativeId).toBeNull()
    if (scenario === 'fork') expect(read(original.directory, originalRunId)).toEqual(originalSnapshot)
  })
}

// Regression: cached nested receipts or unfinished native starts survive create
// and allocate a previous run's worker. Both use the actual native observer path.
for (const timing of ['completed', 'unfinished'] as const) {
  test(`launch ownership rejects ${timing} nested launches across reporting runs`, async () => {
    const state = setup()
    const first = await state.runtime.execute(create(), state.owner.ctx)
    await state.runtime.observe({ type: 'tool_execution_start', toolName: 'agent_spawn', toolCallId: 'outer/1', parentToolCallId: 'outer', args: { name: 'local-analysis-r1' } }, state.owner.ctx)
    const end = { type: 'tool_execution_end', toolName: 'agent_spawn', toolCallId: 'outer/1', parentToolCallId: 'outer', isError: false, result: receipt([agent('local-analysis-r1', 'native-1')]) }
    if (timing === 'completed') await state.runtime.observe(end, state.owner.ctx)
    await state.runtime.execute({ operation: 'update', runId: first.runId, status: 'succeeded' }, state.owner.ctx)
    const second = await state.runtime.execute(create(), state.owner.ctx)
    if (timing === 'unfinished') await state.runtime.observe(end, state.owner.ctx)
    await expect(state.runtime.execute({ operation: 'bind', runId: second.runId, launchToolCallId: 'outer/1', nodeIds: ['analysis-1'] }, state.owner.ctx)).rejects.toThrow()
    expect(read(state.directory, second.runId).nodes[0].nativeId).toBeNull()
  })
}

test('launch ownership rejects a native start observed before any run exists', async () => {
  const state = setup()
  await state.runtime.observe({ type: 'tool_execution_start', toolName: 'agent_spawn', toolCallId: 'early-launch', args: { name: 'local-analysis-r1' } }, state.owner.ctx)
  const { runId } = await state.runtime.execute(create(), state.owner.ctx)
  await state.runtime.observe({ type: 'tool_execution_end', toolName: 'agent_spawn', toolCallId: 'early-launch', isError: false, result: receipt([agent('local-analysis-r1', 'native-1')]) }, state.owner.ctx)
  await expect(state.runtime.execute({ operation: 'bind', runId, launchToolCallId: 'early-launch', nodeIds: ['analysis-1'] }, state.owner.ctx)).rejects.toThrow()
  expect(read(state.directory, runId).nodes[0].nativeId).toBeNull()
})

// Compatibility control: a legitimate same-run launch can be bound after the
// parent restarts, without spawning, same-name status lookup, or private storage.
test('launch ownership preserves same-run delayed binding after parent restart', async () => {
  const state = setup()
  const { runId } = await state.runtime.execute(create(), state.owner.ctx)
  await launch(state)
  await state.runtime.close()
  const recovered = createGraphDashboardRuntime({ directory: state.directory, appendEntry: state.owner.appendEntry })
  runtimes.push(recovered)
  await recovered.restore(state.owner.ctx)
  await recovered.execute({ operation: 'bind', runId, launchToolCallId: 'launch-1', nodeIds: ['analysis-1'] }, state.owner.ctx)
  expect(read(state.directory, runId).nodes[0].nativeId).toBe('native-1')
  expect(state.owner.calls).toHaveLength(0)
})

// Regression: executeTool rejects before the recovery receipt parser, leaving a
// ready snapshot while native observations are suppressed. The transport mock
// only rejects a public call; production must continue and persist uncertainty.
test('rejected status promises persist partial recovery and do not prevent remaining exact status reads', async () => {
  const state = setup()
  const { runId } = await state.runtime.execute(create([declaration(), declaration('checks-1', 'local-checks-r1')]), state.owner.ctx)
  await launch(state, 'launch-analysis', [agent('local-analysis-r1', 'native-1')])
  await launch(state, 'launch-checks', [agent('local-checks-r1', 'native-2')])
  for (const [call, node] of [['launch-analysis', 'analysis-1'], ['launch-checks', 'checks-1']]) {
    await state.runtime.execute({ operation: 'bind', runId, launchToolCallId: call, nodeIds: [node] }, state.owner.ctx)
  }
  const before = read(state.directory, runId)
  expect(before.reporting?.recovery).toBe('ready')
  state.owner.status(async args => {
    if (typeof args === 'object' && args !== null && 'name' in args && args.name === 'local-analysis-r1') throw new Error('status transport rejected')
    return executionResult(receipt([agent('local-checks-r1', 'native-2', 'idle')]))
  })
  await state.runtime.execute({ operation: 'recover', runId }, state.owner.ctx)
  const after = read(state.directory, runId)
  expect(after.reporting?.recovery).toBe('partial-failure')
  expect(after.timestamps.lastSourceObservationAt).toBe(before.timestamps.lastSourceObservationAt)
  expect(after.nodes[0]).toEqual(before.nodes[0])
  expect(after.nodes[1].execution.state).toBe('answered')
  expect(after.nodes[1].verification.state).toBe('unverified')
  expect(state.owner.calls).toEqual([{ name: 'agent_status', args: { name: 'local-analysis-r1' } }, { name: 'agent_status', args: { name: 'local-checks-r1' } }])
  expect(readFileSync(join(state.directory, `${runId}.html`), 'utf8')).toContain('Recovery incomplete:')
  expect(state.owner.errors.some(message => message.includes('analysis-1'))).toBe(true)
})

// Public nested events are awaited by Pi. A direct recovery call must not queue
// its own status events behind the recovery operation that waits for them.
test('recovery status reads complete through accepted execution wrapper and awaited public native observer events', async () => {
  const state = setup()
  const runId = await bound(state)
  await state.runtime.close()
  state.runtime = createGraphDashboardRuntime({ directory: state.directory, appendEntry: state.owner.appendEntry })
  runtimes.push(state.runtime)
  await state.runtime.restore(state.owner.ctx)
  const before = read(state.directory, runId)
  const at = Math.max(Date.now(), Date.parse(before.nodes[0].execution.observedAt!) + 1)
  state.owner.status(async () => {
    await state.runtime.observe({ type: 'tool_execution_start', toolName: 'agent_status', toolCallId: 'recover/1', parentToolCallId: 'recover', args: { name: 'local-analysis-r1' } }, state.owner.ctx)
    const result = receipt([agent('local-analysis-r1', 'native-1', 'idle')], at)
    await state.runtime.observe({ type: 'tool_execution_end', toolName: 'agent_status', toolCallId: 'recover/1', parentToolCallId: 'recover', isError: false, result }, state.owner.ctx)
    await state.runtime.observe({ type: 'message_end', message: { role: 'toolResult', toolName: 'agent_status', toolCallId: 'recover/1', isError: false, ...result } }, state.owner.ctx)
    return executionResult(result)
  })
  await state.runtime.execute({ operation: 'recover', runId }, state.owner.ctx)
  const after = read(state.directory, runId)
  expect(after.reporting?.recovery).toBe('ready')
  expect(after.nodes[0].execution.state).toBe('answered')
  expect(after.nodes[0].execution.observedAt).toBe(new Date(at).toISOString())
  expect(after.timestamps.lastSourceObservationAt).toBe(new Date(at).toISOString())
  expect(after.nodes[0].verification.state).toBe('unverified')
  expect(state.owner.calls).toEqual([{ name: 'agent_status', args: { name: 'local-analysis-r1' } }])
  expect(state.owner.errors).toHaveLength(0)
})

// Regression r7: awaited successful observer events cannot substitute for a
// successful, well-formed direct execution result with the exact owned identity.
for (const failure of ['outer-error', 'missing-error-flag', 'missing-result', 'malformed-result', 'malformed-with-flat-decoy', 'flat-receipt', 'wrong-id', 'wrong-name'] as const) {
  test(`recovery execution wrapper rejects ${failure} despite awaited successful exact status events`, async () => {
    const state = setup()
    const runId = await bound(state)
    await state.runtime.close()
    state.runtime = createGraphDashboardRuntime({ directory: state.directory, appendEntry: state.owner.appendEntry })
    runtimes.push(state.runtime)
    await state.runtime.restore(state.owner.ctx)
    const before = read(state.directory, runId)
    const at = Math.max(Date.now(), Date.parse(before.nodes[0].execution.observedAt!) + 1)
    const result = receipt([agent('local-analysis-r1', 'native-1', 'idle')], at)
    const wrapped = executionResult(result)
    let outcome: unknown = wrapped
    if (failure === 'outer-error') outcome = { ...wrapped, isError: true }
    if (failure === 'missing-error-flag') { const { isError: _unused, ...missing } = wrapped; outcome = missing }
    if (failure === 'missing-result') { const { result: _unused, ...missing } = wrapped; outcome = missing }
    if (failure === 'malformed-result') outcome = { ...wrapped, result: [] }
    if (failure === 'malformed-with-flat-decoy') outcome = { ...wrapped, ...result, result: null }
    if (failure === 'flat-receipt') outcome = { ...result, isError: false }
    if (failure === 'wrong-id') outcome = executionResult(receipt([agent('local-analysis-r1', 'foreign-native', 'idle')], at))
    if (failure === 'wrong-name') outcome = executionResult(receipt([agent('foreign-name', 'native-1', 'idle')], at))
    state.owner.status(async () => {
      await state.runtime.observe({ type: 'tool_execution_start', toolName: 'agent_status', toolCallId: 'recover/error', args: { name: 'local-analysis-r1' } }, state.owner.ctx)
      await state.runtime.observe({ type: 'tool_execution_end', toolName: 'agent_status', toolCallId: 'recover/error', isError: false, result }, state.owner.ctx)
      await state.runtime.observe({ type: 'message_end', message: { role: 'toolResult', toolName: 'agent_status', toolCallId: 'recover/error', isError: false, ...result } }, state.owner.ctx)
      return outcome
    })
    await state.runtime.execute({ operation: 'recover', runId }, state.owner.ctx)
    const after = read(state.directory, runId)
    expect(after.reporting?.recovery).toBe('partial-failure')
    expect(after.nodes).toEqual(before.nodes)
    expect(after.timestamps.lastSourceObservationAt).toBe(before.timestamps.lastSourceObservationAt)
    expect(state.owner.errors.some(text => text.includes('native status reconciliation failed'))).toBe(true)
    expect(state.owner.statuses.at(-1)).toContain('reconciliation pending')
    expect(state.owner.calls).toEqual([{ name: 'agent_status', args: { name: 'local-analysis-r1' } }])
    expect(JSON.stringify(after)).not.toContain('DO-NOT-EXPORT')
  })
}

// Regression: same-name declarations or duplicate receipt names select an arbitrary
// native ID. Store tests cannot see names or native receipt provenance.
test('duplicate declarations and ambiguous launch receipts cannot allocate worker identity', async () => {
  const state = setup()
  await expect(state.runtime.execute(create([declaration(), declaration('other')]), state.owner.ctx)).rejects.toThrow()
  const { runId } = await state.runtime.execute(create(), state.owner.ctx)
  await launch(state, 'ambiguous', [agent('local-analysis-r1', 'native-1'), agent('local-analysis-r1', 'native-2')])
  await expect(state.runtime.execute({ operation: 'bind', runId, launchToolCallId: 'ambiguous', nodeIds: ['analysis-1'] }, state.owner.ctx)).rejects.toThrow()
  expect(read(state.directory, runId).nodes[0].nativeId).toBeNull()
})

// Regression: broad event observation captures an unrelated worker, or a nested
// answered result clears parent gates. Exercise the same observer used by Pi.
test('owned nested receipts update worker execution but never verification or unrelated workers', async () => {
  const state = setup()
  const { runId } = await state.runtime.execute(create(), state.owner.ctx)
  await state.runtime.observe({ type: 'tool_execution_start', toolName: 'agent_spawn', toolCallId: 'outer/1', parentToolCallId: 'outer', args: { name: 'local-analysis-r1' } }, state.owner.ctx)
  await state.runtime.observe({ type: 'tool_execution_end', toolName: 'agent_spawn', toolCallId: 'outer/1', parentToolCallId: 'outer', isError: false, result: receipt([agent('local-analysis-r1', 'native-1')]) }, state.owner.ctx)
  await state.runtime.execute({ operation: 'bind', runId, launchToolCallId: 'outer/1', nodeIds: ['analysis-1'] }, state.owner.ctx)
  const before = read(state.directory, runId)
  await state.runtime.observe({ type: 'tool_execution_update', toolName: 'agent_wait', toolCallId: 'wait-unrelated', args: { names: ['unrelated'] }, partialResult: receipt([agent('unrelated', 'foreign-1', 'idle')]) }, state.owner.ctx)
  expect(read(state.directory, runId)).toEqual(before)
  await state.runtime.observe({ type: 'tool_execution_update', toolName: 'agent_wait', toolCallId: 'outer/2', parentToolCallId: 'outer', args: { names: ['local-analysis-r1'] }, partialResult: receipt([agent('local-analysis-r1', 'native-1', 'idle')]) }, state.owner.ctx)
  const after = read(state.directory, runId)
  expect(after.nodes[0].execution.state).toBe('answered')
  expect(after.nodes[0].verification.state).toBe('unverified')
  expect(after.nodes[0].nativeId).toBe('native-1')
  expect(JSON.stringify(after)).not.toContain('DO-NOT-EXPORT')
})

// Regression: successful reconciliation of one worker makes every worker fresh.
// The real persisted snapshot, not a mock store, supplies the individual times.
test('partial recovery reconciles exact IDs and leaves failed workers observations unchanged', async () => {
  const owner = host()
  const state = setup(owner)
  const { runId } = await state.runtime.execute(create([declaration(), declaration('checks-1', 'local-checks-r1')]), owner.ctx)
  await launch(state, 'launch-analysis', [agent('local-analysis-r1', 'native-1')])
  await launch(state, 'launch-checks', [agent('local-checks-r1', 'native-2')])
  for (const [call, node] of [['launch-analysis', 'analysis-1'], ['launch-checks', 'checks-1']]) {
    await state.runtime.execute({ operation: 'bind', runId, launchToolCallId: call, nodeIds: [node] }, owner.ctx)
  }
  const before = read(state.directory, runId)
  await state.runtime.close()
  const recovered = createGraphDashboardRuntime({ directory: state.directory, appendEntry: owner.appendEntry })
  runtimes.push(recovered)
  await recovered.restore(owner.ctx)
  expect(read(state.directory, runId).reporting?.recovery).toBe('pending')
  expect(readFileSync(join(state.directory, `${runId}.html`), 'utf8')).toContain('Recovery pending:')
  owner.status(async args => typeof args === 'object' && args !== null && 'name' in args && args.name === 'local-analysis-r1'
    ? executionResult(receipt([agent('local-analysis-r1', 'native-1', 'idle')]))
    : executionResult(receipt([]), true))
  await recovered.execute({ operation: 'recover', runId }, owner.ctx)
  const after = read(state.directory, runId)
  expect(after.runId).toBe(runId)
  expect(after.nodes.filter(node => node.kind === 'worker').map(node => node.nativeId)).toEqual(['native-1', 'native-2'])
  expect(after.nodes[0].execution.state).toBe('answered')
  expect(after.nodes[1].execution.observedAt).toBe(before.nodes[1].execution.observedAt)
  expect(after.nodes[1].execution.state).toBe(before.nodes[1].execution.state)
  expect(after.timestamps.lastSourceObservationAt).toBe(before.timestamps.lastSourceObservationAt)
  expect(after.reporting?.recovery).toBe('partial-failure')
  expect(readFileSync(join(state.directory, `${runId}.html`), 'utf8')).toContain('Recovery incomplete:')
  expect(owner.calls).toEqual([{ name: 'agent_status', args: { name: 'local-analysis-r1' } }, { name: 'agent_status', args: { name: 'local-checks-r1' } }])
  expect(owner.errors.length).toBeGreaterThan(0)
})

// Regression: a fork or old tree checkpoint overwrites the original artifact.
// Check both disk state and appendEntry, the two production ownership boundaries.
test('forks and earlier branches cannot mutate the original run or append its checkpoints', async () => {
  const state = setup()
  const runId = await bound(state)
  const original = read(state.directory, runId)
  const fork = host('fork-parent')
  fork.entries.push(...structuredClone(state.owner.entries))
  await state.runtime.restore(fork.ctx)
  const count = state.owner.entries.length
  await expect(state.runtime.execute({ operation: 'update', runId, status: 'succeeded' }, fork.ctx)).rejects.toThrow()
  expect(read(state.directory, runId)).toEqual(original)
  expect(state.owner.entries).toHaveLength(count)
  const oldBranch = host()
  oldBranch.entries.push(structuredClone(state.owner.entries.find(entry => entry.type === 'custom')!))
  await state.runtime.restore(oldBranch.ctx)
  await expect(state.runtime.execute({ operation: 'update', runId, status: 'succeeded' }, oldBranch.ctx)).rejects.toThrow()
  expect(read(state.directory, runId)).toEqual(original)
  expect(state.owner.entries).toHaveLength(count)
})

// Explicit recovery must reconstruct authority from the current branch, not
// retain a read-only cache from an earlier tree position. Compaction preserves
// raw branch entries; its summary and run ID do not grant ownership.
test('recover resumes the current parent checkpoint after read-only branch continuation and compaction', async () => {
  const state = setup()
  const runId = await bound(state)
  const continuation = structuredClone(state.owner.entries)
  const original = read(state.directory, runId)
  state.owner.entries.splice(1)
  await state.runtime.restore(state.owner.ctx)
  expect(read(state.directory, runId)).toEqual(original)
  state.owner.entries.splice(0, state.owner.entries.length, ...continuation)
  state.owner.appendEntry('unrelated-extension', { restored: true })
  // The full branch, unlike model context, still contains the exact checkpoint.
  state.owner.entries.push({ type: 'compaction', id: 'compacted-continuation' })
  state.owner.status(async () => executionResult(receipt([agent('local-analysis-r1', 'native-1', 'idle')])))
  await state.runtime.execute({ operation: 'recover', runId }, state.owner.ctx)
  const after = read(state.directory, runId)
  expect(after.revision).toBeGreaterThan(original.revision)
  expect(after.nodes[0].nativeId).toBe('native-1')
  expect(after.nodes[0].execution.state).toBe('answered')
  expect(after.nodes[0].verification).toEqual(original.nodes[0].verification)
  expect(after.nodes.filter(node => node.kind === 'gate')).toEqual(original.nodes.filter(node => node.kind === 'gate'))
  expect(after.reporting?.recovery).toBe('ready')
  expect(state.owner.calls).toEqual([{ name: 'agent_status', args: { name: 'local-analysis-r1' } }])
  await state.runtime.execute({ operation: 'update', runId, currentStage: 'checks' }, state.owner.ctx)
  expect(read(state.directory, runId).currentStage).toBe('checks')
})

test.each(['stale', 'missing', 'foreign-parent', 'different-run', 'same-revision-change', 'invalid-metadata'] as const)('recover rejects %s branch authority before status calls or writes', async scenario => {
  const state = setup()
  const runId = await bound(state)
  const original = read(state.directory, runId)
  let owner = state.owner
  if (scenario === 'stale') owner.entries.splice(1)
  else if (scenario === 'missing') owner.entries.splice(0)
  else if (scenario === 'foreign-parent') {
    owner = host('fork-parent')
    owner.entries.push(...structuredClone(state.owner.entries))
    await state.runtime.restore(owner.ctx)
  } else {
    const latest = owner.entries.filter(entry => entry.customType === 'agent-graph-dashboard:v1').at(-1)!.data as { snapshot: GraphSnapshot; names: Record<string, string> }
    if (scenario === 'different-run') latest.snapshot.runId = 'another-run'
    else if (scenario === 'same-revision-change') latest.snapshot.currentStage = 'another-stage'
    else latest.names = {}
  }
  const entries = structuredClone(owner.entries)
  const artifacts = readdirSync(state.directory).sort().map(name => [name, readFileSync(join(state.directory, name), 'utf8')])
  const reason = {
    stale: 'branch checkpoint differs from persisted run', missing: 'no checkpoint on this parent branch',
    'foreign-parent': 'inherited run belongs to another parent', 'different-run': 'foreign run identity',
    'same-revision-change': 'branch checkpoint differs from persisted run', 'invalid-metadata': 'inconsistent checkpoint names',
  }[scenario]
  await expect(state.runtime.execute({ operation: 'recover', runId }, owner.ctx)).rejects.toThrow(reason)
  expect(owner.calls).toEqual([])
  expect(owner.entries).toEqual(entries)
  expect(read(state.directory, runId)).toEqual(original)
  expect(readdirSync(state.directory).sort().map(name => [name, readFileSync(join(state.directory, name), 'utf8')])).toEqual(artifacts)
})

// Regression: an awaited status call commits after session replacement. This
// deferred response controls timing only; the runtime must enforce generation.
test.each(['resolved', 'rejected'] as const)('late %s reconciliation after session replacement cannot commit or appendEntry', async settlement => {
  const state = setup()
  const runId = await bound(state)
  let release!: (value: unknown) => void
  let reject!: (reason: Error) => void
  let entered!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  state.owner.status(async () => { entered(); return new Promise((resolve, fail) => { release = resolve; reject = fail }) })
  const pending = state.runtime.execute({ operation: 'recover', runId }, state.owner.ctx)
  await started
  await state.runtime.restore(host('other-parent').ctx)
  const before = read(state.directory, runId)
  const count = state.owner.entries.length
  if (settlement === 'resolved') release(executionResult(receipt([agent('local-analysis-r1', 'native-1', 'idle')])))
  else reject(new Error('late status rejection'))
  await pending.catch(() => {})
  expect(read(state.directory, runId)).toEqual(before)
  expect(state.owner.entries).toHaveLength(count)
})

// Regression r8: restore and awaited nested events each work alone. Combined,
// the old direct call must not wait for an event queued behind its own recovery.
// The escape changes only the simulated host's wait, not the receipt or runtime.
for (const transition of ['same-parent', 'other-parent'] as const) {
  test(`restore during direct recovery with awaited end callback ${transition} drains queue without stale writes`, async () => {
    const state = setup()
    const runId = await bound(state)
    function signal() {
      let resolve!: () => void
      const promise = new Promise<void>(done => { resolve = done })
      return { promise, resolve }
    }
    const started = signal(), releaseStatus = signal(), eventCalled = signal(), escape = signal()
    let eventSettled = false, recoverySettled = false, showSettled = false
    let observed: Promise<void> | undefined
    let pending: Promise<unknown> | undefined, show: Promise<unknown> | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    state.owner.status(async () => {
      await state.runtime.observe({ type: 'tool_execution_start', toolName: 'agent_status', toolCallId: 'recover/late', parentToolCallId: 'recover', args: { name: 'local-analysis-r1' } }, state.owner.ctx)
      started.resolve()
      await releaseStatus.promise
      const result = receipt([agent('local-analysis-r1', 'native-1', 'idle')])
      observed = state.runtime.observe({ type: 'tool_execution_end', toolName: 'agent_status', toolCallId: 'recover/late', parentToolCallId: 'recover', isError: false, result }, state.owner.ctx).then(() => { eventSettled = true })
      eventCalled.resolve()
      await Promise.race([observed, escape.promise])
      return executionResult(result)
    })
    try {
      pending = state.runtime.execute({ operation: 'recover', runId }, state.owner.ctx).then(
        value => { recoverySettled = true; return { value, error: null } },
        error => { recoverySettled = true; return { value: null, error } },
      )
      await started.promise
      const target = transition === 'same-parent' ? state.owner : host('other-parent')
      await state.runtime.restore(target.ctx)
      // Same-parent restore legitimately publishes pending. Freeze evidence
      // AFTER restore so only the old recovery/event can violate this boundary.
      const before = read(state.directory, runId)
      const json = readFileSync(join(state.directory, `${runId}.json`), 'utf8')
      const html = readFileSync(join(state.directory, `${runId}.html`), 'utf8')
      const entries = structuredClone(state.owner.entries)
      const targetEntries = structuredClone(target.entries)
      releaseStatus.resolve()
      await eventCalled.promise
      show = state.runtime.execute({ operation: 'show', runId }, target.ctx).then(
        value => { showSettled = true; return { value, error: null } },
        error => { showSettled = true; return { value: null, error } },
      )
      // A deadline selects the diagnostic path only. The dependency is proved
      // by releasing just the host wait and then observing all promises drain.
      const escaped = await Promise.race([
        observed!.then(() => false),
        new Promise<true>(resolve => { timer = setTimeout(() => resolve(true), 1000) }),
      ])
      if (timer) clearTimeout(timer)
      if (escaped) {
        expect(eventSettled).toBe(false)
        expect(recoverySettled).toBe(false)
        expect(showSettled).toBe(false)
        expect(read(state.directory, runId)).toEqual(before)
        expect(state.owner.entries).toEqual(entries)
        escape.resolve()
      }
      const [recoveryResult, showResult] = await Promise.all([pending, show]) as [
        { value: unknown; error: Error | null },
        { value: { runId: string } | null; error: Error | null },
      ]
      await observed
      expect(eventSettled).toBe(true)
      expect(recoverySettled).toBe(true)
      expect(showSettled).toBe(true)
      expect(recoveryResult.error?.message).toContain('session changed; reporting update discarded')
      expect(recoveryResult.value).toBeNull()
      if (transition === 'same-parent') {
        expect(showResult.error).toBeNull()
        expect(showResult.value?.runId).toBe(runId)
      } else {
        expect(showResult.error?.message).toContain('session changed; reporting update discarded')
        expect(showResult.value).toBeNull()
      }
      expect(read(state.directory, runId)).toEqual(before)
      expect(readFileSync(join(state.directory, `${runId}.json`), 'utf8')).toBe(json)
      expect(readFileSync(join(state.directory, `${runId}.html`), 'utf8')).toBe(html)
      expect(state.owner.entries).toEqual(entries)
      expect(target.entries).toEqual(targetEntries)
      expect(state.owner.calls).toEqual([{ name: 'agent_status', args: { name: 'local-analysis-r1' } }])
      expect(escaped, 'awaited end callback needs no host-wait escape after restore').toBe(false)
    } finally {
      if (timer) clearTimeout(timer)
      releaseStatus.resolve(); escape.resolve()
      await Promise.all([pending, show, observed])
    }
  }, 15000)
}

// Regression: recovery uses same-name status to replace missing launch provenance.
// The original run remains present; only its public receipt is unavailable.
test('restart cannot bind a same-name worker without the exact owned launch receipt', async () => {
  const state = setup()
  const { runId } = await state.runtime.execute(create(), state.owner.ctx)
  await state.runtime.close()
  const recovered = createGraphDashboardRuntime({ directory: state.directory, appendEntry: state.owner.appendEntry })
  runtimes.push(recovered)
  await recovered.restore(state.owner.ctx)
  state.owner.status(async () => executionResult(receipt([agent('local-analysis-r1', 'arbitrary-native-id')])))
  await expect(recovered.execute({ operation: 'bind', runId, launchToolCallId: 'missing-launch', nodeIds: ['analysis-1'] }, state.owner.ctx)).rejects.toThrow()
  expect(read(state.directory, runId).nodes[0].nativeId).toBeNull()
  expect(state.owner.calls).toHaveLength(0)
})

// Regression: asynchronous native delivery is ignored without an active wait,
// or its unrelated/foreign identity grants verification to a declared worker.
test('public asynchronous result messages update only owned exact identities', async () => {
  const state = setup()
  const runId = await bound(state)
  const before = read(state.directory, runId)
  const message = (nativeId: string, timestamp = Date.now()) => ({ type: 'message_end', message: { role: 'custom', customType: 'pi-agents:result', timestamp,
    content: 'DO-NOT-EXPORT-OUTPUT', details: { version: 1, agentId: nativeId, name: 'local-analysis-r1', kind: 'answered', body: 'DO-NOT-EXPORT-OUTPUT' } } })
  await state.runtime.observe(message('foreign-native-id'), state.owner.ctx)
  expect(read(state.directory, runId)).toEqual(before)
  await state.runtime.observe(message('native-1'), state.owner.ctx)
  const answered = read(state.directory, runId)
  expect(answered.nodes[0].execution.state).toBe('answered')
  expect(answered.nodes[0].verification.state).toBe('unverified')
  expect(JSON.stringify(answered)).not.toContain('DO-NOT-EXPORT')
  await state.runtime.observe(message('native-1', Date.parse(oldTime)), state.owner.ctx)
  expect(read(state.directory, runId)).toEqual(answered)
})

// Regression: declaring a retry replaces the original failed evidence, or a
// graph's retained original result overwrites the retry's distinct native ID.
test('retry declarations retain failed attempts and graph results cannot overwrite them', async () => {
  const state = setup()
  const runId = await bound(state)
  await state.runtime.execute({ operation: 'update', runId, nodes: [{ id: 'analysis-1', verification: { state: 'failed', reason: 'Checks fail' } }] }, state.owner.ctx)
  const prior = read(state.directory, runId).nodes[0]
  await state.runtime.execute({ operation: 'declare', runId, nodes: [{ ...declaration('analysis-2', 'local-analysis-r2'), logicalId: 'analysis-1', attempt: 2 }], edges: [] }, state.owner.ctx)
  await launch(state, 'retry-launch', [agent('local-analysis-r2', 'native-2')])
  await state.runtime.execute({ operation: 'bind', runId, launchToolCallId: 'retry-launch', nodeIds: ['analysis-2'] }, state.owner.ctx)
  await state.runtime.observe({ type: 'message_end', message: { role: 'custom', customType: 'pi-agents:graph-result', timestamp: Date.now(), details: { version: 1, graphId: 'graph-1', name: 'retained-graph', policy: 'allSettled', nodes: [{ agentId: 'native-1', name: 'local-analysis-r1', kind: 'answered', body: 'DO-NOT-EXPORT', end: true, inputs: [] }] } } }, state.owner.ctx)
  const after = read(state.directory, runId)
  expect(after.nodes[0]).toEqual({ ...prior, currentAttempt: false })
  const retry = after.nodes.find(node => node.id === 'analysis-2')!
  expect(retry.nativeId).toBe('native-2')
  expect(retry.execution.state).toBe('running')
  expect(retry.verification.state).toBe('unverified')
  await state.runtime.close()
  const recovered = createGraphDashboardRuntime({ directory: state.directory, appendEntry: state.owner.appendEntry })
  runtimes.push(recovered)
  await recovered.restore(state.owner.ctx)
  state.owner.status(async () => executionResult(receipt([agent('local-analysis-r2', 'native-2', 'idle')])))
  await recovered.execute({ operation: 'recover', runId }, state.owner.ctx)
  const reconciled = read(state.directory, runId)
  expect(reconciled.reporting?.recovery).toBe('ready')
  expect(reconciled.nodes[0]).toEqual({ ...prior, currentAttempt: false })
  expect(state.owner.calls).toEqual([{ name: 'agent_status', args: { name: 'local-analysis-r2' } }])
})

// Regression r2: restore marks attempt 1 unreconciled, then declaration retires
// it before recovery. Only current bindings can keep recovery pending. The old
// retry test declares before restore and cannot detect this event ordering.
test('restore then declare retry reconciles current bindings and preserves retired observations', async () => {
  const state = setup()
  const runId = await bound(state)
  const prior = read(state.directory, runId).nodes[0]
  await state.runtime.close()
  const recovered = createGraphDashboardRuntime({ directory: state.directory, appendEntry: state.owner.appendEntry })
  runtimes.push(recovered)
  await recovered.restore(state.owner.ctx)
  expect(read(state.directory, runId).reporting?.recovery).toBe('pending')
  await recovered.execute({ operation: 'declare', runId, nodes: [{ ...declaration('analysis-2', 'local-analysis-r2'), logicalId: prior.logicalId, attempt: 2 }], edges: [] }, state.owner.ctx)
  await launch({ runtime: recovered, owner: state.owner }, 'retry-launch', [agent('local-analysis-r2', 'native-2')])
  await recovered.execute({ operation: 'bind', runId, launchToolCallId: 'retry-launch', nodeIds: ['analysis-2'] }, state.owner.ctx)
  const beforeRecovery = read(state.directory, runId)
  // Keep source times ordered without a timer-based freshness assertion.
  const observedAt = Math.max(Date.now(), Date.parse(beforeRecovery.timestamps.lastSourceObservationAt!) + 1)
  state.owner.status(async () => executionResult(receipt([agent('local-analysis-r2', 'native-2', 'idle')], observedAt)))
  await recovered.execute({ operation: 'recover', runId }, state.owner.ctx)
  const after = read(state.directory, runId)
  expect(after.reporting?.recovery).toBe('ready')
  expect(after.timestamps.lastSourceObservationAt).toBe(new Date(observedAt).toISOString())
  expect(after.nodes[0]).toEqual({ ...prior, currentAttempt: false })
  const retry = after.nodes.find(node => node.id === 'analysis-2')!
  expect(retry.execution.state).toBe('answered')
  expect(retry.verification.state).toBe('unverified')
  expect(state.owner.calls).toEqual([{ name: 'agent_status', args: { name: 'local-analysis-r2' } }])
  await recovered.execute({ operation: 'recover', runId }, state.owner.ctx)
  expect(read(state.directory, runId).reporting?.recovery).toBe('ready')
  expect(read(state.directory, runId).nodes[0]).toEqual({ ...prior, currentAttempt: false })
})

// Regression r3: an unreconciled terminal run cannot transfer recovery IDs to
// its successor. Test both identical and distinct node IDs at the owning runtime.
for (const nodeId of ['analysis-1', 'different-1']) {
  test(`new run ${nodeId} recovers without bindings independently of prior unreconciled run`, async () => {
    const state = setup()
    const firstRunId = await bound(state)
    await state.runtime.close()
    const runtime = createGraphDashboardRuntime({ directory: state.directory, appendEntry: state.owner.appendEntry })
    runtimes.push(runtime)
    await runtime.restore(state.owner.ctx)
    await runtime.execute({ operation: 'update', runId: firstRunId, status: 'succeeded' }, state.owner.ctx)
    const original = read(state.directory, firstRunId)
    const { runId } = await runtime.execute(create([declaration(nodeId, 'new-worker')]), state.owner.ctx)
    expect(runId).not.toBe(firstRunId)
    await runtime.execute({ operation: 'recover', runId }, state.owner.ctx)
    expect(read(state.directory, runId).reporting?.recovery).toBe('ready')
    expect(state.owner.calls).toHaveLength(0)
    expect(read(state.directory, firstRunId)).toEqual(original)
  })

  test(`new run ${nodeId} accepts its fresh owned async result and advances source freshness`, async () => {
    const state = setup()
    const firstRunId = await bound(state)
    await state.runtime.close()
    const runtime = createGraphDashboardRuntime({ directory: state.directory, appendEntry: state.owner.appendEntry })
    runtimes.push(runtime)
    await runtime.restore(state.owner.ctx)
    await runtime.execute({ operation: 'update', runId: firstRunId, status: 'succeeded' }, state.owner.ctx)
    const original = read(state.directory, firstRunId)
    const { runId } = await runtime.execute(create([declaration(nodeId, 'new-worker')]), state.owner.ctx)
    await launch({ runtime, owner: state.owner }, 'new-launch', [agent('new-worker', 'native-2')])
    await runtime.execute({ operation: 'bind', runId, launchToolCallId: 'new-launch', nodeIds: [nodeId] }, state.owner.ctx)
    const before = read(state.directory, runId)
    expect(before.nodes[0].nativeId).toBe('native-2')
    const timestamp = Math.max(Date.now(), Date.parse(before.timestamps.lastSourceObservationAt!) + 1)
    await runtime.observe({ type: 'message_end', message: { role: 'custom', customType: 'pi-agents:result', timestamp, details: { version: 1, agentId: 'native-2', name: 'new-worker', kind: 'answered', body: 'DO-NOT-EXPORT' } } }, state.owner.ctx)
    const after = read(state.directory, runId)
    expect(after.nodes[0].execution.state).toBe('answered')
    expect(after.nodes[0].execution.observedAt).toBe(new Date(timestamp).toISOString())
    expect(after.timestamps.lastSourceObservationAt).toBe(new Date(timestamp).toISOString())
    expect(after.nodes[0].verification.state).toBe('unverified')
    expect(after.reporting?.recovery).toBe('ready')
    expect(read(state.directory, firstRunId)).toEqual(original)
    expect(state.owner.calls).toHaveLength(0)
  })
}

// Failed creation must retain the previous reporting owner and recovery IDs.
// A real private-directory permission rejection exercises persistence failure,
// not only input validation before create reaches the storage boundary.
test('failed new run creation preserves prior owner and unreconciled observations', async () => {
  const state = setup()
  const firstRunId = await bound(state)
  await state.runtime.close()
  const runtime = createGraphDashboardRuntime({ directory: state.directory, appendEntry: state.owner.appendEntry })
  runtimes.push(runtime)
  await runtime.restore(state.owner.ctx)
  await runtime.execute({ operation: 'update', runId: firstRunId, status: 'succeeded' }, state.owner.ctx)
  const before = read(state.directory, firstRunId)
  const entries = structuredClone(state.owner.entries)
  chmodSync(state.directory, 0o755)
  try {
    await expect(runtime.execute(create([declaration('different-1', 'new-worker')]), state.owner.ctx)).rejects.toThrow('unsafe artifact')
  } finally { chmodSync(state.directory, 0o700) }
  expect(read(state.directory, firstRunId)).toEqual(before)
  expect(state.owner.entries).toEqual(entries)
  await runtime.observe({ type: 'tool_execution_update', toolName: 'agent_wait', toolCallId: 'original-wait', args: { names: ['local-analysis-r1'] }, partialResult: receipt([agent('local-analysis-r1', 'native-1', 'idle')]) }, state.owner.ctx)
  expect(read(state.directory, firstRunId)).toEqual(before)
  state.owner.status(async () => executionResult(receipt([agent('local-analysis-r1', 'native-1', 'idle')])))
  await runtime.execute({ operation: 'recover', runId: firstRunId }, state.owner.ctx)
  const after = read(state.directory, firstRunId)
  expect(after.reporting?.recovery).toBe('ready')
  expect(after.nodes.filter(node => node.kind === 'worker')).toHaveLength(1)
  expect(after.nodes[0].nativeId).toBe('native-1')
  expect(after.nodes[0].execution.state).toBe('answered')
  expect(state.owner.calls).toEqual([{ name: 'agent_status', args: { name: 'local-analysis-r1' } }])
})

// A rejected first checkpoint for a replacement run must not transfer the
// active owner to a new snapshot while the server still serves the prior run.
// The public append callback is the only injected failure boundary.
test('rejected replacement create checkpoint retains prior owner, link, and recovery tracking', async () => {
  const state = setup()
  const runId = await bound(state)
  await state.runtime.close()
  const recovered = createGraphDashboardRuntime({ directory: state.directory, appendEntry: state.owner.appendEntry })
  runtimes.push(recovered)
  await recovered.restore(state.owner.ctx)
  await recovered.execute({ operation: 'update', runId, status: 'succeeded' }, state.owner.ctx)
  const previous = await recovered.execute({ operation: 'show', runId }, state.owner.ctx)
  expect(previous.reportUrl).not.toBeNull()
  const before = read(state.directory, runId)
  expect(before.reporting?.recovery).toBe('pending')
  const html = readFileSync(previous.exportPath, 'utf8')
  const entries = structuredClone(state.owner.entries)
  state.owner.failCheckpoint(1)
  await expect(recovered.execute(create([declaration('replacement-1', 'replacement-worker')]), state.owner.ctx)).rejects.toThrow('injected checkpoint append failure')
  expect(state.owner.entries).toEqual(entries)
  expect(read(state.directory, runId)).toEqual(before)
  expect(readFileSync(previous.exportPath, 'utf8')).toBe(html)
  const shown = await recovered.execute({ operation: 'show', runId }, state.owner.ctx)
  expect(shown).toEqual(previous)
  expect(state.owner.statuses.at(-1)).toContain(previous.reportUrl!)
  const newIds = readdirSync(state.directory).filter(file => file.endsWith('.json') && file !== `${runId}.json`).map(file => file.slice(0, -5))
  expect(newIds).toHaveLength(1)
  await expect(recovered.execute({ operation: 'show', runId: newIds[0] }, state.owner.ctx)).rejects.toThrow('foreign run identity')
  const report = await fetch(shown.reportUrl!)
  expect(report.status).toBe(200)
  expect(await report.text()).toContain(runId)
  const served = await (await fetch(shown.reportUrl!.replace(/\/report$/, '/snapshot'))).json() as GraphSnapshot
  expect(served.runId).toBe(shown.runId)
  expect(served.runId).toBe(runId)
  await recovered.observe({ type: 'tool_execution_update', toolName: 'agent_wait', toolCallId: 'original-wait', args: { names: ['local-analysis-r1'] }, partialResult: receipt([agent('local-analysis-r1', 'native-1', 'idle')]) }, state.owner.ctx)
  expect(read(state.directory, runId)).toEqual(before)
  state.owner.status(async () => executionResult(receipt([agent('local-analysis-r1', 'native-1', 'idle')])))
  const reconciled = await recovered.execute({ operation: 'recover', runId }, state.owner.ctx)
  expect(reconciled.runId).toBe(runId)
  expect(state.owner.calls).toEqual([{ name: 'agent_status', args: { name: 'local-analysis-r1' } }])
  const after = read(state.directory, runId)
  expect(after.reporting?.recovery).toBe('ready')
  expect(after.nodes[0].execution.state).toBe('answered')
  expect(after.nodes[0].verification.state).toBe('unverified')
  expect(after.timestamps.lastSourceObservationAt).not.toBeNull()
  expect((await (await fetch(reconciled.reportUrl!.replace(/\/report$/, '/snapshot'))).json() as GraphSnapshot).runId).toBe(runId)
})

test('rejected first-run checkpoint leaves no active owner or stale link', async () => {
  const state = setup()
  state.owner.failCheckpoint(1)
  await expect(state.runtime.execute(create(), state.owner.ctx)).rejects.toThrow('injected checkpoint append failure')
  expect(state.owner.entries.filter(entry => entry.customType === 'agent-graph-dashboard:v1')).toHaveLength(0)
  expect(state.owner.statuses.filter(Boolean)).toHaveLength(0)
  const orphanIds = readdirSync(state.directory).filter(file => file.endsWith('.json')).map(file => file.slice(0, -5))
  expect(orphanIds).toHaveLength(1)
  await expect(state.runtime.execute({ operation: 'show', runId: orphanIds[0] }, state.owner.ctx)).rejects.toThrow()
  const next = await state.runtime.execute(create(), state.owner.ctx)
  expect(next.runId).not.toBe(orphanIds[0])
  expect((await (await fetch(next.reportUrl!.replace(/\/report$/, '/snapshot'))).json() as GraphSnapshot).runId).toBe(next.runId)
})

// A declaration that cannot persist must not retire recovery tracking. Real
// writer-lock rejection protects the ordering of persistence and set pruning.
test('failed retry declaration retains original recovery tracking and historical observations', async () => {
  const state = setup()
  const runId = await bound(state)
  await state.runtime.close()
  const recovered = createGraphDashboardRuntime({ directory: state.directory, appendEntry: state.owner.appendEntry })
  runtimes.push(recovered)
  await recovered.restore(state.owner.ctx)
  const before = read(state.directory, runId)
  const lock = join(state.directory, `${runId}.lock`)
  mkdirSync(lock, { mode: 0o700 })
  try {
    await expect(recovered.execute({ operation: 'declare', runId, nodes: [{ ...declaration('analysis-2', 'local-analysis-r2'), logicalId: before.nodes[0].logicalId, attempt: 2 }], edges: [] }, state.owner.ctx)).rejects.toThrow('writer lock')
  } finally { rmSync(lock, { recursive: true }) }
  expect(read(state.directory, runId)).toEqual(before)
  await recovered.observe({ type: 'tool_execution_update', toolName: 'agent_wait', toolCallId: 'wait-original', args: { names: ['local-analysis-r1'] }, partialResult: receipt([agent('local-analysis-r1', 'native-1', 'idle')]) }, state.owner.ctx)
  expect(read(state.directory, runId)).toEqual(before)
  state.owner.status(async () => executionResult(receipt([agent('local-analysis-r1', 'native-1', 'idle')])))
  await recovered.execute({ operation: 'recover', runId }, state.owner.ctx)
  const after = read(state.directory, runId)
  expect(after.reporting?.recovery).toBe('ready')
  expect(after.nodes.filter(node => node.kind === 'worker')).toHaveLength(1)
  expect(after.nodes[0].currentAttempt).toBe(true)
  expect(after.nodes[0].nativeId).toBe('native-1')
  expect(state.owner.calls).toEqual([{ name: 'agent_status', args: { name: 'local-analysis-r1' } }])
})

// Regression: a wait timeout/error is treated as worker cancellation rather than
// reporting interruption. Existing store tests cannot reach native event errors.
test('failed wait delivery does not cancel workers or clear parent verification', async () => {
  const state = setup()
  const runId = await bound(state)
  const before = read(state.directory, runId)
  await state.runtime.observe({ type: 'tool_execution_end', toolName: 'agent_wait', toolCallId: 'interrupted-wait', isError: true, result: { content: [], details: undefined } }, state.owner.ctx)
  expect(read(state.directory, runId)).toEqual(before)
  expect(state.owner.calls).toHaveLength(0)
})

// A valid declaration plus ten MR phases and approval fills the node limit.
// It can expand beyond the HTML delivery limit
// after escaping. Creation must reject it before publishing unusable links.
function oversizedInitialDeclarations(): Declaration[] {
  return Array.from({ length: 501 }, (_, index) => ({
    ...declaration(`node-${index}`, `worker-${index}`), label: '&'.repeat(512),
  }))
}

test('initial oversized rendered report rejects creation before success links', async () => {
  const state = setup()
  await expect(state.runtime.execute(create(oversizedInitialDeclarations()), state.owner.ctx)).rejects.toThrow(/HTML|render|report/i)
  expect(state.owner.statuses.filter(Boolean)).toHaveLength(0)
  expect(state.owner.entries.filter(entry => entry.customType === 'agent-graph-dashboard:v1')).toHaveLength(0)
})

test('initial oversized rendered report preserves prior active-report ownership', async () => {
  const state = setup()
  const previous = await state.runtime.execute(create(), state.owner.ctx)
  await state.runtime.execute({ operation: 'update', runId: previous.runId, status: 'succeeded' }, state.owner.ctx)
  const snapshot = read(state.directory, previous.runId)
  const exportHtml = readFileSync(previous.exportPath, 'utf8')
  const entries = structuredClone(state.owner.entries)
  await expect(state.runtime.execute(create(oversizedInitialDeclarations()), state.owner.ctx)).rejects.toThrow(/HTML|render|report/i)
  expect(read(state.directory, previous.runId)).toEqual(snapshot)
  expect(readFileSync(previous.exportPath, 'utf8')).toBe(exportHtml)
  expect(state.owner.entries).toEqual(entries)
  const shown = await state.runtime.execute({ operation: 'show', runId: previous.runId }, state.owner.ctx)
  expect(shown.runId).toBe(previous.runId)
  expect(shown.exportPath).toBe(previous.exportPath)
  expect(state.owner.statuses.at(-1)).toContain(shown.reportUrl ?? shown.fileUrl)
})

// Regression: the Node adapter publishes an invalid child endpoint, writes
// world-readable reports, or loses same-run evidence after report-server restart.
// This exercises the actual Bun CLI/server and filesystem, not a transport mock.
test('real Bun delivery serves matching private artifacts and restart retains run identity', async () => {
  const state = setup()
  const result = await state.runtime.execute(create(), state.owner.ctx)
  expect(result.reportUrl).not.toBeNull()
  expect(result.fileUrl).toContain('graph%20runtime-')
  expect(statSync(state.directory).mode & 0o777).toBe(0o700)
  expect(statSync(result.exportPath).mode & 0o777).toBe(0o600)
  const online = await fetch(result.reportUrl!)
  expect(online.status).toBe(200)
  expect(await online.text()).toContain(result.runId)
  const offline = readFileSync(result.exportPath, 'utf8')
  expect(offline).toContain(result.runId)
  const snapshotUrl = result.reportUrl!.replace(/\/report$/, '/snapshot')
  expect(await (await fetch(snapshotUrl)).json()).toEqual(read(state.directory, result.runId))
  expect((await fetch(snapshotUrl, { method: 'POST' })).status).toBe(405)
  await state.runtime.close()
  const recovered = createGraphDashboardRuntime({ directory: state.directory, appendEntry: state.owner.appendEntry })
  runtimes.push(recovered)
  await recovered.restore(state.owner.ctx)
  const restarted = await recovered.execute({ operation: 'recover', runId: result.runId }, state.owner.ctx)
  expect(restarted.runId).toBe(result.runId)
  expect(restarted.exportPath).toBe(result.exportPath)
  expect((await fetch(restarted.reportUrl!)).status).toBe(200)
  expect(state.owner.calls).toHaveLength(0)
})

// Regression: export failure blocks the parent operation or changes an execution
// outcome. The real artifact safety check fails while the old HTML remains intact.
test('export failure retains prior HTML and does not change worker execution or verification', async () => {
  const state = setup()
  const runId = await bound(state)
  const path = join(state.directory, `${runId}.html`)
  const oldHtml = readFileSync(path, 'utf8')
  const before = read(state.directory, runId).nodes[0]
  chmodSync(path, 0o644)
  try {
    await state.runtime.execute({ operation: 'update', runId, currentStage: 'checks' }, state.owner.ctx)
    expect(readFileSync(path, 'utf8')).toBe(oldHtml)
    expect(read(state.directory, runId).nodes[0]).toEqual(before)
    expect(state.owner.errors.some(message => message.includes('HTML export failed'))).toBe(true)
  } finally { chmodSync(path, 0o600) }
})
