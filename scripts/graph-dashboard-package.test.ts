import { expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'

// Peer-backed registration belongs to the durable public Pi-loader test:
// python3 scripts/graph-dashboard-package-registration.py --pi <verified-absolute-pi> --evidence-dir <new-private-path>
// Review its fresh proposal, then rerun with --execute --approved-proposal-sha256 <hash>.
// Both source and relocated resource assertions are mandatory there, not skipped here.
const sourcePrompt = new URL('../prompts/private_df-implement-tickets.md', import.meta.url)
const promptPath = existsSync(sourcePrompt) ? sourcePrompt : new URL('../prompts/df-implement-tickets.md', import.meta.url)

test('DF instructions retain preflight and frozen recovery without personal-path prerequisites', () => {
  const prompt = readFileSync(promptPath, 'utf8')
  // Prompt bytes are the workflow contract, not proof of agent obedience.
  // Run retained safety assertions before the intended portability failure.
  expect(prompt).toMatch(/Before Phase 0 mutations, read Phase 2 recovery and native prerequisites/)
  expect(prompt).toMatch(/persistent\s+parent session/)
  expect(prompt).toMatch(/actual parameter schemas/)
  expect(prompt).toMatch(/Never invent an ID, substitute another provider/)
  expect(prompt).toMatch(/confirmed normal\/escalation mapping/)
  expect(prompt).toMatch(/Inspect parent Loop tools/)
  expect(prompt).toMatch(/Before launching, use `LoopList`/)
  expect(prompt).toMatch(/On restart, use the manifest's frozen command\/role bytes/)
  expect(prompt).toMatch(/After init, set HELPER to that frozen copy/)
  expect(prompt).toMatch(/Verify its bytes equal manifest\.input\.helperBytes/)
  expect(prompt).not.toMatch(/\/Users\/[^/\s]+|\/home\/[^/\s]+|pi-profile|requires a named local profile/)
  expect(prompt).toMatch(/helper resource path supplied by the loaded/)
  expect(prompt).toMatch(/If the resource path[\s\S]*?stop before side effects/)
  expect(prompt).toMatch(/If it is unavailable,[\s\S]*?stop before side effects/)
})
