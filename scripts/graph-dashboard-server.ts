import { randomBytes } from 'node:crypto'
import type { GraphDashboardStore, GraphSnapshot } from './graph-dashboard-store'

export interface GraphRenderContext {
  snapshotPath: string
  reportPath: string
  renderedAt: string
  nonce: string
  refreshIntervalMs: number
  staleAfterMs: number
}
/** Trusted local renderer. Escape all snapshot text. Use the nonce for inline style/script tags.
 * Never treat renderedAt or browser polling as a fresh native source observation.
 */
export type GraphDashboardRenderer = (snapshot: GraphSnapshot, context: GraphRenderContext) => string
export interface GraphDashboardServerOptions {
  store: GraphDashboardStore
  renderer?: GraphDashboardRenderer
  port?: number
}

/** No CLI or runtime adapter is installed here. The parent supplies its renderer at startup. */
export function createGraphDashboardServer({ store, renderer, port = 0 }: GraphDashboardServerOptions) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Graph dashboard: invalid port')
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(store.runId)) throw new Error('Graph dashboard: invalid run identifier')
  const snapshotPath = `/runs/${store.runId}/snapshot`
  const reportPath = `/runs/${store.runId}/report`
  const server = Bun.serve({
    hostname: '127.0.0.1', port, maxRequestBodySize: 1024, idleTimeout: 10,
    fetch(request) {
      const authority = request.headers.get('host') ?? ''
      const origin = `http://${authority}`
      const nonce = randomBytes(18).toString('base64')
      const headers = {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Cross-Origin-Resource-Policy': 'same-origin',
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src data:; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      }
      function json(value: unknown, status = 200, extra: Record<string, string> = {}) {
        return new Response(JSON.stringify(value), { status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8', ...extra } })
      }
      function error(code: string, message: string, status: number, extra?: Record<string, string>) {
        return json({ error: { code, message } }, status, extra)
      }
      try {
        const port = /^127\.0\.0\.1:([1-9]\d{0,4})$/.exec(authority)?.[1]
        if (!port || Number(port) > 65535) return error('FORBIDDEN', 'Untrusted request origin', 403)
        const url = new URL(request.url)
        const suppliedOrigin = request.headers.get('origin')
        const site = request.headers.get('sec-fetch-site')
        if (url.origin !== origin ||
          (suppliedOrigin !== null && suppliedOrigin !== origin) || (site !== null && site !== 'same-origin' && site !== 'none')) {
          return error('FORBIDDEN', 'Untrusted request origin', 403)
        }
        if (request.method !== 'GET') return error('METHOD_NOT_ALLOWED', 'Only GET is available', 405, { Allow: 'GET' })
        // Reject queries and encoded paths; no arbitrary file, directory, or artifact lookup exists.
        const rawPath = request.url.slice(origin.length)
        if (url.search || url.hash || rawPath !== url.pathname || !['/health', snapshotPath, reportPath].includes(url.pathname)) {
          return error('NOT_FOUND', 'Unknown artifact', 404)
        }
        if (url.pathname === '/health') return json({ status: 'ok' })
        const snapshot = store.read()
        if (snapshot === null) return error('NOT_FOUND', 'Snapshot not available', 404)
        if (url.pathname === snapshotPath) return json(snapshot)
        if (!renderer) return error('RENDERER_UNAVAILABLE', 'Report renderer not installed', 503)
        const html = renderer(snapshot, { snapshotPath, reportPath, renderedAt: new Date().toISOString(), nonce, refreshIntervalMs: 5000, staleAfterMs: 15000 })
        if (typeof html !== 'string' || Buffer.byteLength(html) > 4_194_304) throw new Error('Invalid report')
        return new Response(html, { headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } })
      } catch {
        return error('REPORT_UNAVAILABLE', 'Report could not be read or rendered', 500)
      }
    },
    error() {
      return new Response('{"error":{"code":"REQUEST_FAILED","message":"Request failed"}}', {
        status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
      })
    },
  })
  return server
}
