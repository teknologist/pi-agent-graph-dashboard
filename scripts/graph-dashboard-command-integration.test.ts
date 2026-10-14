import { expect, test } from 'bun:test'
import { existsSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createGraphDashboardRuntime, type DashboardContext, type DashboardInput } from './graph-dashboard-runtime'
import { createGraphDashboardStore, type GraphSnapshot } from './graph-dashboard-store'
import { attemptsRemaining } from './df-ticket-hub.mjs'

// Primary owner: command-specific reporting mappings, not the native adapter.
// The fixtures supply independent business outcomes and synthetic public data.
// Production owns receipt binding, checkpoint publication, persistence, and HTTP.
interface Allocation { nodeId: string; name: string; nativeId: string }
interface Binding extends Allocation { launchToolCallId: string }
interface ExpectedNode {
  execution?: string; verification?: string; nativeId?: string | null
  gate?: string; wait?: string; kind?: string; attempt?: number; currentAttempt?: boolean
}
interface Expected {
  status?: GraphSnapshot['status']; recovery?: NonNullable<GraphSnapshot['reporting']>['recovery']; workerCount?: number
  nodes?: Record<string, ExpectedNode>; unchanged?: boolean; preserveSource?: boolean
}
type Step =
  | { action: 'report'; input: DashboardInput; expect: Expected }
  | { action: 'launch'; callId: string; agents: Allocation[]; earlyCompletion: boolean; expect: Expected }
  | { action: 'observe'; tool: string; agents: Allocation[]; state: string; expect: Expected }
  | { action: 'result'; agents: { name: string; nativeId: string; kind: string }[]; expect: Expected }
  | { action: 'recover'; rejectNames: string[]; expect: Expected }
  | { action: 'restart' | 'wait-error' | 'export-failure' | 'links'; expect: Expected }
interface Fixture {
  version: 1; synthetic: true; key: string; command: GraphSnapshot['command']; prompt: string
  stages: string[]; create: Extract<DashboardInput, { operation: 'create' }>
  steps: Step[]; cancellation: { afterStep: number; steps: Step[] }
}
const fixtures = ['graph-dashboard-df-tickets.json', 'graph-dashboard-mr-review.json'].map(name =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as Fixture)
const promptDirectory = fileURLToPath(new URL('../prompts/', import.meta.url))
const extensionSource = new URL('../private_extensions/agent-graph-dashboard.ts', import.meta.url)
const extensionPath = existsSync(extensionSource) ? extensionSource : new URL('../extensions/agent-graph-dashboard.ts', import.meta.url)
for (const fixture of fixtures) {
  if (!existsSync(join(promptDirectory, fixture.prompt))) fixture.prompt = fixture.prompt.replace(/^private_/, '')
}

// This static cross-source instruction guard is not proof of agent obedience.
// The module scenarios below supply the separate delayed-binding evidence.
test('extension guideline preserves supported waits, automatic binding, and exact fallback', () => {
  const extension = readFileSync(extensionPath, 'utf8')
  const guidelines = extension.split('promptGuidelines: [')[1]?.split('],')[0]
  expect(guidelines).toBeDefined()
  for (const fixture of fixtures) {
    const prompt = readFileSync(join(promptDirectory, fixture.prompt), 'utf8')
    expect(prompt).toMatch(/supported wait settings/)
    expect(prompt).toMatch(/automatically binds complete exact owned launch receipts after launch completion/)
    expect(prompt).toMatch(/If automatic binding fails, call\s+`bind`/)
  }
  expect(guidelines, 'Extension must not override supported command waits').not.toMatch(/without waiting|require[^.]*nonblocking|omit[^.]*wait/i)
  expect(guidelines).toMatch(/preserve[^.]*wait settings/i)
  expect(guidelines).toMatch(/automatically binds complete exact owned launch receipts/i)
  expect(guidelines).toMatch(/If binding fails, use bind with the exact launchToolCallId/i)
})

test('df pure helper keeps evidence corrections and issue-role budgets independent', () => {
  const first = { event: 'attempt', issueId: 'A', role: 'Implement', attempt: 1, workerName: 'df-A-implement-r1' }
  const correction = { event: 'agent_activity', issueId: 'A', role: 'Implement', message: 'Output-format correction within attempt 1' }
  const events = [first, correction]
  expect(attemptsRemaining(events, 'A', 'Implement')).toBe(2)
  events.push({ ...first, attempt: 2 })
  expect(attemptsRemaining(events, 'A', 'Implement')).toBe(1)
  expect(attemptsRemaining(events, 'A', 'Review')).toBe(3)
  expect(attemptsRemaining(events, 'A', 'CriteriaRepair')).toBe(2)
  expect(attemptsRemaining(events, 'B', 'Implement')).toBe(3)
  expect(attemptsRemaining(events, undefined, 'Inventory')).toBe(2)
  expect(attemptsRemaining(JSON.parse(JSON.stringify(events)), 'A', 'Implement')).toBe(1)
  expect(attemptsRemaining([...events, { ...first, attempt: 3 }], 'A', 'Implement')).toBe(0)
})

for (const fixture of fixtures) {
  test(`${fixture.key}: static reporting contract is present (not command execution)`, () => {
    const prompt = readFileSync(join(promptDirectory, fixture.prompt), 'utf8')
    // Inspect the reporting section only. Ordinary workflow words elsewhere
    // must not satisfy a missing reporting instruction. Heading wording is free.
    const section = prompt.split(/^##\s+/m).find(part => part.includes('agent_graph_dashboard'))
    expect(section, 'Missing parent reporting tool instructions').toBeDefined()
    expect(section).toContain('/agent-graph-dashboard')
    for (const operation of ['create', 'declare', 'bind', 'update', 'recover', 'show']) {
      expect(section).toMatch(new RegExp(`\\b${operation}\\b`, 'i'))
    }
    for (const rule of [/parent/i, /verif/i, /approval/i, /block/i, /attempt|retry/i, /cancel/i,
      /same.worker/i, /native\s+identity|nativeId/i, /unknown.future/i, /launchToolCallId/i,
      /loopback|reportUrl/i, /fileUrl|offline.*link/i, /exportPath|absolute.*path/i, /final/i]) {
      expect(section).toMatch(rule)
    }
  })

  test(`${fixture.key}: static authority and supported native settings remain intact`, () => {
    const prompt = readFileSync(join(promptDirectory, fixture.prompt), 'utf8')
    expect(prompt).not.toMatch(/\bAddy\b/i)
    expect(prompt).not.toMatch(/\bwait\s*:\s*0\b/)
    expect(prompt).not.toMatch(/\bafter\s*:\s*\[\s*[^\s\]]/)
    if (fixture.command === '/gitlab-address-pr-agent-review') {
      const safety = prompt.split(/^## Safety rules\s*$/m)[1]?.split(/^## /m)[0] ?? ''
      const prohibitions = [...safety.matchAll(/(?:Do not|Never)\s+([^.!]+)[.!]/gi)].map(match => match[1])
      expect(prohibitions.some(sentence => ['approve', 'merge', 'close'].every(word =>
        new RegExp(`\\b${word}\\b`, 'i').test(sentence)))).toBe(true)
      // Delivery is parent-only and never forced.
      expect(safety).toMatch(/parent to always commit and push verified changes/)
      expect(safety).toMatch(/workers have no Git write authority/i)
      expect(prompt).toMatch(/never autostash unrelated user changes, reset, or force-push/)
      expect(prompt).toMatch(/\bwait\s*:\s*30\b/)
      expect(prompt).toMatch(/tools:\s*\["read",\s*"grep",\s*"find",\s*"ls"\]/)
      expect(prompt).toMatch(/delegate:\s*false/)
      expect(safety).toMatch(/(?:Do not|Never)[^.!]*modify code[^.!]*user confirms/i)
    } else {
      // This is a permission boundary, not a byte-for-byte prose baseline.
      expect(prompt).toMatch(/(?:Building|reviewing)[\s\S]{0,100}no tracker or publication authority/i)
      expect(prompt).toMatch(/Never use graph `after` edges/)
      expect(prompt).toMatch(/Workers never mutate trackers, plan branch, remote, or manifests/)
      expect(prompt).toMatch(/Before new selection side effects on a repeated invocation/i)
    }
  })

  for (const cancel of [false, true]) {
    test(`${fixture.key}: actual reporting module ${cancel ? 'cancellation' : 'phase gates, same-worker evidence, failure, retry, and recovery'} with synthetic native/tracker evidence`, async () => {
      const base = process.env.PI_GRAPH_DASHBOARD_TEST_EVIDENCE ?? tmpdir()
      if (!isAbsolute(base)) throw new Error('Test evidence directory must be absolute')
      mkdirSync(base, { recursive: true, mode: 0o700 })
      const root = mkdtempSync(join(base, `${fixture.key}-${cancel ? 'cancel' : 'complete'}-`))
      const directory = join(root, 'artifacts')
      const parent = `${fixture.key}-${cancel ? 'cancel' : 'complete'}-parent`
      const entries: Record<string, unknown>[] = [], errors: string[] = [], statuses: (string | undefined)[] = []
      const calls: { name: string; args: unknown }[] = [], trace: unknown[] = []
      const allocated = new Map<string, { id: string; state: string }>()
      const snapshots: GraphSnapshot[] = []
      const boundIdentities = new Map<string, Binding | undefined>()
      const checkpoint = () => entries.filter(entry => entry.customType === 'agent-graph-dashboard:v1').at(-1)!.data as {
        names: Record<string, string>; bindings: Binding[]
      }
      // Reporting role nodes are compared with the real pure helper. This is
      // not a journal writer, budget enforcer, or tracker acceptance test.
      const roleEvents = (snapshot: GraphSnapshot) => {
        const linked = new Set(snapshot.edges.filter(edge => edge.from === 'worker-A').map(edge => edge.to))
        return snapshot.nodes.filter(node => linked.has(node.id) && node.kind === 'parent' && node.role === 'Implement')
          .map(node => ({ event: 'attempt', issueId: 'A', role: 'Implement', attempt: node.attempt }))
      }
      let rejectNames = new Set<string>(), clock = Date.now() - 2000
      const appendEntry = (customType: string, data: unknown) => {
        entries.push({ type: 'custom', id: `entry-${entries.length}`, customType, data: structuredClone(data) })
      }
      const receipt = (agents: { name: string; nativeId: string }[], state?: string) => ({
        content: [{ type: 'text', text: 'DO-NOT-EXPORT-RAW-RESULT' }],
        details: { at: ++clock, agents: agents.map(agent => ({ id: agent.nativeId, name: agent.name,
          state: state ?? allocated.get(agent.name)!.state, stateSince: clock, task: 'DO-NOT-EXPORT-FULL-PROMPT' })) },
      })
      const ctx: DashboardContext = {
        sessionManager: { getSessionId: () => parent, getSessionFile: () => join(root, 'synthetic-session-reference.jsonl'),
          getBranch: () => entries, getLeafId: () => entries.at(-1)?.id as string | undefined ?? null },
        ui: { notify: text => errors.push(text), setStatus: (_key, text) => statuses.push(text) },
        executeTool: async (name, args) => {
          calls.push({ name, args }); expect(name).toBe('agent_status')
          const workerName = (args as { name: string }).name
          if (rejectNames.has(workerName)) throw new Error('Synthetic public status transport failure')
          const worker = allocated.get(workerName)!
          return { isError: false, durationMs: 0, result: receipt([{ name: workerName, nativeId: worker.id }]),
            toolCall: { id: 'synthetic-direct-status', name, arguments: args } }
        },
      }
      let runtime = createGraphDashboardRuntime({ directory, appendEntry })
      let runId = '', originalExport = '', originalFileUrl = ''
      const read = () => createGraphDashboardStore({ directory, runId, parentSessionId: parent }).read()!
      const execute = async (input: DashboardInput) => {
        const result = await runtime.execute(input, ctx)
        trace.push({ input, result }); return result
      }
      const observeResult = async (agents: { name: string; nativeId: string; kind: string }[]) => {
        for (const agent of agents) allocated.get(agent.name)!.state = agent.kind === 'answered' ? 'idle' : 'interrupted'
        const nodes = agents.map(agent => ({ agentId: agent.nativeId, name: agent.name, kind: agent.kind, body: 'DO-NOT-EXPORT-RAW-RESULT' }))
        const message = { role: 'custom', customType: agents.length === 1 ? 'pi-agents:result' : 'pi-agents:graph-result', timestamp: ++clock,
          content: 'DO-NOT-EXPORT-RAW-RESULT', details: agents.length === 1 ? { version: 1, ...nodes[0] } :
            { version: 1, graphId: 'synthetic-result-graph', name: fixture.key, policy: 'allSettled', nodes } }
        entries.push({ type: 'message', id: `result-${clock}`, message })
        await runtime.observe({ type: 'message_end', message }, ctx)
      }
      function assertExpected(expected: Expected, before: GraphSnapshot) {
        const snapshot = read()
        if (expected.unchanged) expect(snapshot).toEqual(before)
        if (expected.preserveSource) expect(snapshot.timestamps.lastSourceObservationAt).toBe(before.timestamps.lastSourceObservationAt)
        if (expected.status) expect(snapshot.status).toBe(expected.status)
        if (expected.recovery) expect(snapshot.reporting?.recovery).toBe(expected.recovery)
        if (expected.workerCount !== undefined) expect(snapshot.nodes.filter(node => node.kind === 'worker')).toHaveLength(expected.workerCount)
        for (const [id, wanted] of Object.entries(expected.nodes ?? {})) {
          const node = snapshot.nodes.find(node => node.id === id)
          expect(node, `Expected declared node ${id}`).toBeDefined()
          const actual = { execution: node!.execution.state, verification: node!.verification.state, nativeId: node!.nativeId,
            gate: node!.gate?.state, wait: node!.wait?.reason, kind: node!.kind, attempt: node!.attempt, currentAttempt: node!.currentAttempt }
          for (const [key, value] of Object.entries(wanted)) expect(actual[key as keyof typeof actual]).toEqual(value)
        }
        // One stable worker node per allocated identity, even across agent_send.
        for (const [name, worker] of allocated) {
          const bound = snapshot.nodes.filter(node => node.kind === 'worker' && node.nativeId === worker.id)
          expect(bound).toHaveLength(1)
          const saved = checkpoint()
          expect(saved.names[bound[0].id]).toBe(name)
          const binding = saved.bindings.find(binding => binding.nodeId === bound[0].id)
          expect(binding).toBeDefined()
          if (!boundIdentities.has(bound[0].id)) boundIdentities.set(bound[0].id, structuredClone(binding))
          expect(binding).toEqual(boundIdentities.get(bound[0].id))
          expect(bound[0].attempt).toBe(1)
        }
        expect(JSON.stringify(snapshot)).not.toContain('DO-NOT-EXPORT')
      }
      async function step(action: Step) {
        const before = read()
        if (action.action === 'report') {
          const input = action.input.operation === 'create' ? action.input : { ...action.input, runId }
          await execute(input)
        } else if (action.action === 'launch') {
          for (const agent of action.agents) {
            expect(allocated.has(agent.name)).toBe(false)
            allocated.set(agent.name, { id: agent.nativeId, state: 'working' })
          }
          const toolName = action.agents.length === 1 ? 'agent_spawn' : 'agent_spawn_graph'
          const args = action.agents.length === 1 ? { name: action.agents[0].name, wait: 30 } :
            { name: `${fixture.key}-batch`, agents: action.agents.map(agent => ({ name: agent.name })), wait: 30 }
          await runtime.observe({ type: 'tool_execution_start', toolName, toolCallId: action.callId, args }, ctx)
          const result = receipt(action.agents, 'working')
          entries.push({ type: 'message', id: `receipt-${action.callId}`, message: { role: 'toolResult', toolName, toolCallId: action.callId, isError: false, ...result } })
          await runtime.observe({ type: 'tool_execution_end', toolName, toolCallId: action.callId, isError: false, result }, ctx)
          // Supported wait may deliver the answer before the parent can bind.
          if (action.earlyCompletion) await observeResult(action.agents.map(agent => ({ ...agent, kind: 'answered' })))
          await execute({ operation: 'bind', runId, launchToolCallId: action.callId, nodeIds: action.agents.map(agent => agent.nodeId) })
          for (const agent of action.agents) expect(checkpoint().bindings.find(binding => binding.nodeId === agent.nodeId)).toEqual({
            nodeId: agent.nodeId, name: agent.name, nativeId: agent.nativeId, launchToolCallId: action.callId,
          })
        } else if (action.action === 'result') await observeResult(action.agents)
        else if (action.action === 'observe') {
          for (const agent of action.agents) allocated.get(agent.name)!.state = action.state
          await runtime.observe({ type: 'tool_execution_end', toolName: action.tool, toolCallId: `synthetic-follow-up-${clock}`, isError: false,
            result: receipt(action.agents, action.state) }, ctx)
        } else if (action.action === 'wait-error') {
          await runtime.observe({ type: 'tool_execution_end', toolName: 'agent_wait', toolCallId: 'synthetic-timeout', isError: true, result: {} }, ctx)
        } else if (action.action === 'restart') {
          await runtime.close()
          runtime = createGraphDashboardRuntime({ directory, appendEntry })
          await runtime.restore(ctx)
        } else if (action.action === 'recover') {
          rejectNames = new Set(action.rejectNames)
          const firstCall = calls.length
          const result = await execute({ operation: 'recover', runId })
          expect(calls.slice(firstCall).map(call => (call.args as { name: string }).name).sort()).toEqual([...allocated.keys()].sort())
          expect(result.exportPath).toBe(originalExport); expect(result.fileUrl).toBe(originalFileUrl)
        } else if (action.action === 'export-failure') {
          const html = readFileSync(originalExport, 'utf8')
          chmodSync(originalExport, 0o644)
          try {
            await execute({ operation: 'update', runId, currentStage: 'synthetic-reporting-error' })
            expect(readFileSync(originalExport, 'utf8')).toBe(html)
            expect(read().nodes).toEqual(before.nodes)
            expect(errors.some(message => message.includes('HTML export failed'))).toBe(true)
          } finally { chmodSync(originalExport, 0o600) }
        } else if (action.action === 'links') {
          const shown = await execute({ operation: 'show', runId })
          expect(shown.runId).toBe(runId); expect(shown.exportPath).toBe(originalExport); expect(shown.fileUrl).toBe(originalFileUrl)
          expect(shown.reportUrl).not.toBeNull()
          expect((await fetch(shown.reportUrl!)).status).toBe(200)
          const served = await (await fetch(shown.reportUrl!.replace(/\/report$/, '/snapshot'))).json()
          expect(served).toEqual(read())
          expect(statuses.at(-1)).toContain(shown.reportUrl!)
        }
        assertExpected(action.expect, before)
        const after = read()
        if (action.action === 'restart' || action.action === 'recover') {
          expect(after.nodes.filter(node => node.kind !== 'worker')).toEqual(before.nodes.filter(node => node.kind !== 'worker'))
          expect(attemptsRemaining(roleEvents(after), 'A', 'Implement')).toBe(attemptsRemaining(roleEvents(before), 'A', 'Implement'))
        }
        snapshots.push(after)
        trace.push({ action, snapshot: after })
      }
      let finalUrl: string | null = null
      try {
        const created = await execute(fixture.create)
        runId = created.runId; originalExport = created.exportPath; originalFileUrl = created.fileUrl
        expect(created.fileUrl).toStartWith('file:')
        expect(readFileSync(originalExport, 'utf8')).toContain(runId)
        expect((await fetch(created.reportUrl!)).status).toBe(200)
        snapshots.push(read())
        const prefix = cancel ? fixture.steps.slice(0, fixture.cancellation.afterStep + 1) : fixture.steps
        for (const action of prefix) await step(action)
        if (cancel) for (const action of fixture.cancellation.steps) await step(action)
        const shown = await execute({ operation: 'show', runId })
        finalUrl = shown.reportUrl
        writeFileSync(join(root, 'result.json'), JSON.stringify({ synthetic: true, nativeExecution: false, commandExecution: false,
          fixture: fixture.key, cancel, result: shown, snapshot: read(), calls, errors, trace }, null, 2), { mode: 0o600 })
        writeFileSync(join(root, 'branch.json'), JSON.stringify(entries, null, 2), { mode: 0o600 })
        console.log(`Fixture evidence: ${root}`)
        if (fixture.command === '/df-implement-tickets' && !cancel) {
          const snapshot = read()
          const linked = new Set(snapshot.edges.filter(edge => edge.from === 'worker-A').map(edge => edge.to))
          const roles = snapshot.nodes.filter(node => linked.has(node.id) && node.kind === 'parent' && node.role === 'Implement')
          expect(roles, 'Unexpected failed verification requires a distinct parent Implement role-attempt series').toHaveLength(2)
          expect(roles.map(node => node.attempt)).toEqual([1, 2])
          expect(new Set(roles.map(node => node.logicalId)).size).toBe(1)
          const evidence = snapshot.nodes.filter(node => linked.has(node.id) && node.logicalId === 'A-evidence')
          expect(roles[0].logicalId).not.toBe('A-evidence')
          expect(roles[0].verification.state).toBe('failed')
          expect(roles[0].currentAttempt).toBe(false)
          expect(roles[1].currentAttempt).toBe(true)
          expect(evidence.length, 'Evidence-only correction and business retry need separate evidence history').toBeGreaterThanOrEqual(3)
          expect(evidence.some(node => node.verification.state === 'failed' && !node.currentAttempt)).toBe(true)
          expect(attemptsRemaining(roleEvents(snapshot), 'A', 'Implement')).toBe(1)
          // Require an evidence advance within role 1, then a role advance only
          // after its failed verification. Words in prompts cannot satisfy this.
          const currentRole = (state: GraphSnapshot) => state.nodes.find(node => roles.some(role => role.logicalId === node.logicalId) && node.currentAttempt)!
          const evidenceCount = (state: GraphSnapshot) => state.nodes.filter(node => node.logicalId === 'A-evidence').length
          expect(snapshots.some((state, index) => index > 0 && currentRole(state)?.attempt === 1 &&
            currentRole(snapshots[index - 1])?.attempt === 1 && currentRole(snapshots[index - 1])?.verification.state !== 'failed' &&
            evidenceCount(state) > evidenceCount(snapshots[index - 1])), 'Fixture needs an evidence-only correction within the existing role attempt').toBe(true)
          expect(snapshots.some((state, index) => index > 0 && currentRole(state)?.attempt === 2 &&
            currentRole(snapshots[index - 1])?.attempt === 1 && currentRole(snapshots[index - 1])?.verification.state === 'failed'),
          'Corrective business work must follow a failed role and a new recorded role attempt').toBe(true)
        }
      } finally {
        await runtime.close()
        if (finalUrl) {
          let closed = false
          try { await fetch(finalUrl) } catch { closed = true }
          writeFileSync(join(root, 'cleanup.json'), JSON.stringify({ finalUrl, endpointClosed: closed }), { mode: 0o600 })
          expect(closed).toBe(true)
        }
      }
    })
  }
}
