import { accessSync, constants, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

export function isRemoteHerdr(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.HERDR_WORKSPACE_ID && (env.HERDR_SOCKET_PATH || env.HERDR_ENV === '1' || env.TERM_PROGRAM === 'herdr') &&
    (env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY))
}

export function dashboardBrowserCommand(url: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): { command: string; args: string[] } {
  const parsed = new URL(url)
  if (isRemoteHerdr(env)) {
    if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1') throw new Error('Remote browser opening requires a live loopback report URL')
    const managed = join(env.HOME ?? homedir(), '.local/state/herdr/gpui/bin/herdr-gpui')
    const command = [managed, ...(env.PATH ?? '').split(delimiter).filter(Boolean).map(dir => join(dir, 'herdr-gpui'))].find(path => {
      try { accessSync(path, constants.X_OK); return statSync(path).isFile() } catch { return false }
    })
    if (!command) throw new Error(`Install the herdr-gpui remote helper at ${managed} or on PATH; enable agent-skill installation in Herdr UI for connected SSH hosts`)
    return { command, args: ['browser', 'open', url] }
  }
  if (env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY) throw new Error('Remote browser opening requires a Herdr session; use the report URL with your SSH tunnel')
  if (!['http:', 'file:'].includes(parsed.protocol)) throw new Error('Unsupported dashboard URL')
  if (platform === 'darwin') return { command: 'open', args: [url] }
  if (platform === 'win32') return { command: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] }
  return { command: 'xdg-open', args: [url] }
}
