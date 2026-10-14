import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Type } from 'typebox'
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from '@earendil-works/pi-coding-agent'
import { createGraphDashboardRuntime, type DashboardInput } from '../scripts/graph-dashboard-runtime'
import { truncateToWidth, visibleWidth, type TuiMouseEvent } from '@earendil-works/pi-tui'
import { dashboardBrowserCommand } from '../scripts/graph-dashboard-browser'

const id = Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$' })
const text = Type.String({ minLength: 1, maxLength: 512, pattern: '^[^\\u0000-\\u001f\\u007f]+$' })
const nullableText = Type.Union([text, Type.Null()])
const nullableId = Type.Union([id, Type.Null()])
const exact = { additionalProperties: false }
const choices = <T extends string>(values: T[]) => Type.Union(values.map(value => Type.Literal(value)))
const gate = Type.Object({ state: choices(['waiting', 'awaiting-approval', 'cleared', 'blocked']), clearingCondition: text }, exact)
const condition = Type.Union([Type.Null(), Type.Object({ reason: text, sourceNodeId: nullableId, externalRequirement: nullableText, clearingCondition: text }, exact)])
const evidence = Type.Array(Type.Object({ label: text, reference: id }, exact), { maxItems: 16 })
const declaration = { id, logicalId: id, label: text, role: text, stage: text, attempt: Type.Integer({ minimum: 1 }) }
const node = Type.Union([
  Type.Object({ ...declaration, kind: Type.Literal('worker'), nativeName: text, gate: Type.Null() }, exact),
  Type.Object({ ...declaration, kind: Type.Literal('parent'), nativeName: Type.Null(), gate: Type.Null() }, exact),
  Type.Object({ ...declaration, kind: Type.Literal('gate'), nativeName: Type.Null(), gate }, exact),
])
const nodes = Type.Array(node, { maxItems: 512 })
const edges = Type.Array(Type.Object({ from: id, to: id, type: choices(['native-after', 'parent-gate', 'verification']) }, exact), { maxItems: 4096 })
const topology = choices(['declared', 'unknown-future'])
const parameters = Type.Union([
  Type.Object({ operation: Type.Literal('create'), runName: text, command: choices(['/df-implement-tickets', '/gitlab-address-pr-agent-review']), currentStage: text, topology, nodes, edges }, exact),
  Type.Object({ operation: Type.Literal('declare'), runId: id, nodes, edges }, exact),
  Type.Object({ operation: Type.Literal('bind'), runId: id, launchToolCallId: text, nodeIds: Type.Array(id, { minItems: 1, maxItems: 512, uniqueItems: true }) }, exact),
  Type.Object({ operation: Type.Literal('update'), runId: id, currentStage: Type.Optional(text), workspace: Type.Optional(Type.Object({ branch: nullableText, worktree: text }, exact)), topology: Type.Optional(topology), status: Type.Optional(choices(['active', 'succeeded', 'partial-failure', 'cancelled', 'interrupted'])), nodes: Type.Optional(Type.Array(Type.Object({ id,
    execution: Type.Optional(choices(['planned', 'queued', 'waiting', 'running', 'answered', 'failed', 'skipped', 'cancelled', 'interrupted', 'unknown'])),
    verification: Type.Optional(Type.Object({ state: choices(['unverified', 'pending', 'verified', 'failed', 'unknown']), reason: nullableText }, exact)),
    gate: Type.Optional(gate), blocker: Type.Optional(condition), wait: Type.Optional(condition), evidence: Type.Optional(evidence),
  }, exact), { maxItems: 512 })) }, exact),
  Type.Object({ operation: Type.Literal('recover'), runId: id }, exact),
  Type.Object({ operation: Type.Literal('show'), runId: id }, exact),
])

/** Passive parent reporter. Browser opening is explicit and never controls workers. */
export default function (pi: ExtensionAPI) {
  let runtime: ReturnType<typeof createGraphDashboardRuntime> | null = null
  let currentRunId: string | null = null
  const ensure = () => runtime ??= createGraphDashboardRuntime({ directory: join(getAgentDir(), 'artifacts', 'agent-graph-dashboard'), appendEntry: (type, data) => pi.appendEntry(type, data) })
  function announce(result: { runId: string; reportUrl: string | null; exportPath: string; fileUrl: string }) {
    const online = result.reportUrl ? `[Loopback report](${result.reportUrl})\n` : 'Loopback report unavailable.\n'
    pi.sendMessage({ customType: 'agent-graph-dashboard:link', content: `${online}[Offline HTML export](${result.fileUrl})\nAbsolute path: ${result.exportPath}\nRun: ${result.runId}`, display: true }, { triggerTurn: false })
  }
  let opening = false
  const openReport = async (ctx: ExtensionContext) => {
    if (opening) return
    if (!currentRunId) { ctx.ui.notify('No graph dashboard declared on this parent branch.', 'info'); return }
    opening = true
    try {
      const result = await ensure().execute({ operation: 'show', runId: currentRunId }, dashboardContext(ctx))
      const { command, args } = dashboardBrowserCommand(result.reportUrl ?? result.fileUrl)
      const opened = await pi.exec(command, args, { timeout: 10000 })
      if (opened.code !== 0 || opened.killed) throw new Error(`${command} failed: ${opened.stderr.trim() || opened.stdout.trim() || (opened.killed ? 'timed out' : `exit ${opened.code}`)}`)
      ctx.ui.notify(`Browser open requested. Report: ${result.reportUrl ?? result.fileUrl}`, 'info')
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      ctx.ui.notify(`Graph dashboard: browser open failed: ${reason}. Use /agent-graph-dashboard for report links.`, 'error')
    } finally { opening = false }
  }
  const dashboardContext = (ctx: ExtensionContext): ExtensionContext => Object.defineProperties({}, {
    ...Object.getOwnPropertyDescriptors(ctx),
    ui: { value: {
      ...ctx.ui,
      setStatus(key, text) {
        if (key !== 'agent-graph-dashboard' || !ctx.hasUI || ctx.mode !== 'tui') { ctx.ui.setStatus(key, text); return }
        ctx.ui.setStatus(key, undefined)
        if (!text) { ctx.ui.setWidget(key, undefined); return }
        // A plain component click reaches Pi; an OSC 8 link is intercepted by the terminal.
        const label = text.replace(/\x1b\]8;[^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
        ctx.ui.setWidget(key, () => {
          let columns = 0
          return {
            render(width: number) {
              const line = truncateToWidth(`${label} · Open dashboard`, width)
              columns = visibleWidth(line)
              return [line]
            },
            invalidate() { columns = 0 },
            handleMouse(event: TuiMouseEvent) {
              if (event.type !== 'click' || event.button !== 'left' || event.shift || event.alt || event.ctrl || event.y !== 0 || event.x < 0 || event.x >= columns) return
              void openReport(ctx)
              return { handled: true, render: false }
            },
          }
        }, { placement: 'belowEditor' })
      },
    } },
  }) as ExtensionContext
  const restore = async (original: ExtensionContext) => {
    const ctx = dashboardContext(original)
    currentRunId = null
    await ensure().restore(ctx)
    const entry = [...ctx.sessionManager.getBranch()].reverse().find(entry => entry.type === 'custom' && entry.customType === 'agent-graph-dashboard:v1')
    if (entry?.type !== 'custom') return
    const data = entry.data as { snapshot?: { runId?: string; parentSessionId?: string } } | undefined
    if (data?.snapshot?.parentSessionId !== ctx.sessionManager.getSessionId() || typeof data.snapshot.runId !== 'string') return
    currentRunId = data.snapshot.runId
    // The restored link is explicitly pending direct native reconciliation.
    try { announce(await ensure().execute({ operation: 'show', runId: currentRunId }, ctx)) }
    catch { ctx.ui.notify('Graph dashboard: report recovery unavailable; original artifacts remain unchanged', 'error') }
  }
  pi.on('session_start', async (_event, ctx) => restore(ctx))
  pi.on('session_tree', async (_event, ctx) => restore(ctx))
  pi.on('session_shutdown', async () => { currentRunId = null; const previous = runtime; runtime = null; await previous?.close() })
  pi.on('tool_execution_start', async (event, ctx) => { await runtime?.observe(event, dashboardContext(ctx)) })
  pi.on('tool_execution_update', async (event, ctx) => { await runtime?.observe(event, dashboardContext(ctx)) })
  pi.on('tool_execution_end', async (event, ctx) => { await runtime?.observe(event, dashboardContext(ctx), true) })
  pi.on('message_end', async (event, ctx) => { await runtime?.observe(event, dashboardContext(ctx)) })
  pi.registerCommand('agent-graph-dashboard-open', {
    description: 'Open the current report; remote Herdr sessions use herdr-gpui browser open.',
    handler: async (args, ctx) => {
      if (args.trim()) { ctx.ui.notify('Use /agent-graph-dashboard-open without arguments. URLs are not accepted.', 'error'); return }
      await openReport(ctx)
    },
  })
  pi.registerCommand('agent-graph-dashboard-resync', {
    description: 'Back up and resync this report from an exact historical checkpoint without moving the conversation.',
    handler: async (args, ctx) => {
      if (args.trim()) { ctx.ui.notify('Use /agent-graph-dashboard-resync without arguments. Paths and snapshots are not accepted.', 'error'); return }
      if (!ctx.hasUI) { ctx.ui.notify('Resync requires user confirmation in an interactive session.', 'error'); return }
      await ctx.waitForIdle()
      const sessionId = ctx.sessionManager.getSessionId(), leafId = ctx.sessionManager.getLeafId()
      if (!await ctx.ui.confirm('Resync graph dashboard?', 'Back up the session and report, then restore reporting from the matching historical checkpoint. Replay exact worker receipts on this branch. Keep approval gates and verification decisions unchanged.')) return
      if (sessionId !== ctx.sessionManager.getSessionId() || leafId !== ctx.sessionManager.getLeafId()) { ctx.ui.notify('Session position changed during confirmation. Retry resync.', 'error'); return }
      try {
        const result = await ensure().resync(dashboardContext(ctx))
        currentRunId = result.runId
        announce(result)
        pi.sendMessage({ customType: 'agent-graph-dashboard:resync', content: `Reporting resynced from checkpoint ${result.sourceCheckpointId}. Replayed ${result.replayedEntryIds.length} current-branch observations.\nPrivate backup: ${result.backupPath}\nParent gates and verification decisions are unchanged. Narrative claims and failed parent updates are not applied. Use recover to reconcile current native status.`, display: true }, { triggerTurn: false })
      } catch (error) {
        ctx.ui.notify(`Graph dashboard: resync failed: ${error instanceof Error ? error.message : String(error)}. Original conversation entries and workers are unchanged.`, 'error')
      }
    },
  })
  pi.registerCommand('agent-graph-dashboard', {
    description: 'Show the current parent-owned graph report. Direct status recovery uses the reporting tool.',
    handler: async (args, ctx) => {
      if (args.trim()) { ctx.ui.notify('Use /agent-graph-dashboard without arguments. Paths are not accepted.', 'error'); return }
      if (!currentRunId) { ctx.ui.notify('No graph dashboard declared on this parent branch.', 'info'); return }
      try { announce(await ensure().execute({ operation: 'show', runId: currentRunId }, dashboardContext(ctx))) }
      catch { ctx.ui.notify('Graph dashboard: report unavailable; execution and parent gates are unchanged', 'error') }
    },
  })
  pi.registerTool({
    name: 'agent_graph_dashboard', label: 'Agent graph dashboard', parameters,
    description: 'Declare a read-only parent graph report, bind exact owned native launch receipts, record parent gates and verification, or reconcile recorded native identities after recovery. Never starts or stops workers. No paths, raw results, native IDs, or observation timestamps are accepted.',
    executionMode: 'sequential',
    promptGuidelines: [
      `DF helper resource (path data, not shell source): ${JSON.stringify(fileURLToPath(new URL('../scripts/df-ticket-hub.mjs', import.meta.url)))}. For a fresh /df-implement-tickets run, use this exact resource and freeze its bytes. On recovery, use the original run's frozen helper, not this resource.`,
      'The parent owns declarations, approval gates, independent verification, and terminal run status. Native answered does not mean verified.',
      'MR create supplies fixed parent reporting phases even with empty nodes/edges. DF topology remains caller-declared. Declare explicit parallel worker prerequisite and verification edges before launching. Worker nativeName must be the exact nonempty launch name; it is separate checkpoint metadata, not a binding. Preserve the command\'s supported native wait settings. The adapter automatically binds complete exact owned launch receipts. If binding fails, use bind with the exact launchToolCallId. Repeating the same exact binding is safe. Use native wait/status as the command requires.',
      'After session recovery, call recover for the recorded run. Never respawn workers to repair reporting or bind from same-name status alone.',
      'Git branch and worktree are captured from the parent cwd at create. When work moves to another verified worktree, update workspace with its absolute worktree path and branch (null for detached HEAD). Older runs retain Not recorded until the parent supplies verified workspace data.',
      'Print the report links and absolute offline export path in the final summary. Reporting failures do not change execution permissions or parent gates.',
    ],
    async execute(_callId, input, _signal, _onUpdate, ctx) {
      try {
        const result = await ensure().execute(input as DashboardInput, dashboardContext(ctx))
        currentRunId = result.runId
        if (input.operation === 'create' || input.operation === 'recover' || (input.operation === 'update' && input.status && input.status !== 'active')) announce(result)
        return { content: [{ type: 'text', text: `Run: ${result.runId}\nReport: ${result.reportUrl ?? 'Unavailable'}\n[Offline HTML export](${result.fileUrl})\nAbsolute path: ${result.exportPath}` }], details: result }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        ctx.ui.notify(`Graph dashboard: reporting operation failed: ${reason}; execution and parent gates are unchanged`, 'error')
        return { isError: true, content: [{ type: 'text', text: `Graph dashboard reporting failed: ${reason}. Execution and parent gates are unchanged. Do not respawn workers.` }], details: undefined }
      }
    },
  })
}
