import { afterEach, expect, mock, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import type { TuiMouseEvent } from '@earendil-works/pi-tui'

const root = mkdtempSync(join(tmpdir(), 'dashboard-extension-'))
// Host imports are supplied by Pi in production; test the adapter against a small host fixture.
mock.module('@earendil-works/pi-coding-agent', () => ({ getAgentDir: () => root }))
mock.module('typebox', () => ({ Type: new Proxy({}, { get: () => (...args: unknown[]) => args }) }))
mock.module('@earendil-works/pi-tui', () => ({ truncateToWidth: (s: string, width: number) => s.slice(0, width), visibleWidth: (s: string) => s.length }))
const { default: register } = await import('../extensions/agent-graph-dashboard')

let shutdown: (() => Promise<void>) | undefined
const savedEnv = { ...process.env }
afterEach(async () => {
  await shutdown?.()
  shutdown = undefined
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key]
  Object.assign(process.env, savedEnv)
  rmSync(root, { recursive: true, force: true })
})

test('command and status click open only the owned report, and failures retain worker gates', async () => {
  process.env.HERDR_WORKSPACE_ID = 'workspace-fixture'
  process.env.HERDR_SOCKET_PATH = '/tmp/herdr-fixture.sock'
  process.env.SSH_CONNECTION = 'client 123 host 22'
  type Handler = (args: string, ctx: ExtensionContext) => Promise<void>
  type Widget = { render(width: number): string[]; invalidate(): void; handleMouse(event: TuiMouseEvent): unknown }
  const commands = new Map<string, Handler>()
  const events = new Map<string, (event: unknown, ctx: ExtensionContext) => Promise<void>>()
  const entries: unknown[] = []
  const calls: { command: string; args: string[] }[] = []
  const notices: string[] = []
  let widget: Widget | undefined
  let browserCode = 0
  let completed: (() => void) | undefined
  let tool: { execute: (id: string, input: unknown, signal: unknown, update: unknown, ctx: ExtensionContext) => Promise<{ details: { runId: string; reportUrl: string } }> }
  const ctx = {
    hasUI: true, mode: 'tui',
    sessionManager: {
      getSessionId: () => 'parent-browser-test', getSessionFile: () => '/synthetic/session.jsonl',
      getBranch: () => entries, getLeafId: () => entries.length ? `entry-${entries.length - 1}` : null,
    },
    ui: {
      notify(text: string) { notices.push(text); if (text.includes('Browser open requested') || text.includes('browser open failed')) completed?.() },
      setStatus() {},
      setWidget(_key: string, factory?: () => Widget) { widget = factory?.() },
    },
  } as unknown as ExtensionContext
  register({
    on(name: string, callback: (event: unknown, ctx: ExtensionContext) => Promise<void>) { events.set(name, callback) },
    registerCommand(name: string, command: { handler: Handler }) { commands.set(name, command.handler) },
    registerTool(value: typeof tool) { tool = value },
    appendEntry(customType: string, data: unknown) { entries.push({ type: 'custom', id: `entry-${entries.length}`, customType, data }) },
    sendMessage() {},
    async exec(command: string, args: string[]) { calls.push({ command, args }); return { code: browserCode, stdout: '', stderr: browserCode ? 'fixture opener unavailable' : '', killed: false } },
  } as unknown as ExtensionAPI)
  shutdown = () => events.get('session_shutdown')!({}, ctx)
  await events.get('session_start')!({}, ctx)
  await commands.get('agent-graph-dashboard-open')!('', ctx)
  expect(calls).toHaveLength(0)
  expect(notices.at(-1)).toContain('No graph dashboard')
  const result = await tool!.execute('create', { operation: 'create', runName: 'Browser fixture', command: '/gitlab-address-pr-agent-review', currentStage: 'test', topology: 'unknown-future', nodes: [], edges: [] }, undefined, undefined, ctx)
  expect(calls).toHaveLength(0)
  expect(widget).toBeDefined()
  expect(widget!.render(160)[0]).not.toContain('\x1b]8')
  expect(widget!.render(160)[0]).toContain('Open dashboard')
  await commands.get('agent-graph-dashboard-open')!('http://evil.example', ctx)
  expect(calls).toHaveLength(0)
  await commands.get('agent-graph-dashboard-open')!('', ctx)
  expect(calls).toEqual([{ command: 'herdr-gpui', args: ['browser', 'open', result.details.reportUrl] }])
  const click = { type: 'click', button: 'left', x: 1, y: 0, shift: false, alt: false, ctrl: false } as TuiMouseEvent
  widget!.render(160)
  expect(widget!.handleMouse({ ...click, button: 'right' })).toBeUndefined()
  expect(widget!.handleMouse({ ...click, type: 'drag' })).toBeUndefined()
  expect(widget!.handleMouse({ ...click, y: 1 })).toBeUndefined()
  expect(widget!.handleMouse({ ...click, x: 200 })).toBeUndefined()
  const done = new Promise<void>(resolve => { completed = resolve })
  expect(widget!.handleMouse(click)).toEqual({ handled: true, render: false })
  await done
  expect(calls).toHaveLength(2)
  expect(calls[1]).toEqual(calls[0])
  browserCode = 1
  await commands.get('agent-graph-dashboard-open')!('', ctx)
  expect(notices.at(-1)).toContain('fixture opener unavailable')
  expect(notices.at(-1)).toContain('/agent-graph-dashboard')
  const checkpoints = entries as { customType?: string; data?: { snapshot?: { nodes: { kind: string; gate?: { state: string } }[] } } }[]
  const latest = checkpoints.filter(e => e.customType === 'agent-graph-dashboard:v1').at(-1)!.data!.snapshot!
  expect(latest.nodes.filter(n => n.kind === 'gate').every(n => n.gate?.state !== 'cleared')).toBe(true)
  await shutdown()
  shutdown = undefined
  expect(widget).toBeUndefined()
})
