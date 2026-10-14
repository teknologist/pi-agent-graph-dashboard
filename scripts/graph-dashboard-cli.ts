import { join } from 'node:path'
import { homedir } from 'node:os'
import { createGraphDashboardStore } from './graph-dashboard-store'
import { createGraphDashboardServer } from './graph-dashboard-server'
import { renderGraphDashboard } from './graph-dashboard-render'

// Fixed local artifact root. No browser or model-supplied path enters this CLI.
const [runId, parentSessionId] = process.argv.slice(2)
const directory = process.env.PI_GRAPH_DASHBOARD_DIRECTORY ?? join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent'), 'artifacts', 'agent-graph-dashboard')
const store = createGraphDashboardStore({ directory, runId, parentSessionId })
const server = createGraphDashboardServer({ store, renderer: renderGraphDashboard })
process.stdout.write(JSON.stringify({ runId, parentSessionId, port: server.port }) + '\n')
const close = () => { server.stop(true); process.exit(0) }
process.on('SIGTERM', close)
process.on('SIGINT', close)
// The pipe belongs to the parent. A crash closes it without touching workers.
process.stdin.resume()
process.stdin.on('end', close)
