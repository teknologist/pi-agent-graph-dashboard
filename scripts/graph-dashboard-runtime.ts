import { randomUUID, randomBytes } from 'node:crypto'
import { closeSync, constants, fsyncSync, lstatSync, mkdirSync, openSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { createGraphDashboardStore, validateGraphSnapshot, type GraphSnapshot, type GraphNode, type GraphEdge, type GateState, type ExecutionState, type VerificationState, type RunStatus, type GraphCondition, type GraphEvidence } from './graph-dashboard-store'
import { renderGraphDashboard } from './graph-dashboard-render'

export interface Declaration {
  id: string; logicalId: string; label: string; role: string; stage: string
  kind: 'worker' | 'parent' | 'gate'; attempt: number; nativeName: string | null
  gate: { state: GateState; clearingCondition: string } | null
}
export type DashboardInput =
  | { operation: 'create'; runName: string; command: GraphSnapshot['command']; currentStage: string; topology: GraphSnapshot['topology']; nodes: Declaration[]; edges: GraphEdge[] }
  | { operation: 'declare'; runId: string; nodes: Declaration[]; edges: GraphEdge[] }
  | { operation: 'bind'; runId: string; launchToolCallId: string; nodeIds: string[] }
  | { operation: 'update'; runId: string; currentStage?: string; topology?: GraphSnapshot['topology']; status?: RunStatus; workspace?: NonNullable<GraphSnapshot['workspace']>; nodes?: { id: string; execution?: ExecutionState; verification?: { state: VerificationState; reason: string | null }; gate?: NonNullable<GraphNode['gate']>; blocker?: GraphCondition | null; wait?: GraphCondition | null; evidence?: GraphEvidence[] }[] }
  | { operation: 'recover' | 'show'; runId: string }

export interface DashboardContext {
  cwd?: string
  hasUI?: boolean
  sessionManager: { getSessionId(): string; getSessionFile(): string | undefined; getBranch(): readonly unknown[]; getLeafId(): string | null }
  ui: { notify(text: string, level?: 'info' | 'warning' | 'error'): void; setStatus(key: string, text: string | undefined): void }
  executeTool?: (name: string, args: unknown) => Promise<unknown>
}
type Context = DashboardContext
interface NativeAgent { id: string; name: string; state: ExecutionState; stateSince: number }
interface Receipt { at: number; agents: NativeAgent[] }
interface Binding { nodeId: string; name: string; nativeId: string; launchToolCallId: string }
interface Checkpoint { version: 1; snapshot: GraphSnapshot; names: Record<string, string>; bindings: Binding[] }
interface LaunchOwnership { version: 1; parentSessionId: string; runId: string; toolCallId: string; toolName: string; names: string[]; receipt?: Receipt }
const ENTRY = 'agent-graph-dashboard:v1'
const LAUNCH_ENTRY = 'agent-graph-dashboard:launch:v1'
const OBSERVATION_ENTRY = 'agent-graph-dashboard:observation:v1'
const STATUS = 'agent-graph-dashboard'
const nativeTools = new Set(['agent_spawn', 'agent_spawn_graph', 'agent_send', 'agent_wait', 'agent_status', 'agent_stop'])
const identifier = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/
const nativeStates: Record<string, ExecutionState> = { working: 'running', waiting: 'waiting', idle: 'answered', failed: 'failed', interrupted: 'interrupted', skipped: 'skipped' }
function fail(message: string): never { throw new Error(`Graph dashboard: ${message}`) }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail('expected plain public data')
  return value as Record<string, unknown>
}
function exact(value: unknown, required: string[], optional: string[] = []) {
  const object = record(value)
  if (required.some(key => !(key in object)) || Object.keys(object).some(key => !required.includes(key) && !optional.includes(key))) fail('unexpected or missing input field')
}
function branch(ctx: Context) { return ctx.sessionManager.getBranch().map(record) }
function nativeReceipt(result: unknown): Receipt {
  const details = record(record(result).details)
  if (typeof details.at !== 'number' || !Number.isSafeInteger(details.at) || details.at < 0 || details.at > Date.now() + 1000 || !Array.isArray(details.agents) || details.agents.length > 512) fail('missing or malformed public native receipt')
  const agents: NativeAgent[] = details.agents.map((value: unknown) => {
    const info = record(value)
    if (typeof info.id !== 'string' || !identifier.test(info.id) || typeof info.name !== 'string' || !info.name || info.name.length > 512 || typeof info.state !== 'string' || !Object.hasOwn(nativeStates, info.state) || typeof info.stateSince !== 'number' || !Number.isFinite(info.stateSince)) fail('malformed native identity or state')
    return { id: info.id, name: info.name, state: nativeStates[info.state], stateSince: info.stateSince }
  })
  if (new Set(agents.map(info => info.id)).size !== agents.length || new Set(agents.map(info => info.name)).size !== agents.length) fail('ambiguous native receipt')
  return { at: details.at, agents }
}
/** Public custom message details are a terminal receipt, not a worker transcript. */
function resultMessage(message: unknown): Receipt | null {
  const source = record(message)
  if (source.role !== 'custom' || !['pi-agents:result', 'pi-agents:graph-result'].includes(String(source.customType))) return null
  const details = record(source.details)
  if (details.version !== 1 || typeof source.timestamp !== 'number' || !Number.isSafeInteger(source.timestamp) || source.timestamp > Date.now() + 1000) fail('invalid native result message')
  const values = source.customType === 'pi-agents:result' ? [details] : details.nodes
  if (!Array.isArray(values) || values.length > 512) fail('invalid native graph result')
  const outcomes: Record<string, ExecutionState> = { answered: 'answered', failed: 'failed', interrupted: 'interrupted', stopped: 'cancelled', skipped: 'skipped' }
  const agents = values.map((value: unknown): NativeAgent => {
    const node = record(value)
    if (typeof node.agentId !== 'string' || !identifier.test(node.agentId) || typeof node.name !== 'string' || !node.name || typeof node.kind !== 'string' || !Object.hasOwn(outcomes, node.kind)) fail('invalid native result identity')
    return { id: node.agentId, name: node.name, state: outcomes[node.kind], stateSince: source.timestamp as number }
  })
  if (new Set(agents.map(agent => agent.id)).size !== agents.length || new Set(agents.map(agent => agent.name)).size !== agents.length) fail('ambiguous native result message')
  return { at: source.timestamp, agents }
}
/** Shared public decoder for live observation and delayed branch replay. */
function nativeObservation(input: unknown): Receipt | null {
  const event = record(input)
  const source = event.type === 'message_end' ? record(event.message) : event
  if (source.role === 'custom') return resultMessage(source)
  if (typeof source.toolName !== 'string' || !nativeTools.has(source.toolName) || typeof source.toolCallId !== 'string' || source.isError) return null
  if (source.role === 'toolResult') return nativeReceipt(source)
  if (source.type === 'tool_execution_update') return nativeReceipt(source.partialResult)
  if (source.type === 'tool_execution_end') return nativeReceipt(source.result)
  return null
}
/** Saved native observations contain only validated identity, state, and time. */
function savedNativeReceipt(value: unknown): Receipt {
  const saved = record(value)
  exact(saved, ['at', 'agents'])
  if (!Array.isArray(saved.agents)) fail('malformed saved native receipt')
  return nativeReceipt({ details: { at: saved.at, agents: saved.agents.map(value => {
    const agent = record(value)
    exact(agent, ['id', 'name', 'state', 'stateSince'])
    const state = Object.entries(nativeStates).find(([, mapped]) => mapped === agent.state)?.[0]
    return { ...agent, state }
  }) } })
}
function declarations(nodes: Declaration[], names: Record<string, string>, existing: GraphNode[] = []): GraphNode[] {
  if (!Array.isArray(nodes)) fail('missing declarations')
  const used = new Set(Object.values(names))
  return nodes.map(node => {
    exact(node, ['id', 'logicalId', 'label', 'role', 'stage', 'kind', 'attempt', 'nativeName', 'gate'])
    if (existing.some(old => old.id === node.id) || (node.kind === 'worker' ? typeof node.nativeName !== 'string' || !node.nativeName.trim() || node.nativeName.length > 512 || /[\u0000-\u001f\u007f]/.test(node.nativeName) : node.nativeName !== null)) fail('invalid declaration or native name')
    if (node.nativeName !== null) {
      if (used.has(node.nativeName)) fail('duplicate nativeName declaration')
      used.add(node.nativeName); names[node.id] = node.nativeName
    }
    return { id: node.id, logicalId: node.logicalId, label: node.label, role: node.role, stage: node.stage, kind: node.kind, attempt: node.attempt, currentAttempt: true, nativeId: null,
      execution: { state: 'planned', observedAt: null }, verification: { state: 'unverified', reason: null }, gate: node.gate, blocker: null, wait: null, evidence: [] }
  })
}

// Fixed command reporting order, not native scheduling or inferred execution.
// The MR publication phase reports per-item outcomes; it is not a shared gate.
// Linear sync and final report follow partial publication too. These edges
// record reporting sequence, never an all-success requirement.
// DF waves and CriteriaRepair remain caller-declared conditional topology.
const commandPhases: Partial<Record<GraphSnapshot['command'], string[][]>> = {
  '/gitlab-address-pr-agent-review': [
    ['MR identity', 'identity'], ['shared review-data fetch', 'fetch'], ['analysis'],
    ['selection approval', 'selection-approval'], ['serial edits', 'serial-edits'], ['checks'],
    ['independent audit', 'independent-audit'], ['GitLab publication', 'gitlab-publication'],
    ['Linear sync', 'linear-sync'], ['final report', 'final-report'],
  ],
}
function phaseNodes(command: GraphSnapshot['command'], nodes: Declaration[] | GraphNode[]) {
  return commandPhases[command]?.map(stages => {
    const matches = nodes.filter(node => node.kind === 'parent' && (!('currentAttempt' in node) || node.currentAttempt) && stages.includes(node.stage) && (node.role === 'parent phase' || node.id.startsWith('phase-') || node.id.startsWith('command-phase-')))
    if (matches.length > 1) fail('ambiguous command phase declaration')
    return matches[0]
  }) ?? []
}
function addEdge(edges: GraphEdge[], edge: GraphEdge) {
  if (!edges.some(old => old.from === edge.from && old.to === edge.to && old.type === edge.type)) edges.push(edge)
}
function commandTopology(command: GraphSnapshot['command'], input: Declaration[], supplied: GraphEdge[]) {
  const nodes = [...input], edges = [...supplied]
  const phases = phaseNodes(command, nodes)
  for (const [index, stages] of (commandPhases[command] ?? []).entries()) {
    if (!phases[index]) {
      const id = `command-phase-${index}`
      if (nodes.some(node => node.id === id || node.logicalId === id)) fail('reserved command phase identifier')
      const node: Declaration = { id, logicalId: id, label: stages[0], role: 'parent phase', stage: stages[0], kind: 'parent', attempt: 1, nativeName: null, gate: null }
      nodes.push(node); phases[index] = node
    }
    if (index) addEdge(edges, { from: phases[index - 1]!.id, to: phases[index]!.id, type: 'parent-gate' })
  }
  // Selection approval is a shared parent decision. Publication gates are NOT.
  if (command === '/gitlab-address-pr-agent-review') {
    const gates = nodes.filter(node => node.kind === 'gate' && commandPhases[command]![3].includes(node.stage))
    if (!gates.length) {
      const id = 'command-selection-approval'
      if (nodes.some(node => node.id === id || node.logicalId === id)) fail('reserved command gate identifier')
      const gate: Declaration = { id, logicalId: id, label: 'Scope approval', role: 'approval gate', stage: 'selection approval', kind: 'gate', attempt: 1, nativeName: null, gate: { state: 'waiting', clearingCondition: 'User confirms the selected scope under the original command rules' } }
      nodes.push(gate); gates.push(gate)
    }
    for (const gate of gates) {
      addEdge(edges, { from: phases[3]!.id, to: gate.id, type: 'parent-gate' })
      addEdge(edges, { from: gate.id, to: phases[4]!.id, type: 'parent-gate' })
    }
  }
  workerPrerequisites(command, nodes, edges)
  return { nodes, edges }
}
function workerPrerequisites(command: GraphSnapshot['command'], nodes: Declaration[] | GraphNode[], edges: GraphEdge[]) {
  const phases = phaseNodes(command, nodes)
  // A legacy sparse run stays frozen. Only a complete declared scaffold owns
  // these fixed prerequisites. Never infer a native-after edge or receipt.
  if (!phases.length || phases.some(node => !node) || phases.some((node, index) => index && !edges.some(edge => edge.from === phases[index - 1]!.id && edge.to === node!.id && edge.type === 'parent-gate'))) return
  for (const worker of nodes.filter(node => node.kind === 'worker' && (!('currentAttempt' in node) || node.currentAttempt))) {
    // The caller supplies the verification target. Do not guess from a name.
    for (const edge of [...edges].filter(edge => edge.from === worker.id && edge.type === 'verification')) {
      const index = phases.findIndex(node => node!.id === edge.to)
      if (index === 2 || index === 6) addEdge(edges, { from: phases[index - 1]!.id, to: worker.id, type: 'parent-gate' })
    }
  }
}

function validateCheckpointMetadata(snapshot: GraphSnapshot, names: unknown, bindings: unknown) {
  const declared = record(names)
  const workers = snapshot.nodes.filter(node => node.kind === 'worker')
  if (Object.keys(declared).length !== workers.length || workers.some(node => typeof declared[node.id] !== 'string' || !(declared[node.id] as string).length || (declared[node.id] as string).length > 512 || /[\u0000-\u001f\u007f]/.test(declared[node.id] as string)) || new Set(Object.values(declared)).size !== workers.length) fail('inconsistent checkpoint names')
  if (!Array.isArray(bindings)) fail('inconsistent checkpoint bindings')
  const nodeIds = new Set<string>(), nativeIds = new Set<string>()
  for (const value of bindings) {
    exact(value, ['nodeId', 'name', 'nativeId', 'launchToolCallId'])
    const binding = record(value)
    const node = workers.find(node => node.id === binding.nodeId)
    if (!node || !node.nativeId || binding.nativeId !== node.nativeId || binding.name !== declared[node.id] || typeof binding.launchToolCallId !== 'string' || !binding.launchToolCallId || nodeIds.has(node.id) || nativeIds.has(node.nativeId)) fail('inconsistent checkpoint binding identity')
    nodeIds.add(node.id); nativeIds.add(node.nativeId)
  }
  if (workers.some(node => node.nativeId && !nodeIds.has(node.id))) fail('incomplete checkpoint bindings')
}

/** Parent-owned reporting boundary. The directory is trusted adapter configuration,
 * never a tool argument. Native tools remain the only execution engine. */
export function createGraphDashboardRuntime(options: { directory: string; appendEntry: (customType: string, data: unknown) => void }) {
  let generation = 0
  let context: Context | null = null
  let active: Checkpoint | null = null
  let writable = false
  let checkpointId: string | null = null
  let queue: Promise<unknown> = Promise.resolve()
  let recoveringStatusGeneration: number | null = null
  const unreconciled = new Set<string>()
  let child: ChildProcess | null = null
  let endpoint: string | null = null

  function report(ctx: Context, message: string) { ctx.ui.notify(`Graph dashboard: ${message}`, 'error') }
  function sameSession(ctx: Context) { return context?.sessionManager.getSessionId() === ctx.sessionManager.getSessionId() }
  function current(ctx: Context, token: number) {
    if (generation !== token || !sameSession(ctx) || active?.snapshot.parentSessionId !== ctx.sessionManager.getSessionId()) fail('session changed; reporting update discarded')
  }
  function owned(ctx: Context) {
    if (!active || !writable || active.snapshot.parentSessionId !== ctx.sessionManager.getSessionId() || !branch(ctx).some(entry => entry.id === checkpointId && entry.type === 'custom' && entry.customType === ENTRY)) fail('run is not writable on this parent branch')
    const persisted = store().read()
    if (!persisted || persisted.revision !== active.snapshot.revision) fail('branch checkpoint does not match persisted revision')
  }
  function ownedLaunch(toolCallId: string, ctx: Context): LaunchOwnership | null {
    if (!active) return null
    const entries = branch(ctx).filter(entry => entry.type === 'custom' && entry.customType === LAUNCH_ENTRY).map(entry => record(entry.data))
    const value = entries.filter(entry => entry.toolCallId === toolCallId && entry.runId === active!.snapshot.runId && entry.parentSessionId === active!.snapshot.parentSessionId).at(-1)
    if (!value) return null
    exact(value, ['version', 'parentSessionId', 'runId', 'toolCallId', 'toolName', 'names'], ['receipt'])
    if (value.version !== 1 || typeof value.toolName !== 'string' || !['agent_spawn', 'agent_spawn_graph'].includes(value.toolName) || !Array.isArray(value.names) || !value.names.length || value.names.length > 12 || !value.names.every((name): name is string => typeof name === 'string' && Object.values(active!.names).includes(name)) || new Set(value.names).size !== value.names.length) fail('malformed launch ownership')
    const ownership: LaunchOwnership = { version: 1, parentSessionId: active.snapshot.parentSessionId, runId: active.snapshot.runId, toolCallId, toolName: value.toolName, names: value.names }
    if (value.receipt !== undefined) ownership.receipt = savedNativeReceipt(value.receipt)
    return ownership
  }
  function matchesLaunch(launch: LaunchOwnership, receipt: Receipt) {
    return receipt.agents.length === launch.names.length && launch.names.every(name => receipt.agents.some(agent => agent.name === name)) && (!launch.receipt || launch.receipt.agents.every(old => receipt.agents.some(agent => agent.name === old.name && agent.id === old.id)))
  }
  function recordLaunch(launch: LaunchOwnership, ctx: Context, token: number) {
    current(ctx, token); owned(ctx)
    options.appendEntry(LAUNCH_ENTRY, launch)
  }
  function recordUnboundObservation(receipt: Receipt, ctx: Context, token: number) {
    current(ctx, token); owned(ctx)
    const launches = new Set(branch(ctx).filter(entry => entry.type === 'custom' && entry.customType === LAUNCH_ENTRY).map(entry => record(entry.data)).filter(value => value.parentSessionId === active!.snapshot.parentSessionId && value.runId === active!.snapshot.runId && typeof value.toolCallId === 'string').map(value => value.toolCallId as string))
    for (const launchToolCallId of launches) {
      const launch = ownedLaunch(launchToolCallId, ctx)
      if (!launch?.receipt) continue
      const agents = receipt.agents.filter(agent => launch.receipt!.agents.some(allocated => allocated.id === agent.id && allocated.name === agent.name) && active!.snapshot.nodes.some(node => node.currentAttempt && node.kind === 'worker' && !node.nativeId && active!.names[node.id] === agent.name))
      if (!agents.length || receipt.at < launch.receipt.at) continue
      // Partial and nested completed events have no transcript toolResult.
      // Save only exact allocated, unbound current identities for this owner.
      current(ctx, token); owned(ctx)
      options.appendEntry(OBSERVATION_ENTRY, { version: 1, parentSessionId: active!.snapshot.parentSessionId, runId: active!.snapshot.runId, launchToolCallId, receipt: { at: receipt.at, agents } })
    }
  }
  function store() {
    if (!active) fail('no active run')
    return createGraphDashboardStore({ directory: options.directory, runId: active.snapshot.runId, parentSessionId: active.snapshot.parentSessionId })
  }
  function checkpoint(ctx: Context, token: number) {
    current(ctx, token)
    options.appendEntry(ENTRY, structuredClone(active))
    checkpointId = ctx.sessionManager.getLeafId()
  }
  function links(ctx: Context) {
    if (!active) return { runId: '', reportUrl: null, exportPath: '', fileUrl: '' }
    const snapshot = active.snapshot
    const exportPath = join(options.directory, `${snapshot.runId}.html`)
    const fileUrl = pathToFileURL(exportPath).href
    const pending = unreconciled.size ? ' · reconciliation pending' : ''
    const nodes = snapshot.nodes.filter(node => node.currentAttempt)
    const blocked = nodes.filter(node => node.blocker || node.gate?.state === 'blocked' || node.execution.state === 'failed' || node.verification.state === 'failed')
    const running = nodes.filter(node => node.execution.state === 'running')
    const waiting = nodes.filter(node => node.wait || node.execution.state === 'waiting' || node.gate?.state === 'waiting' || node.gate?.state === 'awaiting-approval')
    const selected = blocked.length ? blocked : running.length ? running : waiting
    const activity = snapshot.status !== 'active' ? snapshot.status : blocked.length ? 'blocked' : running.length ? 'running' : waiting.length ? 'waiting' : 'active'
    const color = activity === 'succeeded' ? 32 : activity === 'blocked' || activity === 'partial-failure' ? 31 : activity === 'running' || activity === 'active' ? 34 : 33
    const nodeLabel = snapshot.status === 'active' && selected.length ? ` · ${selected[0].label.slice(0, 40)}${selected.length > 1 ? ` +${selected.length - 1}` : ''}` : ''
    const label = `\uf0e8 ${snapshot.runName.slice(0, 64)} · \x1b[${color}m${activity}\x1b[39m · ${snapshot.currentStage.slice(0, 40)}${nodeLabel}${pending}`
    ctx.ui.setStatus(STATUS, `\x1b]8;;${endpoint ?? fileUrl}\x1b\\${label}\x1b]8;;\x1b\\`)
    return { runId: snapshot.runId, reportUrl: endpoint, exportPath, fileUrl }
  }
  function renderHtml(snapshot: GraphSnapshot) {
    const html = renderGraphDashboard(snapshot, { snapshotPath: `/runs/${snapshot.runId}/snapshot`, reportPath: `/runs/${snapshot.runId}/report`, renderedAt: new Date().toISOString(), nonce: randomBytes(18).toString('base64'), refreshIntervalMs: 5000, staleAfterMs: 15000 })
    if (Buffer.byteLength(html) > 4_194_304) fail('HTML export too large')
    return html
  }
  function exportHtml(snapshot: GraphSnapshot) {
    const html = renderHtml(snapshot)
    const path = join(options.directory, `${snapshot.runId}.html`)
    try {
      const stat = lstatSync(path)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o600 || stat.nlink !== 1) fail('unsafe HTML artifact')
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const temporary = join(options.directory, `.${snapshot.runId}.${randomUUID()}.html.tmp`)
    const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    try {
      writeFileSync(fd, html); fsyncSync(fd); closeSync(fd)
      renameSync(temporary, path)
    } catch (error) { try { closeSync(fd) } catch {} ; try { unlinkSync(temporary) } catch {} ; throw error }
  }
  function commit(next: GraphSnapshot, ctx: Context, token: number, recovery?: ReadonlySet<string>, metadata?: Pick<Checkpoint, 'names' | 'bindings'>) {
    current(ctx, token); owned(ctx)
    next.revision = active!.snapshot.revision + 1
    next.updatedAt = new Date(Math.max(Date.now(), Date.parse(active!.snapshot.updatedAt))).toISOString()
    next.timestamps.observerHeartbeatAt = next.updatedAt
    const owner = { names: metadata?.names ?? active!.names, bindings: metadata?.bindings ?? active!.bindings }
    validateCheckpointMetadata(next, owner.names, owner.bindings)
    const persisted = store().write(next)
    active = { ...active!, ...owner, snapshot: persisted }
    // Recovery filtering changes with the primary durable snapshot, not with
    // status reads or the optional HTML write. Publish before checkpoint/links.
    if (recovery) {
      unreconciled.clear()
      for (const id of recovery) unreconciled.add(id)
    }
    // Recording the actual export time is a separate persistence operation. It
    // never advances source observations. A failed export leaves old HTML intact.
    try {
      exportHtml(active!.snapshot)
      const rendered = structuredClone(active!.snapshot)
      rendered.revision++; rendered.timestamps.lastHtmlRenderAt = rendered.updatedAt
      active!.snapshot = store().write(rendered)
    } catch { report(ctx, 'HTML export failed; last valid report retained') }
    checkpoint(ctx, token); links(ctx)
  }
  async function stopServer() {
    const previous = child
    child = null; endpoint = null
    if (!previous) return
    previous.stdin?.end()
    if (previous.exitCode !== null || previous.signalCode !== null) return
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => { previous.kill('SIGKILL'); resolve() }, 1000)
      previous.once('exit', () => { clearTimeout(timer); resolve() })
      previous.kill('SIGTERM')
    })
  }
  async function startServer(ctx: Context, token: number) {
    if (child && endpoint) return
    if (!active) return
    const { runId, parentSessionId } = active.snapshot
    const processChild = spawn('bun', [fileURLToPath(new URL('./graph-dashboard-cli.ts', import.meta.url)), runId, parentSessionId], {
      stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PI_GRAPH_DASHBOARD_DIRECTORY: options.directory },
    })
    child = processChild
    // Never publish child stderr: it can contain host paths or environment data.
    processChild.stderr?.resume()
    try {
      const port = await new Promise<number>((resolve, reject) => {
        let output = ''
        const timer = setTimeout(() => reject(new Error('startup timeout')), 5000)
        const done = (error?: Error, value?: number) => { clearTimeout(timer); error ? reject(error) : resolve(value!) }
        processChild.once('error', () => done(new Error('Bun unavailable')))
        processChild.once('exit', () => done(new Error('server exited')))
        processChild.stdout?.on('data', chunk => {
          output += String(chunk)
          if (output.length > 1024) { done(new Error('invalid server receipt')); return }
          if (!output.includes('\n')) return
          try {
            const value = record(JSON.parse(output.split('\n')[0]) as unknown)
            if (value.runId !== runId || value.parentSessionId !== parentSessionId || typeof value.port !== 'number' || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535) throw new Error('invalid receipt')
            done(undefined, value.port)
          } catch { done(new Error('invalid server receipt')) }
        })
      })
      current(ctx, token)
      if (child !== processChild) fail('server generation changed')
      endpoint = `http://127.0.0.1:${port}/runs/${runId}/report`
      processChild.once('exit', () => {
        if (child === processChild) { child = null; endpoint = null; if (generation === token && sameSession(ctx)) { report(ctx, 'report server disconnected; offline export retained'); links(ctx) } }
      })
    } catch {
      processChild.kill('SIGTERM')
      if (child === processChild) { child = null; endpoint = null }
      if (generation === token && sameSession(ctx)) report(ctx, 'report server unavailable; offline export retained')
    }
  }
  function serialized<T>(action: () => Promise<T> | T): Promise<T> {
    const result = queue.then(action)
    queue = result.catch(() => {})
    return result
  }
  async function restore(ctx: Context) {
    const token = ++generation
    context = ctx; active = null; writable = false; checkpointId = null
    unreconciled.clear()
    await stopServer()
    if (generation !== token) return
    ctx.ui.setStatus(STATUS, undefined)
    const entry = branch(ctx).reverse().find(entry => entry.type === 'custom' && entry.customType === ENTRY)
    if (!entry) return
    try {
      const saved = entry.data as Checkpoint
      exact(saved, ['version', 'snapshot', 'names', 'bindings'])
      if (saved.version !== 1 || !saved.names || !Array.isArray(saved.bindings)) fail('invalid checkpoint')
      const snapshot = validateGraphSnapshot(saved.snapshot)
      if (snapshot.parentSessionId !== ctx.sessionManager.getSessionId()) { report(ctx, 'inherited run belongs to another parent; original report is unchanged'); return }
      validateCheckpointMetadata(snapshot, saved.names, saved.bindings)
      active = structuredClone({ ...saved, snapshot })
      if (typeof entry.id !== 'string') fail('missing checkpoint entry identity')
      checkpointId = entry.id
      const persisted = store().read()
      if (!persisted || persisted.revision !== snapshot.revision || JSON.stringify(persisted) !== JSON.stringify(snapshot)) { report(ctx, 'branch checkpoint differs from persisted run; reporting is read-only'); links(ctx); return }
      writable = true
      for (const binding of saved.bindings) if (snapshot.nodes.some(node => node.id === binding.nodeId && node.currentAttempt)) unreconciled.add(binding.nodeId)
      const pending = structuredClone(snapshot)
      pending.reporting = { recovery: unreconciled.size ? 'pending' : 'ready' }
      commit(pending, ctx, token)
      links(ctx)
      // Recovery never reads native storage, binds new identities, or calls tools
      // from a lifecycle context. The recover tool performs direct status reads.
    } catch (error) {
      active = null; writable = false
      const reason = error instanceof Error ? error.message : String(error)
      report(ctx, `checkpoint recovery failed: ${reason}; reporting is read-only`)
    }
  }
  async function execute(input: DashboardInput, ctx: Context) {
    const token = generation
    return serialized(async () => {
      if (!context) context = ctx
      if (!sameSession(ctx)) fail('context must be restored before session-bound reporting')
      const fields: Record<string, [string[], string[]]> = {
        create: [['operation', 'runName', 'command', 'currentStage', 'topology', 'nodes', 'edges'], []],
        declare: [['operation', 'runId', 'nodes', 'edges'], []], bind: [['operation', 'runId', 'launchToolCallId', 'nodeIds'], []],
        update: [['operation', 'runId'], ['currentStage', 'topology', 'status', 'workspace', 'nodes']], recover: [['operation', 'runId'], []], show: [['operation', 'runId'], []],
      }
      if (!input || !Object.hasOwn(fields, input.operation)) fail('unknown operation')
      exact(input, ...fields[input.operation])
      if (input.operation === 'create') {
        if (!ctx.sessionManager.getSessionFile()) fail('persistent parent session required')
        if (active?.snapshot.status === 'active') fail('active run already exists')
        const names: Record<string, string> = Object.create(null)
        const topology = commandTopology(input.command, input.nodes, input.edges)
        const now = new Date().toISOString()
        const snapshot = validateGraphSnapshot({ schemaVersion: 1, runId: randomUUID(), parentSessionId: ctx.sessionManager.getSessionId(), revision: 1,
          runName: input.runName, command: input.command, currentStage: input.currentStage, status: 'active', topology: input.topology, updatedAt: now,
          reporting: { recovery: 'ready' }, timestamps: { observerHeartbeatAt: now, lastSourceObservationAt: null, lastWorkerActivityAt: null, lastHtmlRenderAt: null }, nodes: declarations(topology.nodes, names), edges: topology.edges })
        if (ctx.cwd) {
          try {
            const git = (args: string[]) => execFileSync('git', ['-C', ctx.cwd!, ...args], { encoding: 'utf8', timeout: 2000, maxBuffer: 4096, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
            const worktree = git(['rev-parse', '--show-toplevel'])
            let branch: string | null = null
            try { branch = git(['symbolic-ref', '--quiet', '--short', 'HEAD']) } catch { git(['rev-parse', '--verify', 'HEAD']) }
            snapshot.workspace = { worktree, branch }
            validateGraphSnapshot(snapshot)
          } catch { delete snapshot.workspace; report(ctx, 'Git workspace unavailable; branch and worktree are not recorded') }
        }
        currentCreation(ctx, token)
        // Account for the initial commit and recorded export time before any
        // new run can replace the old owner or publish links.
        renderHtml({ ...snapshot, revision: snapshot.revision + 2, timestamps: { ...snapshot.timestamps, lastHtmlRenderAt: now } })
        mkdirSync(options.directory, { recursive: true, mode: 0o700 })
        const persisted = createGraphDashboardStore({ directory: options.directory, runId: snapshot.runId, parentSessionId: snapshot.parentSessionId }).write(snapshot)
        exportHtml(persisted)
        // Publish the new checkpoint before replacing the prior owner. If the
        // append fails, its owner, recovery tracking, and server stay intact.
        const nextOwner: Checkpoint = { version: 1, snapshot: persisted, names: { ...names }, bindings: [] }
        currentCreation(ctx, token)
        options.appendEntry(ENTRY, structuredClone(nextOwner))
        currentCreation(ctx, token)
        active = nextOwner; writable = true
        checkpointId = ctx.sessionManager.getLeafId()
        unreconciled.clear()
        await stopServer(); current(ctx, token)
        // Initial creation has no prior revision for commit's ownership check.
        commit(structuredClone(snapshot), ctx, token)
        await startServer(ctx, token)
        current(ctx, token)
        return links(ctx)
      }
      current(ctx, token)
      if (active!.snapshot.runId !== input.runId) fail('foreign run identity')
      if (input.operation === 'show') { await startServer(ctx, token); current(ctx, token); return links(ctx) }
      owned(ctx)
      const next = structuredClone(active!.snapshot)
      if (input.operation === 'declare') {
        const names = { ...active!.names }
        const added = declarations(input.nodes, names, next.nodes)
        for (const node of added) for (const old of next.nodes) if (old.logicalId === node.logicalId) old.currentAttempt = false
        next.nodes.push(...added); next.edges.push(...input.edges)
        workerPrerequisites(next.command, next.nodes, next.edges)
        validateGraphSnapshot(next)
        const recovery = new Set([...unreconciled].filter(id => next.nodes.some(node => node.id === id && node.currentAttempt)))
        commit(next, ctx, token, recovery, { names, bindings: active!.bindings })
      } else if (input.operation === 'bind') {
        if (!Array.isArray(input.nodeIds) || !input.nodeIds.length || new Set(input.nodeIds).size !== input.nodeIds.length) fail('invalid binding selection')
        const ownership = ownedLaunch(input.launchToolCallId, ctx)
        if (!ownership) fail('launch does not belong to this parent and run')
        let receipt = ownership.receipt
        if (!receipt) {
          const matches = branch(ctx).filter(entry => entry.type === 'message').map(entry => record(entry.message)).filter(message => message.role === 'toolResult' && message.toolCallId === input.launchToolCallId)
          if (matches.length !== 1 || matches[0].isError || matches[0].toolName !== ownership.toolName) fail('exact owned launch receipt unavailable')
          receipt = nativeReceipt(matches[0])
        }
        if (!matchesLaunch(ownership, receipt)) fail('launch receipt does not match owned allocation')
        const bindings = [...active!.bindings]
        for (const id of input.nodeIds) {
          const node = next.nodes.find(node => node.id === id)
          if (!node || node.kind !== 'worker' || !node.currentAttempt) fail('invalid worker')
          const agent = receipt.agents.find(agent => agent.name === active!.names[id])
          const previous = bindings.find(binding => binding.nodeId === id)
          if (previous && agent && previous.nativeId === agent.id && previous.name === agent.name && previous.launchToolCallId === input.launchToolCallId && node.nativeId === agent.id) continue
          if (node.nativeId || previous) fail('invalid or already bound worker')
          if (!agent || bindings.some(binding => binding.nativeId === agent.id)) fail('missing or reused launch identity')
          node.nativeId = agent.id
          bindings.push({ nodeId: id, name: agent.name, nativeId: agent.id, launchToolCallId: input.launchToolCallId })
          apply(node, agent, receipt.at, next)
        }
        // Launch provenance remains mandatory. Replay supported public receipts
        // and saved observations for exact newly allocated IDs on this branch.
        // apply() rejects observations older than the owned launch/current state.
        for (const entry of branch(ctx)) {
          let observation: Receipt | null = null
          try {
            if (entry.type === 'message') observation = nativeObservation(entry.message)
            else if (entry.type === 'custom' && entry.customType === OBSERVATION_ENTRY) {
              const saved = record(entry.data)
              exact(saved, ['version', 'parentSessionId', 'runId', 'launchToolCallId', 'receipt'])
              if (saved.version !== 1 || saved.parentSessionId !== active!.snapshot.parentSessionId || saved.runId !== input.runId || saved.launchToolCallId !== input.launchToolCallId) continue
              observation = savedNativeReceipt(saved.receipt)
            }
          } catch { continue }
          if (!observation) continue
          for (const binding of bindings) {
            if (!input.nodeIds.includes(binding.nodeId)) continue
            const agent = observation.agents.find(agent => agent.id === binding.nativeId && agent.name === binding.name)
            if (agent) apply(next.nodes.find(node => node.id === binding.nodeId)!, agent, observation.at, next)
          }
        }
        commit(next, ctx, token, undefined, { names: active!.names, bindings })
      } else if (input.operation === 'update') {
        if (input.workspace !== undefined) next.workspace = input.workspace
        if (input.currentStage !== undefined) next.currentStage = input.currentStage
        if (input.topology !== undefined) next.topology = input.topology
        if (input.status !== undefined) next.status = input.status
        const seen = new Set<string>()
        for (const change of input.nodes ?? []) {
          exact(change, ['id'], ['execution', 'verification', 'gate', 'blocker', 'wait', 'evidence'])
          const node = next.nodes.find(node => node.id === change.id)
          if (!node || !node.currentAttempt || seen.has(change.id)) fail('invalid parent update target')
          seen.add(change.id)
          if (change.execution !== undefined) { if (node.kind === 'worker') fail('worker execution requires native observation'); node.execution.state = change.execution }
          if (change.verification !== undefined) node.verification = change.verification
          if (change.gate !== undefined) node.gate = change.gate
          if (change.blocker !== undefined) node.blocker = change.blocker
          if (change.wait !== undefined) node.wait = change.wait
          if (change.evidence !== undefined) node.evidence = change.evidence
        }
        commit(next, ctx, token)
      } else if (input.operation === 'recover') {
        if (!ctx.executeTool) fail('direct native status requires tool execution context')
        const previousAggregate = next.timestamps.lastSourceObservationAt
        const recovery = new Set(unreconciled)
        for (const binding of active!.bindings) {
          const node = next.nodes.find(node => node.id === binding.nodeId)!
          if (!node.currentAttempt) continue
          recovery.add(binding.nodeId)
          try {
            recoveringStatusGeneration = token
            let outcome: unknown
            try { outcome = await ctx.executeTool('agent_status', { name: binding.name }) }
            finally { if (recoveringStatusGeneration === token) recoveringStatusGeneration = null }
            current(ctx, token); owned(ctx)
            const execution = record(outcome)
            if (execution.isError !== false) fail('status failed')
            const receipt = nativeReceipt(execution.result)
            const agent = receipt.agents.find(agent => agent.id === binding.nativeId && agent.name === binding.name)
            if (!agent) fail('status identity mismatch')
            apply(node, agent, receipt.at, next); recovery.delete(binding.nodeId)
          } catch {
            current(ctx, token); owned(ctx)
            report(ctx, `native status reconciliation failed for ${node.id}; last observation retained`)
          }
        }
        if (recovery.size) next.timestamps.lastSourceObservationAt = previousAggregate
        next.reporting = { recovery: recovery.size ? 'partial-failure' : 'ready' }
        commit(next, ctx, token, recovery)
        await startServer(ctx, token); current(ctx, token)
      }
      return links(ctx)
    })
  }
  function currentCreation(ctx: Context, token: number) { if (generation !== token || !sameSession(ctx)) fail('session changed; creation discarded') }
  function apply(node: GraphNode, agent: NativeAgent, at: number, snapshot: GraphSnapshot) {
    const observedAt = new Date(at).toISOString()
    if (node.execution.observedAt && observedAt < node.execution.observedAt) return
    const changed = node.execution.state !== agent.state
    node.execution = { state: agent.state, observedAt }
    if (!snapshot.timestamps.lastSourceObservationAt || observedAt > snapshot.timestamps.lastSourceObservationAt) snapshot.timestamps.lastSourceObservationAt = observedAt
    if (changed && (!snapshot.timestamps.lastWorkerActivityAt || observedAt > snapshot.timestamps.lastWorkerActivityAt)) snapshot.timestamps.lastWorkerActivityAt = observedAt
  }
  async function observe(input: unknown, ctx: Context, bindLaunch = false) {
    // Nested status events are awaited by Pi. Recovery consumes that direct
    // receipt itself; enqueueing its events behind recovery would deadlock,
    // even when restore replaces the generation before the call returns.
    if (recoveringStatusGeneration !== null && typeof input === 'object' && input !== null) {
      const source = 'type' in input && input.type === 'message_end' && 'message' in input ? input.message : input
      if (typeof source === 'object' && source !== null && 'toolName' in source && source.toolName === 'agent_status') return
    }
    const token = generation
    await serialized(() => {
      try {
        if (!active || !writable || !sameSession(ctx)) return
        const event = record(input)
        let receipt: Receipt | null = null
        if (event.type === 'message_end') {
          receipt = nativeObservation(event)
          if (!receipt) return
        } else {
          if (typeof event.toolName !== 'string' || !nativeTools.has(event.toolName) || typeof event.toolCallId !== 'string') return
          current(ctx, token); owned(ctx)
          if (event.type === 'tool_execution_start') {
            if (['agent_spawn', 'agent_spawn_graph'].includes(event.toolName)) {
              const args = record(event.args)
              const names = event.toolName === 'agent_spawn' ? [args.name] : Array.isArray(args.agents) ? args.agents.map(value => record(value).name) : []
              if (names.length && names.length <= 12 && names.every((name): name is string => typeof name === 'string' && Object.values(active!.names).includes(name)) && new Set(names).size === names.length && !ownedLaunch(event.toolCallId, ctx)) {
                recordLaunch({ version: 1, parentSessionId: active.snapshot.parentSessionId, runId: active.snapshot.runId, toolCallId: event.toolCallId, toolName: event.toolName, names }, ctx, token)
              }
            }
            return
          }
          receipt = nativeObservation(event)
          if (!receipt) return
          if (['agent_spawn', 'agent_spawn_graph'].includes(event.toolName)) {
            const launch = ownedLaunch(event.toolCallId, ctx)
            if (launch?.toolName === event.toolName && matchesLaunch(launch, receipt) && (!launch.receipt || event.type === 'tool_execution_end')) recordLaunch({ ...launch, receipt }, ctx, token)
          }
        }
        current(ctx, token); owned(ctx)
        // Launch receipts already persist through recordLaunch. Other nested
        // completions need retention because no transcript result is guaranteed.
        if (event.type === 'tool_execution_update' || (event.type === 'tool_execution_end' && typeof event.parentToolCallId === 'string' && event.toolName !== 'agent_spawn' && event.toolName !== 'agent_spawn_graph')) recordUnboundObservation(receipt, ctx, token)
        const next = structuredClone(active!.snapshot)
        const previousAggregate = next.timestamps.lastSourceObservationAt
        let changed = false
        for (const binding of active!.bindings) {
          if (unreconciled.has(binding.nodeId)) continue
          const node = next.nodes.find(node => node.id === binding.nodeId)
          const agent = receipt.agents.find(agent => agent.id === binding.nativeId && agent.name === binding.name)
          if (!node?.currentAttempt || !agent || (node.execution.observedAt && new Date(receipt.at).toISOString() < node.execution.observedAt)) continue
          apply(node, agent, receipt.at, next); changed = true
        }
        if (unreconciled.size) next.timestamps.lastSourceObservationAt = previousAggregate
        if (changed) commit(next, ctx, token)
      } catch { if (generation === token && sameSession(ctx)) report(ctx, 'native observation could not be recorded; execution and gates are unchanged') }
    })
    // The adapter binds only complete receipts whose launch this run recorded.
    // Queue binding after observation; nesting execute inside it would deadlock.
    if (bindLaunch) try {
      const event = record(input)
      if (event.type !== 'tool_execution_end' || event.isError || !['agent_spawn', 'agent_spawn_graph'].includes(String(event.toolName)) || typeof event.toolCallId !== 'string' || !active || !writable) return
      current(ctx, token); owned(ctx)
      const launch = ownedLaunch(event.toolCallId, ctx)
      const receipt = nativeObservation(event)
      if (!launch?.receipt || !receipt || launch.toolName !== event.toolName || !matchesLaunch(launch, receipt)) return
      const nodeIds = active.snapshot.nodes.filter(node => node.kind === 'worker' && node.currentAttempt && !node.nativeId && launch.names.includes(active!.names[node.id])).map(node => node.id)
      if (nodeIds.length) await execute({ operation: 'bind', runId: active.snapshot.runId, launchToolCallId: event.toolCallId, nodeIds }, ctx)
    } catch { if (generation === token && sameSession(ctx)) report(ctx, 'automatic launch binding failed; use the exact owned launch receipt to repair reporting') }
  }
  async function close() {
    generation++; writable = false
    const previous = context
    context = null; active = null; unreconciled.clear()
    previous?.ui.setStatus(STATUS, undefined)
    await stopServer()
  }
  return { execute, observe, restore, close }
}
