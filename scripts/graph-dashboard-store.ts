import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmdirSync, unlinkSync, writeFileSync, type Stats } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'

export type ExecutionState = 'planned' | 'queued' | 'waiting' | 'running' | 'answered' | 'failed' | 'skipped' | 'cancelled' | 'interrupted' | 'unknown'
export type VerificationState = 'unverified' | 'pending' | 'verified' | 'failed' | 'unknown'
export type GateState = 'waiting' | 'awaiting-approval' | 'cleared' | 'blocked'
export type EdgeType = 'native-after' | 'parent-gate' | 'verification'
export type RunStatus = 'active' | 'succeeded' | 'partial-failure' | 'cancelled' | 'interrupted'
export interface GraphCondition {
  reason: string
  sourceNodeId: string | null
  externalRequirement: string | null
  clearingCondition: string
}
// References are identifiers, not URLs or filesystem paths. This slice grants no link authority.
export interface GraphEvidence { label: string; reference: string }
export interface GraphNode {
  id: string
  logicalId: string
  label: string
  role: string
  stage: string
  kind: 'worker' | 'parent' | 'gate'
  attempt: number
  currentAttempt: boolean
  nativeId: string | null
  execution: { state: ExecutionState; observedAt: string | null }
  verification: { state: VerificationState; reason: string | null }
  gate: { state: GateState; clearingCondition: string } | null
  blocker: GraphCondition | null
  wait: GraphCondition | null
  evidence: GraphEvidence[]
}
export interface GraphEdge { from: string; to: string; type: EdgeType }
export interface GraphSnapshot {
  schemaVersion: 1
  runId: string
  parentSessionId: string
  revision: number
  runName: string
  command: '/df-implement-tickets' | '/gitlab-address-pr-agent-review'
  currentStage: string
  status: RunStatus
  topology: 'declared' | 'unknown-future'
  updatedAt: string
  // Optional for snapshots created before reporting recovery metadata exists.
  reporting?: { recovery: 'ready' | 'pending' | 'partial-failure' }
  workspace?: { branch: string | null; worktree: string }
  timestamps: {
    observerHeartbeatAt: string | null
    lastSourceObservationAt: string | null
    lastWorkerActivityAt: string | null
    lastHtmlRenderAt: string | null
  }
  nodes: GraphNode[]
  edges: GraphEdge[]
}
export interface GraphDashboardStoreOptions { directory: string; runId: string; parentSessionId: string }
export interface GraphDashboardStore {
  readonly runId: string
  readonly parentSessionId: string
  read(): GraphSnapshot | null
  write(input: unknown): GraphSnapshot
}
export const GRAPH_DASHBOARD_LIMITS = Object.freeze({ bytes: 1_048_576, nodes: 512, edges: 4096, text: 512, evidencePerNode: 16 })

function fail(message: string): never { throw new Error(`Graph dashboard: ${message}`) }
function object(value: unknown, keys: string[], optional: string[] = []): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail('expected plain object')
  const actual = Object.keys(value)
  if (keys.some(key => !actual.includes(key)) || actual.some(key => !keys.includes(key) && !optional.includes(key))) fail('unexpected or missing field')
}
function text(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > GRAPH_DASHBOARD_LIMITS.text || /[\u0000-\u001f\u007f]/.test(value)) fail('invalid text')
}
function id(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(value)) fail('invalid identifier')
}
function nullableText(value: unknown) { if (value !== null) text(value) }
function timestamp(value: unknown, nullable = true) {
  if (value === null && nullable) return
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail('invalid timestamp')
}
function choice(value: unknown, values: readonly string[]) { if (typeof value !== 'string' || !values.includes(value)) fail('invalid state') }
function integer(value: unknown) { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) fail('invalid positive integer') }
function list(value: unknown, limit: number): asserts value is unknown[] { if (!Array.isArray(value) || value.length > limit) fail('invalid or excessive list') }
function condition(value: unknown, nodeIds: Set<string>) {
  if (value === null) return
  object(value, ['reason', 'sourceNodeId', 'externalRequirement', 'clearingCondition'])
  text(value.reason); text(value.clearingCondition); nullableText(value.externalRequirement)
  if (value.sourceNodeId !== null) {
    id(value.sourceNodeId)
    if (!nodeIds.has(value.sourceNodeId)) fail('unknown condition source')
  }
}

/** Validate external input. Extra fields are rejected at every boundary. No state is inferred. */
export function validateGraphSnapshot(input: unknown): GraphSnapshot {
  object(input, ['schemaVersion', 'runId', 'parentSessionId', 'revision', 'runName', 'command', 'currentStage', 'status', 'topology', 'updatedAt', 'timestamps', 'nodes', 'edges'], ['reporting', 'workspace'])
  if (Object.hasOwn(input, 'workspace')) {
    object(input.workspace, ['branch', 'worktree'])
    nullableText(input.workspace.branch); text(input.workspace.worktree)
    if (!isAbsolute(input.workspace.worktree as string)) fail('worktree must be absolute')
  }
  if (Object.hasOwn(input, 'reporting')) {
    object(input.reporting, ['recovery'])
    choice(input.reporting.recovery, ['ready', 'pending', 'partial-failure'])
  }
  if (input.schemaVersion !== 1) fail('unsupported schema')
  id(input.runId); id(input.parentSessionId); integer(input.revision); text(input.runName); text(input.currentStage)
  choice(input.command, ['/df-implement-tickets', '/gitlab-address-pr-agent-review'])
  choice(input.status, ['active', 'succeeded', 'partial-failure', 'cancelled', 'interrupted'])
  choice(input.topology, ['declared', 'unknown-future']); timestamp(input.updatedAt, false)
  object(input.timestamps, ['observerHeartbeatAt', 'lastSourceObservationAt', 'lastWorkerActivityAt', 'lastHtmlRenderAt'])
  for (const value of Object.values(input.timestamps)) timestamp(value)
  list(input.nodes, GRAPH_DASHBOARD_LIMITS.nodes); list(input.edges, GRAPH_DASHBOARD_LIMITS.edges)
  const nodeIds = new Set<string>()
  const groups = new Map<string, { attempts: Set<number>; latest: number; current: number[]; kind: unknown }>()
  for (const node of input.nodes) {
    object(node, ['id', 'logicalId', 'label', 'role', 'stage', 'kind', 'attempt', 'currentAttempt', 'nativeId', 'execution', 'verification', 'gate', 'blocker', 'wait', 'evidence'])
    id(node.id); id(node.logicalId); text(node.label); text(node.role); text(node.stage)
    choice(node.kind, ['worker', 'parent', 'gate']); integer(node.attempt)
    if (typeof node.currentAttempt !== 'boolean') fail('invalid current attempt')
    if (node.nativeId !== null) id(node.nativeId)
    if (nodeIds.has(node.id)) fail('duplicate node')
    nodeIds.add(node.id)
    const group = groups.get(node.logicalId) ?? { attempts: new Set<number>(), latest: 0, current: [], kind: node.kind }
    if (group.attempts.has(node.attempt as number) || group.kind !== node.kind) fail('duplicate or conflicting attempt')
    group.attempts.add(node.attempt as number)
    group.latest = Math.max(group.latest, node.attempt as number)
    if (node.currentAttempt) group.current.push(node.attempt as number)
    groups.set(node.logicalId, group)
    object(node.execution, ['state', 'observedAt'])
    choice(node.execution.state, ['planned', 'queued', 'waiting', 'running', 'answered', 'failed', 'skipped', 'cancelled', 'interrupted', 'unknown'])
    timestamp(node.execution.observedAt)
    object(node.verification, ['state', 'reason'])
    choice(node.verification.state, ['unverified', 'pending', 'verified', 'failed', 'unknown']); nullableText(node.verification.reason)
    if (node.gate !== null) {
      object(node.gate, ['state', 'clearingCondition'])
      choice(node.gate.state, ['waiting', 'awaiting-approval', 'cleared', 'blocked']); text(node.gate.clearingCondition)
    }
    if ((node.kind === 'gate') !== (node.gate !== null)) fail('gate state requires a gate node')
    list(node.evidence, GRAPH_DASHBOARD_LIMITS.evidencePerNode)
    for (const evidence of node.evidence) { object(evidence, ['label', 'reference']); text(evidence.label); id(evidence.reference) }
  }
  for (const group of groups.values()) if (group.current.length !== 1 || group.current[0] !== group.latest) fail('current attempt must be the latest attempt')
  for (const node of input.nodes as unknown as GraphNode[]) { condition(node.blocker, nodeIds); condition(node.wait, nodeIds) }
  const edgeIds = new Set<string>()
  const outgoing = new Map<string, string[]>()
  const degree = new Map([...nodeIds].map(key => [key, 0]))
  for (const edge of input.edges) {
    object(edge, ['from', 'to', 'type']); id(edge.from); id(edge.to)
    choice(edge.type, ['native-after', 'parent-gate', 'verification'])
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) fail('unknown edge node')
    const key = `${edge.from}:${edge.to}:${edge.type}`
    if (edgeIds.has(key)) fail('duplicate edge')
    edgeIds.add(key)
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to])
    degree.set(edge.to, degree.get(edge.to)! + 1)
  }
  const ready = [...degree].filter(([, count]) => count === 0).map(([key]) => key)
  let visited = 0
  for (let i = 0; i < ready.length; i++) {
    visited++
    for (const next of outgoing.get(ready[i]) ?? []) {
      degree.set(next, degree.get(next)! - 1)
      if (degree.get(next) === 0) ready.push(next)
    }
  }
  if (visited !== nodeIds.size) fail('dependency cycle')
  const serialized = JSON.stringify(input)
  if (Buffer.byteLength(serialized) > GRAPH_DASHBOARD_LIMITS.bytes) fail('snapshot too large')
  return JSON.parse(serialized) as GraphSnapshot
}

function retained(previous: GraphSnapshot, next: GraphSnapshot) {
  if (next.revision <= previous.revision) fail('stale revision')
  const nodes = new Map(next.nodes.map(node => [node.id, node]))
  for (const old of previous.nodes) {
    const node = nodes.get(old.id)
    if (!node) fail('declared node removed')
    for (const key of ['logicalId', 'attempt', 'kind', 'stage', 'role', 'label'] as const) if (node[key] !== old[key]) fail('node declaration changed')
    if (old.nativeId !== null && old.nativeId !== node.nativeId) fail('native identity changed')
    // Completed historical attempts are immutable. Only the former current flag may change.
    if ((!old.currentAttempt || !node.currentAttempt) && !isDeepStrictEqual({ ...old, currentAttempt: false }, { ...node, currentAttempt: false })) fail('earlier attempt changed')
  }
  const edges = new Set(next.edges.map(edge => `${edge.from}:${edge.to}:${edge.type}`))
  for (const edge of previous.edges) if (!edges.has(`${edge.from}:${edge.to}:${edge.type}`)) fail('declared edge removed')
  for (const key of ['updatedAt'] as const) if (next[key] < previous[key]) fail('timestamp moved backward')
  for (const key of Object.keys(previous.timestamps) as (keyof GraphSnapshot['timestamps'])[]) {
    const old = previous.timestamps[key], value = next.timestamps[key]
    if (old !== null && (value === null || value < old)) fail('observation timestamp moved backward')
  }
}
function privateStat(stat: Stats, directory: boolean) {
  // An open reader can hold the previous inode after atomic replacement (nlink = 0).
  if ((directory ? !stat.isDirectory() : !stat.isFile()) || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== (directory ? 0o700 : 0o600) || (!directory && stat.nlink > 1)) fail('unsafe artifact ownership or permissions')
}
function absent(error: unknown): boolean { return (error as NodeJS.ErrnoException)?.code === 'ENOENT' }

/** One run per handle. A shared directory can contain multiple explicitly identified runs. */
export function createGraphDashboardStore(options: GraphDashboardStoreOptions): GraphDashboardStore {
  id(options.runId); id(options.parentSessionId)
  if (!isAbsolute(options.directory)) fail('directory must be absolute')
  const { directory, runId, parentSessionId } = options
  // Require the containing directory to exist. Never create or modify unrelated parent paths.
  try { mkdirSync(directory, { mode: 0o700 }) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  const checkDirectory = () => privateStat(lstatSync(directory), true)
  checkDirectory()
  const path = join(directory, `${runId}.json`)
  function owned(snapshot: GraphSnapshot) {
    if (snapshot.runId !== runId || snapshot.parentSessionId !== parentSessionId) fail('foreign run or parent session')
  }
  function read(): GraphSnapshot | null {
    checkDirectory()
    let fd: number
    try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK) } catch (error) { if (absent(error)) return null; throw error }
    try {
      const stat = fstatSync(fd)
      privateStat(stat, false)
      if (stat.size > GRAPH_DASHBOARD_LIMITS.bytes) fail('snapshot too large')
      const snapshot = validateGraphSnapshot(JSON.parse(readFileSync(fd, 'utf8')))
      owned(snapshot)
      return snapshot
    } finally { closeSync(fd) }
  }
  function write(input: unknown): GraphSnapshot {
    const snapshot = validateGraphSnapshot(input)
    owned(snapshot); checkDirectory()
    const lock = join(directory, `${runId}.lock`)
    // Exclusive local writer lock: concurrent handles cannot both accept the same revision.
    try { mkdirSync(lock, { mode: 0o700 }) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') fail('writer lock exists; reconcile before recovery'); throw error }
    let temporary: string | null = null
    try {
      const previous = read()
      if (previous) {
        if (previous.command !== snapshot.command) fail('command changed')
        retained(previous, snapshot)
      }
      temporary = join(directory, `.${runId}.${randomUUID()}.tmp`)
      const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
      try { writeFileSync(fd, JSON.stringify(snapshot)); fsyncSync(fd) } finally { closeSync(fd) }
      renameSync(temporary, path)
      temporary = null
      const directoryFd = openSync(directory, constants.O_RDONLY | constants.O_NOFOLLOW)
      try { fsyncSync(directoryFd) } finally { closeSync(directoryFd) }
      return snapshot
    } finally {
      if (temporary !== null) unlinkSync(temporary)
      rmdirSync(lock)
    }
  }
  return Object.freeze({ runId, parentSessionId, read, write })
}
