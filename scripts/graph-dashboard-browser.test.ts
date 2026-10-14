import { afterAll, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dashboardBrowserCommand, isRemoteHerdr } from './graph-dashboard-browser'

const url = 'http://127.0.0.1:36085/runs/run-1/report'
const home = mkdtempSync(join(tmpdir(), 'dashboard-browser-'))
const helper = join(home, '.local/state/herdr/gpui/bin/herdr-gpui')
mkdirSync(join(home, '.local/state/herdr/gpui/bin'), { recursive: true })
writeFileSync(helper, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
afterAll(() => rmSync(home, { recursive: true, force: true }))
const remote = { HOME: home, PATH: '', HERDR_WORKSPACE_ID: 'workspace-1', HERDR_SOCKET_PATH: '/tmp/herdr.sock', SSH_CONNECTION: 'client 123 host 22' }

test('Herdr browser forwarding requires both remote SSH and Herdr workspace evidence', () => {
  expect(isRemoteHerdr(remote)).toBe(true)
  expect(dashboardBrowserCommand(url, remote, 'linux')).toEqual({ command: helper, args: ['browser', 'open', url] })
  for (const ssh of ['SSH_CONNECTION', 'SSH_CLIENT', 'SSH_TTY']) {
    expect(isRemoteHerdr({ HERDR_WORKSPACE_ID: 'workspace-1', TERM_PROGRAM: 'herdr', [ssh]: 'present' })).toBe(true)
  }
  expect(isRemoteHerdr({ HERDR_WORKSPACE_ID: 'workspace-1', HERDR_ENV: '1', SSH_AUTH_SOCK: '/tmp/agent.sock' })).toBe(false)
  expect(isRemoteHerdr({ HERDR_WORKSPACE_ID: 'workspace-1', SSH_CONNECTION: 'present' })).toBe(false)
  expect(isRemoteHerdr({ SSH_CONNECTION: 'present' })).toBe(false)
  expect(isRemoteHerdr({})).toBe(false)
})

test('missing helpers fail with installation guidance and PATH installations remain supported', () => {
  const env = { ...remote, HOME: join(home, 'missing') }
  expect(() => dashboardBrowserCommand(url, env)).toThrow('Install the herdr-gpui remote helper')
  expect(dashboardBrowserCommand(url, { ...env, PATH: join(home, '.local/state/herdr/gpui/bin') }).command).toBe(helper)
})

test('local sessions use platform openers, never herdr-gpui', () => {
  const local = { HERDR_WORKSPACE_ID: 'workspace-1', HERDR_ENV: '1' }
  expect(dashboardBrowserCommand(url, local, 'darwin')).toEqual({ command: 'open', args: [url] })
  expect(dashboardBrowserCommand(url, {}, 'linux')).toEqual({ command: 'xdg-open', args: [url] })
  expect(dashboardBrowserCommand(url, {}, 'win32')).toEqual({ command: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] })
  expect(dashboardBrowserCommand('file:///tmp/report.html', {}, 'darwin').command).toBe('open')
})

test('remote sessions do not open remote files or launch a browser on the SSH server', () => {
  expect(() => dashboardBrowserCommand(url, { SSH_CONNECTION: 'present' }, 'linux')).toThrow('requires a Herdr session')
  expect(() => dashboardBrowserCommand('file:///tmp/report.html', remote)).toThrow('live loopback report URL')
  expect(() => dashboardBrowserCommand('http://evil.example/report', remote)).toThrow('live loopback report URL')
  expect(() => dashboardBrowserCommand('javascript:alert(1)', {})).toThrow('Unsupported dashboard URL')
})
