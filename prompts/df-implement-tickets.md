---
description: Implement ready-for-agent tracker issues, optionally narrowed by a label or Linear issue ID, with a native parent hub and pi-agents
argument-hint: "[label|Linear issue ID]   (always requires ready-for-agent)"
---

# df-implement-tickets

Implement ready-for-agent tracker issues selected by **"${1:-ready-for-agent}"**. You own Phases 0, 1, 3, and 4
deterministically; Phase 2 uses native pi-agents workers under your evidence gates. Do not skip or reorder phases.

Before Phase 0 mutations, read Phase 2 recovery and native prerequisites. Confirm a persistent
parent session, actual native tools/model mappings, and parent continuity tools. On a repeated
invocation, recover the existing run before claims or infrastructure. This command authorizes
future job-related signed commits and publication under Phase 4, not merges of the PR/MR.
Building or reviewing this command alone grants no tracker or publication authority.

**Operate autonomously and grind.** Failing tests, red typechecks, merge conflicts, stale
expectations, and repairable tracker drift are friction, not stops — fix them and keep going.
Only yield for a genuine human decision (ambiguous config, destructive action with no safe
default). Never end a turn with a knowable pending next step.

## Graph dashboard reporting

Use parent-only `agent_graph_dashboard` for a read-only report. This adds no tracker,
commit, publication, worker, or scheduling authority. Workers do not call the reporter.
If reporting fails or the tool is unavailable, disclose the gap and retain the last valid
links. Continue only under the original business gates; reporting failure never clears
those gates, changes outcomes, authorizes retries, or prevents safe cleanup.

1. **Create or recover.** First check original run ownership and the persistent parent session.
   For a fresh run, call `create` with the command below, a safe run name, `currentStage`,
   `topology: "unknown-future"`, planned parent phase nodes, gate nodes, and typed edges.
   Declare all known parent phases listed below. Unknown future worker topology stays explicit;
   do not invent workers, names, or dependencies. Retain the returned dashboard `runId` as
   `DASHBOARD_RUN_ID` in the original durable parent evidence, with command and business-run
   identity. It is distinct from the business run ID. On resume, use that exact parent and
   dashboard run, then call `recover` to reconcile recorded native identities before claiming
   fresh observations. A restored link or `show` alone is not reconciliation. Failed or partial
   recovery retains uncertainty and business gates. Do not select a latest unrelated run,
   create over an active owner, replay business effects, or spawn to repair reporting.
   Existing runs retain their frozen instructions. If no reporting checkpoint exists for an
   older run, disclose that limit; do not restart its completed work to populate a report.
2. **Declare and bind.** Before each actual native launch, use `declare` to append the known
   worker and parent role/evidence nodes with stable IDs. Each declaration has `id`, `logicalId`,
   `label`, `role`, `stage`, `kind`, `attempt`, `nativeName`, and `gate`. Worker `nativeName`
   equals the exact recorded native name; parent/gate names are null. Only gate nodes have
   `{state, clearingCondition}`. Use unique worker logical IDs for distinct native identities.
   Declare both edges for each parallel worker: its actual prerequisite → worker with
   `parent-gate`, and worker → its parent evidence target with `verification`. Never connect
   parallel workers to each other. Use frozen dependency evidence and actual role allocation
   for these targets. Do not guess issue dependencies from phase order. Per-issue evidence
   targets need explicit prerequisite edges. Do not omit `bind` when parent verification succeeds.
   Keep the existing native tools, batch limits, permissions, and supported wait settings.
   The adapter automatically binds complete exact owned launch receipts after launch completion.
   Verify that the declared workers have native identities. If automatic binding fails, call
   `bind` with `DASHBOARD_RUN_ID`, the exact owned `launchToolCallId`, and declared `nodeIds`.
   Repeating the same exact binding is safe. Early completion is supported by receipt replay. Do not infer an allocation from a same-name status or caller-supplied
   native ID. Uncertain launch/bind ownership requires original-session inspection, not a
   replacement launch. These instructions do not require nonblocking or omitted waits.
3. **Record parent decisions.** Use `update` with `DASHBOARD_RUN_ID` at each phase, native
   result/status/wait/stop boundary, verification decision, approval, blocker, and final outcome.
   Set `currentStage`; update only current parent/gate/evidence nodes. Native observations own
   worker execution. An answered worker is not verified. Record verification only after the
   existing parent checks pass. Use `parent-gate` and `verification` edges, never native-after
   edges for these command graphs. Edges only display prerequisites; they never release work.
   Ordinary prerequisite waits use `wait`; normal approval uses `awaiting-approval`. Actionable
   failures use `blocker` and blocked gates. Conditions contain `reason`, nullable `sourceNodeId`,
   nullable `externalRequirement`, and `clearingCondition`. Clear a gate only from its original evidence
   or user approval. Clear resolved wait/blocker fields explicitly with null. Preserve separately
   verified scopes when another scope fails. Set `topology: "declared"` only when future scope is
   known; append later actual nodes and edges without deleting prior declarations.
4. **Keep identity and attempt history.** Use ONE worker node per actual exact native identity.
   A same-worker `agent_send` retains that node, name, binding, and native identity. Append parent
   role-attempt nodes for business retries using the existing recorded role attempt count.
   Append parent evidence-attempt nodes for superseding evidence using a separate evidence
   sequence; an evidence correction does not debit or reset the role budget. Use distinct parent
   logical IDs for role-attempt and evidence-attempt series. Increasing attempts retain earlier
   outcomes as history. Do not update retired
   attempts. For an already authorized fresh retry, declare a new worker identity and its parent
   evidence nodes. Reporting never renames, rebinds, reallocates, changes models, or alters budgets.
5. **Cancellation and terminal status.** A timeout, failed wait, or canceled wait does not stop
   workers. Follow the original cancellation protocol and verify exact native termination first.
   Only then record parent-confirmed `cancelled` status and affected gates. Keep unknown execution
   and reporting interruption distinct from verified failure. Set a terminal run status only
   after the existing final business gates establish success, partial-failure, cancellation, or
   interruption. Reporting uncertainty alone is not a terminal business outcome.
6. **Links and safe data.** At successful create, matching-session recovery, and final reporting,
   print the returned loopback `reportUrl` as a Markdown link, or state its unavailability.
   Also print `[Offline HTML export](<fileUrl>)`, the absolute `exportPath`, and dashboard run ID.
   Keep links in the parent session throughout execution; `/agent-graph-dashboard` or tool `show`
   retrieves the current report without changing business gates. Use safe concise labels and
   evidence `{label, reference}` identifiers only. Do not promise clickable evidence URLs or
   export full prompts, comments, results, reasoning, credentials, or environment contents.
   Browser refresh and a fresh render do not prove fresh native activity. If schema/size limits
   prevent complete reporting, disclose the missing scope rather than silently omit it.

For `create`, set `command: "/df-implement-tickets"`. Initial parent phases are native
preflight, Phase 0 configuration/selection, Phase 1 plan setup, Inventory, implementation waves,
serial Review, integration verification, CriteriaRepair, attestation, Phase 3 reconciliation,
and Phase 4 publication. Add worker topology only from frozen inputs and actual role allocations.
Dependency gates require `dependencyReady` evidence. Verification-boundary acknowledgement,
chronological review/comment readback, current-SHA criteria proofs, attestation receipts, and
whole-selection reconciliation remain separate parent gates. Terminal success requires verified
Phase 4 publication; a completed batch or partial issue success cannot clear publication.

## Generated CodeSight policy

`.codesight/` is generated state and must never block this loop. Before treating any worktree as
dirty, classify its paths. If only `.codesight/` is dirty, refresh CodeSight when available, stage
all of `.codesight/`, commit it on the current branch, and continue; this command explicitly
authorizes CodeSight-only commits. Preserve unrelated dirty paths and never include them in a
CodeSight-only commit. After merges/rebases or `.codesight/` conflicts, resolve source conflicts
first, remove only stale generated `.codesight/` output if regeneration needs a clean slate,
regenerate it from the resolved tree, stage it, and finish the merge/rebase. Never hand-edit it,
choose ours/theirs as the final generated result, restore an older snapshot, or stash it merely to
pass a cleanliness check. Include hook-generated `.codesight/` output in the current commit; if any
remains afterward, make a follow-up `chore: refresh CodeSight artifacts` commit. Stop only after
regeneration repeatedly fails or unrelated dirty work is genuinely unsafe to preserve.

## Tracker rules (parent only; workers return evidence)

- Linear: use the **Linear skill** for every read, comment, issue update, status change, label
  query, and acceptance-criteria checkbox update. Never raw Linear API calls or curl.
- GitHub: use `gh`. GitLab: use `glab`. Local-file trackers: edit the configured issue files
  directly; comments are work-log entries, status is the configured frontmatter/status field, and
  acceptance criteria are markdown checkboxes or an explicit criteria list.
- The issue tracker is the live work log. Comments/log entries are added throughout the cycle — at
  start, after each verification run, after review, after commit — not only at the end. They state
  what changed, why, what commands ran, what passed/failed, and the commit hash once committed.
- **Every Linear comment from the parent must identify both branches** with these exact
  fields: `Implementation branch: <issue branch>` and
  `Integration plan branch: <PLAN_BRANCH>`. This applies to start, verification, review, repair,
  failure, proof, and completion comments. The implementation branch is the issue branch
  `df-issue-<safeIssueSlug>` even after its commits merge into the integration plan branch. Do not
  post a Linear comment that omits either field.
- **Review evidence is a hard gate, including for native worker results.** Every pass must preserve
  reviewer/run identity, exact SHA or diff, all findings with severity and file/line (or exact
  `No issues found`), fixes/verification from the prior pass, and artifact/session path when
  available. A clean pass is valid only when both the raw review output and its separate tracker
  comment end with a standalone final line exactly `No issues found`. Verdicts such as `CLEAN`,
  `approve`, or equivalent summaries do not satisfy this gate. Post this immediately as a separate
  chronological tracker comment. The parent/reconcile
  phase must inspect raw review output and tracker comments; never trust only `green`, `applied`, or
  a self-reported review status. Use a separate read-only reviewer; review must be the
  final phase after implementation and verification. Repeat review → comment → fix → verify → review
  until a pass is clean. Missing review
  comments withhold Done; return intended comment text for repair, never invent evidence later.
- Before coding, move the issue to the repo-configured active/In Progress state. If no active state
  primitive is configured, add the start comment/log entry instead.
- **Acceptance criteria are a hard gate.** Every issue's acceptance criteria (markdown checkboxes
  in the issue description, or an explicit criteria list) must each be individually verified with
  a concrete check (command, test, or observable output). Once a criterion is proven working:
  - check its checkbox using the tracker-native editable issue body (Linear skill description
    update; GitHub `gh issue edit --body-file`; GitLab `glab issue update --description`; local
    markdown checkbox edit with exact text preserved), and
  - post a comment/log entry containing the **proof**: the exact command(s) run, the relevant output
    excerpt, and the commit sha that satisfies it.
  Never check a criterion that was implemented but not verified. Never mark an issue terminal/Done
  with unverified or unchecked criteria.

## Native capability preflight — read-only, before Phase 0

Apply Graph dashboard reporting after ownership/session checks; create only for a fresh run, or recover the exact existing run.

Perform these checks yourself before reporting a missing prerequisite. Do not use probe workers
or another agent's availability claim as evidence. Do not change settings or permissions.

1. Verify the active agent directory and persistent parent session metadata. Use
   `PI_CODING_AGENT_DIR` when set; otherwise verify the public Pi default agent directory.
   This command requires the native tools and parent continuity capabilities below, not a named
   personal profile. Inspect the current direct tool definitions for
   `agent_spawn`, `agent_spawn_graph`, `agent_status`, `agent_wait`, `agent_send`, and `agent_stop`,
   including their actual parameter schemas. Tool discovery metadata may help locate definitions,
   but execution must use direct native calls for full receipts. A missing name in a short tool
   summary, a codemode search miss, or an uninspected registry is not proof of unavailability.
   Inspect the actual registry and available extension-load diagnostics before declaring tools
   missing. Report the exact absent tool/schema and evidence if it remains unavailable.
2. Resolve user model names with read-only catalog queries:
   Use the verified absolute public Pi CLI executable with `--list-models <search>` and the same
   active agent directory. Verify the executable and directory before querying; if either is
   unresolved, stop before side effects. Do not use a shell alias or personal profile launcher.
   Treat the search as one quoted argument;
   never interpolate user text as shell source. Read the exact provider/model rows, not only fuzzy
   matches. For `Sol-6.1/Astra`, search `sol` and `astra`; the intended IDs may be
   `openai-codex/gpt-6.1-sol` and `openai-codex/gpt-6-astra`, but verify both rows in this run.
   Never invent an ID, substitute another provider, or treat a catalog row as a successful API call.
3. Preserve the user's confirmed normal/escalation mapping. If thinking levels are unspecified,
   propose normal `medium` and escalation `high`, check the native schema and model capability,
   and obtain one confirmation of the complete role/model/thinking table. Ask only about unresolved
   provider, role, or thinking choices; do not ask again for a mapping already explicitly confirmed.
   Use the verified provider-qualified IDs and exact thinking values in the frozen role instructions.
   Inventory/Implement use the normal mapping; Review/CriteriaRepair retain normal and escalation
   mappings as required below. Inspect parent Loop tools as well. Save a concise preflight record
   in the original parent session: active agent directory, session ID/file, direct tool names, catalog evidence,
   confirmed role/model/thinking table, and continuity capability. Keep secrets out of this record.
4. Distinguish setup provenance from execution ownership. A completed setup workflow number in
   repository notes does not own a fresh native job. Determine job ownership from the actual
   existing native manifest, original parent session, recorded IDs, and recovery evidence below.
   Never bypass a real existing owner. If preflight passes, continue this authorized invocation;
   do not stop solely because an earlier availability report was wrong. If it fails, report the
   specific unresolved fact and the read-only checks performed. Do not start tracker mutations,
   worktrees, continuity loops, or job workers to test an unresolved prerequisite.

## Phase 0 — Resolve config (deterministic; ABORT if unclear)

Apply Graph dashboard reporting to config, branch/selection approval, dependency blockers, and claim/readback outcomes without changing their ordering.

1. **Tracker.** Read `AGENTS.md`, `CLAUDE.md`, and `docs/agents/issue-tracker.md`. Determine
   whether issues live in GitHub (`gh`), GitLab (`glab`), Linear (Linear skill), or local files.
   Record **TRACKER** as exactly one of `github`, `gitlab`, `linear`, `local-file`. Record
   **TRACKER_CONFIG**: repo/project path, local issue-file glob if any, active/In Progress mapping,
   terminal/Done mapping, and checkbox/comment/log conventions. If not clearly declared, STOP and
   ask. Do not guess.
   **For Linear trackers**, TRACKER_CONFIG MUST include `projectId` (the Linear project UUID).
   `teamKey` filters by team, not project; without `projectId` the selection picks up issues from
   every project in the team that carries the label. Resolve `projectId` in this order:
   1. **Check existing config**: `docs/agents/issue-tracker.md` (the standard tracker config
      location per `setup-matt-pocock-skills`), then `.sandcastle/sandcastle.config.json`
      (`linear.projectId`) if the repo uses Sandcastle, or any other tracker config file.
   2. **Auto-resolve from repo name**: if not found, derive the repo name from
      `basename "$(git rev-parse --show-toplevel)"`. Use the Linear skill's project APIs; if scripting
      against the skill package, follow its `SKILL.md` import reference and call:
      `import { getDefaultProfile, listProjects } from './src/index.js'; const projects = await listProjects(getDefaultProfile());`.
      Find projects whose `name` matches the repo name (case-insensitive, exact match first; then
      `name.toLowerCase().includes(repoName.toLowerCase())`). If exactly one match, use its `id`.
   3. **Ask if ambiguous**: if multiple matches, use the `ask_user_question` tool to ask the user
      which Linear project this repo maps to — present the top 2–4 matches as options with name,
      id, and description. If zero matches, ask them to provide a project name/id to search (the
      tool's custom-answer row is acceptable) or stop. Do not guess.
   4. **Store the resolution**: after the Linear confirmation gate below, persist `projectId` and `projectName` back into
      `docs/agents/issue-tracker.md` (append a `Linear project: <name> (id: <id>)` line under the
      conventions section), or into `.sandcastle/sandcastle.config.json` under a `linear` key if the
      repo uses Sandcastle — so future runs skip resolution. Also set **TRACKER_CONFIG** for this
      run to include JSON/object fields `{ "projectId": "<id>", "projectName": "<name>" }`.
   If no `projectId` is resolved after these steps, STOP and ask — do not proceed with `teamKey` alone.
2. **REQUIRED_LABEL** = `ready-for-agent`. Every selected issue must contain this label.
   **SELECTOR** = `${1:-ready-for-agent}` (honour `docs/agents/triage-labels.md` remapping only when
   no argument was given). For a Linear tracker, use the Linear skill to list the team's issue labels
   and compare their names with SELECTOR exactly. If SELECTOR is a valid label, set **LABEL** = SELECTOR
   and **ISSUE_ID** = empty. If it is not a valid label and matches `^[A-Z][A-Z0-9]*-[0-9]+$`
   (for example, `TEAM-123`), set **ISSUE_ID** = SELECTOR and **LABEL** = REQUIRED_LABEL. Otherwise STOP and report that SELECTOR is
   neither a valid Linear label nor a supported Linear issue ID. For non-Linear trackers, set LABEL =
   SELECTOR and ISSUE_ID = empty. Treat LABEL as an additional filter when it differs from
   REQUIRED_LABEL. Keep raw values only for tracker queries.
3. **LABEL_SLUG**: sanitize ISSUE_ID when it is non-empty; otherwise sanitize LABEL. Lowercase, replace
   non `[a-z0-9-]` with `-`, trim leading/trailing dashes, fallback to `label`.
4. **PARENT_BRANCH**: fetch `origin`, list the available local and `origin/*` branches, then use
   `ask_user` (or the available ask-user question tool) to make the user choose the parent branch.
   This branch is both the base for the epic integration worktree and the eventual PR/MR merge
   target. Recommend `develop` when it exists locally or on `origin`; otherwise recommend `main`.
   Never silently select the recommendation. Store the normalized branch name without an
   `origin/` prefix and verify it exists locally or on `origin`.
5. **VERIFY_CMD**: from `AGENTS.md`/`CLAUDE.md` first, then project config (package.json scripts,
   Makefile, …). If none found, STOP and ask.

### Resolve the integration target before preview or setup

Resolve `SRC_PATH`, the common git directory, `REPO_NAME`, and
`WORKTREE_ROOT=$HOME/Dev/worktrees/<REPO_NAME>` without creating infrastructure.
For non-Linear, default to `PLAN_BRANCH=df-plan-<LABEL_SLUG>` and its path under
WORKTREE_ROOT. For Linear, compute the epic default in preflight step 4 below.
Before any selection preview or Phase 1 action, resolve any explicit
`TRACKER_CONFIG.integrationOverride:{branch,path,parentBranch}`. Use its branch/path instead
of the defaults. Its parentBranch must equal the user's chosen PARENT_BRANCH; otherwise ask
for a new explicit choice before proceeding. Require an absolute path under WORKTREE_ROOT,
a valid nonprotected branch distinct from parent/main/develop, and the same repository.
For existing paths/branches, inspect the common git directory and checked-out branch. For new
paths/branches, validate the intended root and ref, then verify actual identity after creation.
Freeze these resolved values for the preview, Phase 1, manifest, and publication. Never create
default-path infrastructure and then switch to an override.

### Linear-only read-only selection preflight (before Phase 1)

This subsection applies only when `TRACKER === "linear"`; non-Linear behavior is unchanged.
Resolve `LINEAR_PROFILE=getDefaultProfile()` and `CURRENT_USER=getCurrentUser(LINEAR_PROFILE)` once
and reuse them for every Linear call. Keep any newly inferred project resolution in memory; do not
write config until confirmation succeeds.

1. If ISSUE_ID is non-empty, use the Linear skill's parent-aware `readIssues([ISSUE_ID])` operation.
   Otherwise call `listIssues({ projectId: TRACKER_CONFIG.projectId, labels: [LABEL], limit: 250 }, LINEAR_PROFILE)`;
   if exactly 250 candidates return, STOP with a truncation error, then batch-read the identifiers with
   `readIssues()` in chunks of at most 50. Require every returned record to contain its explicit
   `parentId: string | null`; only that operation's explicit `null` may mean confirmed parent absence.
   Call this the **Phase 0 candidate query**.
2. Select only detailed records where `issue.projectId === TRACKER_CONFIG.projectId`, `issue.labels`
   contains `REQUIRED_LABEL` and, when ISSUE_ID is empty, also contains `LABEL`; `issue.status` is not in the configured terminal/Done set; and
   `issue.assigneeId` is absent or equals `CURRENT_USER.id`. Exclude issues assigned to another user.
   Compare `assigneeId` only; never compare assignee display names. Sort by identifier; if empty,
   stop with no side effects.
3. Read the full transitive dependency graph of every eligible issue. Read each dependency issue's
   labels and status. If an unresolved dependency has the `ready-for-human` label, STOP before
   confirmation, claims, config writes, worktrees, or native launch. Output `Dependency graph is
   impossible` and list each blocked eligible issue and its `ready-for-human` dependency. Do not
   ignore the dependency or implement a partial graph.
4. If every eligible issue has the same non-null `parentId`, read that parent by UUID with the Linear
   skill, use its title as `EPIC_GOAL`, and retain its id and identifier as grouping metadata only.
   Otherwise use `ask_user` for a non-empty epic goal; never derive
   it from the label or project. Build `EPIC_SLUG` by lowercasing, replacing non-`[a-z0-9-]` runs
   with `-`, trimming dashes, truncating to 60 characters, then trimming trailing dashes. If a shared
   parent title sanitizes empty, use its sanitized Linear identifier; if manual input sanitizes empty,
   ask again. Set `PLAN_BRANCH=df-${EPIC_SLUG}` and place `PLAN_PATH` under
   `$HOME/Dev/worktrees/<main-repo-name>/df-${EPIC_SLUG}` as defined in Phase 1, then validate with
   `git check-ref-format --branch`. Apply the integration override resolution above now,
   before displaying the preview or creating any worktree. If this prompt process has a non-empty `HERDR_PANE_ID`,
   best-effort rename only that pane to the exact `EPIC_GOAL`: run
   `[ -z "${HERDR_PANE_ID:-}" ] || herdr pane rename "$HERDR_PANE_ID" "$EPIC_GOAL" >/dev/null 2>&1 || true`.
   Never discover, infer, or rename the focused, current, worker, or another pane. A missing
   Herdr CLI or socket must produce no output and must not change the run.
5. Freeze sorted child records as **SELECTED_ISSUES**, exactly
   `[{ "id": "<Linear UUID>", "identifier": "TEAM-123", "title": "Issue title", "parentId": "<parent UUID or null>" }]`.
   Separately freeze **SELECTION_PREDICATES** from these same sorted records as
   `[{id,status,projectId,labels}]`, with each labels array sorted. Do not add these fields to
   SELECTED_ISSUES. Keep both snapshots in the original parent evidence.
   A common parent may supply `EPIC_GOAL` and visualization/grouping context only. Never add that
   parent to SELECTED_ISSUES, dependency waves, tracker mutations, or implementation branches.
   Display an **Issue selection preview** containing epic goal, proposed integration branch, selector,
   Linear project, every selected issue as `<identifier> — <title>`, and the unassigned count that
   will be claimed. Use `ask_user` for an explicit **Proceed / Cancel** confirmation. Cancel ends
   without config writes, claims or other Linear mutations, branch/worktree,
   continuity loop, or native launch.
6. After Proceed, batch-read every frozen identifier again and reapply steps 2 and 3.
   Call `confirmSelection(SELECTED_ISSUES, currentRecords, config, true, SELECTION_PREDICATES)`;
   require `proceed:true`. This detects even a change between two eligible statuses.
   Require the same
   parent-aware result's explicit parent UUID or confirmed absence to
   equal `selectedIssue.parentId`. If any issue disappeared, changed
   project/label/status/parent, or became assigned to another user, perform no mutation and return
   to the Phase 0 candidate query for a fresh preview and confirmation.
7. Persist any newly inferred project now. For each still-unassigned confirmed issue call
   `updateIssue(identifier, { assigneeId: CURRENT_USER.id }, LINEAR_PROFILE)`; never update an issue
   assigned to another user. Batch-read the full confirmed set once more and require the original
   project/label/status/parent predicates plus `issue.assigneeId === CURRENT_USER.id`. Claiming is
   best-effort because Linear has no compare-and-set assignment operation. If any claim failed or
   drifted, start no implementation infrastructure and return to the candidate query for a fresh
   preview and confirmation.

Pass `selectedIssues`, separate `selectionPredicates`, `currentUserId`, `epicGoal`, and `epicSlug` unchanged into the immutable
native manifest described in Phase 2. It is the single input authority.

## Phase 1 — Create the plan worktree (parent only)

Apply Graph dashboard reporting to plan identity/setup and its clearing conditions; preserve baseline dirt and all existing setup gates.

For non-Linear trackers, retain the existing `df-plan-<LABEL_SLUG>` branch and worktree behavior;
the epic-derived values in this phase apply only to Linear.

Before creating/reusing the plan worktree, inspect `git status --porcelain` in the source worktree.
Apply the Generated CodeSight policy there first. When unrelated changes are also present, stage
`.codesight/` and use `git commit -S --only -- .codesight` so those unrelated staged/unstaged changes
remain untouched. Recheck status; `.codesight/` must not remain a reason to stop Phase 1.

Use the already validated slug, not the raw label, in shell setup. Shell-quote resolved values
when constructing commands; never paste tracker text into executable shell source.

```bash
set -e
SRC="$(git rev-parse --show-toplevel)"
LABEL_SLUG="<LABEL_SLUG>"
[ -n "$LABEL_SLUG" ] || LABEL_SLUG="label"
TRACKER="<TRACKER>"
EPIC_SLUG="<EPIC_SLUG>"
GIT_COMMON_DIR="$(git -C "$SRC" rev-parse --git-common-dir)"
case "$GIT_COMMON_DIR" in /*) ;; *) GIT_COMMON_DIR="$SRC/$GIT_COMMON_DIR" ;; esac
REPO_NAME="$(basename "$(dirname "$GIT_COMMON_DIR")")"
WORKTREE_ROOT="$HOME/Dev/worktrees/$REPO_NAME"
# Already resolved, including any validated integration override, before preview.
DEST="<PLAN_PATH>"
BRANCH="<PLAN_BRANCH>"
PARENT_BRANCH="<PARENT_BRANCH>"
if git show-ref --verify --quiet "refs/remotes/origin/$PARENT_BRANCH"; then
  PARENT_REF="origin/$PARENT_BRANCH"
elif git show-ref --verify --quiet "refs/heads/$PARENT_BRANCH"; then
  PARENT_REF="$PARENT_BRANCH"
else
  echo "$PARENT_BRANCH does not exist locally or on origin; stop and ask again." >&2
  exit 2
fi
git check-ref-format --branch "$BRANCH" >/dev/null || {
  echo "$BRANCH is not a valid git branch name after slug sanitization; stop and ask." >&2
  exit 2
}
mkdir -p "$(dirname "$DEST")"
if [ -d "$DEST" ]; then
  DEST_ABS="$(cd "$DEST" && pwd -P)"
else
  DEST_ABS="$(cd "$(dirname "$DEST")" && pwd -P)/$(basename "$DEST")"
fi
find_existing_worktree() { git worktree list --porcelain | awk -v branch="refs/heads/$BRANCH" '
  $(1) == "worktree" { sub(/^worktree /, ""); wt = $(0) }
  $(1) == "branch" && $(2) == branch { print wt; exit }
'; }
EXISTING_WORKTREE="$(find_existing_worktree)"
if [ -n "$EXISTING_WORKTREE" ] && [ ! -e "$EXISTING_WORKTREE" ]; then
  echo "$BRANCH has stale worktree metadata at $EXISTING_WORKTREE; pruning metadata only." >&2
  git worktree prune
  EXISTING_WORKTREE="$(find_existing_worktree)"
fi
if [ -n "$EXISTING_WORKTREE" ]; then
  if ! EXISTING_ABS="$(cd "$EXISTING_WORKTREE" 2>/dev/null && pwd -P)"; then
    echo "$BRANCH has an unreadable existing worktree at $EXISTING_WORKTREE; ask before touching it." >&2
    exit 2
  fi
  if [ "$EXISTING_ABS" = "$DEST_ABS" ]; then
    DEST="$EXISTING_WORKTREE"
    echo "Reusing existing plan worktree $DEST"
  else
    echo "$BRANCH is already checked out at $EXISTING_WORKTREE, not $DEST; stop and ask before touching it." >&2
    exit 2
  fi
elif [ -e "$DEST" ]; then
  echo "$DEST exists but is not the $BRANCH worktree; stop and ask before touching it." >&2
  exit 2
elif git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  git fetch origin
  git worktree add "$DEST" "$BRANCH"
else
  git fetch origin
  git worktree add "$DEST" -b "$BRANCH" "$PARENT_REF"
fi
git -C "$DEST" rev-parse --is-inside-work-tree >/dev/null || {
  echo "$DEST is not a git worktree; stop and ask before touching it." >&2
  exit 2
}
[ "$(git -C "$DEST" branch --show-current)" = "$BRANCH" ] || {
  echo "$DEST is not on $BRANCH; stop and ask before touching it." >&2
  exit 2
}
# CRITICAL — env-file seeding. Worktrees lack uncommitted/gitignored files; verify would
# falsely fail without them. Preserve existing env files in reused/resumed worktrees:
( cd "$SRC" && find . -type f \( -name '.env' -o -name '.env.*' \) \
    -not -path '*/node_modules/*' -not -path '*/.git/*' \
    | sed 's|^\./||' ) | rsync -a --ignore-existing --files-from=- "$SRC/" "$DEST/"
```

- If the intended plan worktree path (`$DEST`) already exists on the matching branch, reuse it
  without asking. Before stopping, exhaust non-destructive self-heal steps: prune stale worktree
  metadata only when the recorded path is missing, then recheck existing branches/paths. If
  the resolved `$PLAN_BRANCH` is still checked out anywhere else, or if the target path exists but is not
  that worktree (wrong/corrupt/path conflict), ask before touching it.
- Record **PLAN_BRANCH** = `$BRANCH`, **PARENT_BRANCH**, **PLAN_PATH** = absolute path of the plan
  worktree, **SRC_PATH** = `$SRC`, **REPO_NAME**, **WORKTREE_ROOT**, and **LABEL_SLUG**. For Linear
  also retain **EPIC_SLUG**.
  Every issue worktree branches from `PLAN_BRANCH`; `PLAN_BRANCH` remains targeted for merge into
  `PARENT_BRANCH`.

## Phase 2 — Native parent hub

Apply Graph dashboard reporting before actual role launches and after each boundary decision; include Inventory, waves, Review, integration checks, CriteriaRepair, and attestation.

You are the only coordinator. Use `agent_spawn`, `agent_spawn_graph`, `agent_status`,
`agent_wait`, `agent_send`, and `agent_stop` from pi-agents. Read their actual schemas and
the available `pi-agents` skill instruction before use. Resolve that skill through the active
public skill catalog, not a personal profile path. If it is unavailable, report the prerequisite
gap and stop before side effects; do not substitute another executor.
Do not call or import dynamic-workflow tools, a saved workflow, WorkflowCreate, or another
executor. The helper below validates data and writes files; it cannot execute work.
Keep tracker operations, plan-branch writes, commits, merges, and publication in the parent.
Workers have built-in tools only. A Bash tool is not a sandbox. Give each worker only the
minimum necessary issue context; never send credentials or unrelated conversation history.
Use `delegate: false`, explicit tools, and explicit skills. Relay messages yourself only when
a recipient needs the information. Never use graph `after` edges: they forward private results
and release successors after completion, not verified success.

### Recover first; do not duplicate

Before new selection side effects on a repeated invocation, inspect the plan's existing
`.df-ticket-hub` run and the exact original parent session. Also inspect existing issue branches,
tracker checkpoints, and the legacy `.df-implement-issues/<LABEL_SLUG>.jsonl` journal. A missing
native manifest does not prove a fresh job. If legacy or unowned work exists, inspect its owner
and two independent checkpoint signals before proceeding. Without a verified ownership handoff
and recoverable immutable inputs, report the migration/recovery blocker; never start Inventory
and implementation again or invoke an old executor to hide the gap. A matching label/plan run remains
owned by that session. Persist the actual parent session ID AND session file, not a guessed
latest-session path. A `--no-session` parent cannot run this command durably: stop before claims.
Use session/runtime metadata or the explicit resume path; never infer identity from file recency.
If another parent owns a matching run, resume that parent rather than take over work here.

Call native tools directly, not through codemode: its shortened output omits IDs and stop reasons.
Use `agent_status` in that parent for the recorded graph/worker names and verify their IDs.
Obtain each exact direct tool-call ID from that original session's tool-call metadata. Use helper
`native RUN_DIR request.json` with `{toolCallId, names:[<owned names>], expectedIds:{<name>:<id>}}`
to read ONLY that call's persisted receipt. Omit expectedIds only for initial allocation. This
reads original parent `toolResult.details`, not native storage internals. It rejects missing,
ambiguous, failed, or non-native receipts; it does not choose the latest call/session. Save the
receipt privately, then journal its IDs. Never use a same-named worker from a different call/run.
If the runtime does not persist full direct tool details, stop with that exact recovery gap.
Leave working agents alone. A timed-out wait or missing delivery is not failure. An idle/answered
worker can have partial, failed, skipped, or interrupted work: inspect its result and real effects.
`agent_send` continues the existing worker; new roles use fresh workers. Never recreate an
uncertain graph or spawn just because an answer was lost. Inspect status for the recorded unique
name even if a crash occurred between spawn and recording its returned ID.

On restart, use the manifest's frozen command/role bytes, not today's templates. Check the input
hash and journal first. Native history owns execution state. The journal owns ticket evidence,
not a second worker scheduler. Native recovery can report an interrupted Bash call without
repeating it. Inspect partial changes before an explicit continuation. Preserve the 2 Inventory,
3 Implement, 3 Review, and 2 CriteriaRepair attempt limits across restarts; retries do not reset them.
Do not repeat completed implementation to repair JSON formatting; request corrected output from
the same worker. A verification-boundary acknowledgement or output-format correction is a stage
continuation within the recorded attempt, not a new attempt. An unexpected failed verification
or a settled failed role ends that attempt. Before corrective work, append the next attempt;
never reset its issue-role count by changing worker name, model, graph, or session. Planned
baseline checks and deliberately failing regression tests are not failed implementation attempts.
Record why a failing check is expected; never relabel an unexpected failure to avoid the budget.

Stock `agent_send` cannot change model or thinking. For uncertainty, inspect/recover the exact
recorded worker first; never spawn a replacement to escape a lost answer or uncertain effects.
For a proved settled failed attempt, inspect its partial changes and persist the failure evidence.
If Review or CriteriaRepair requires escalation, reserve the next attempt within the same role
budget and spawn a fresh uniquely named worker with the frozen escalation model/thinking and
only the inspected remaining work. Record both identities and the handoff. Leave the old worker
idle/stopped, and never send it further work. If settings need no change, use the original worker.
A new Review pass uses a fresh read-only reviewer and consumes the next Review attempt.
A successful boundary alone does not permit replacing an uncertain worker.

If native resume is unavailable, reconstruct the earliest incomplete role from at least two
agreeing independent sources: tracker chronological comments, git commits/ancestry, and the
journal. A Review start comment plus journal identity and implementation commit can establish
that Inventory/Implement are complete. Raw review and readback receipts remain required.
On disagreement, use the earlier safe checkpoint without discarding work. Unknown prior effects
require inspection, not an automatic retry. If the original session cannot be inspected, report
that exact recovery blocker; do not claim exactly-once execution or rerun the whole command.

### Freeze inputs and deterministic gates

For a fresh run, use only the standard-library DF helper resource path supplied by the loaded
`agent_graph_dashboard` extension guidelines. Treat the path as data and shell-quote it before
use; do not resolve it from cwd, a personal profile, or a latest-run search. If the resource path
is missing or the file is unavailable, report the prerequisite gap and stop before side effects.
Existing runs retain their original frozen helper and command bytes.

```text
HELPER=<shell-quoted exact DF helper resource path from extension guidelines>
RUN_DIR=<PLAN_PATH>/.df-ticket-hub
node "$HELPER" init "$RUN_DIR" <input.json>
node "$HELPER" check "$RUN_DIR"
node "$HELPER" append "$RUN_DIR" <event.json>
node "$HELPER" validate "$RUN_DIR" <request.json>
```

Read the helper completely to use its exact field shapes. `init` exclusively creates RUN_DIR;
existing directories require recovery, never overwrite. `manifest.json` is immutable and
`journal.jsonl` is append-only with chained hashes. `init` also freezes exact helper bytes as
`RUN_DIR/helper.mjs`. After init, set HELPER to that frozen copy for every check/validation/recovery.
Verify its bytes equal manifest.input.helperBytes before execution, and compare the manifest hash
with the hash recorded in the original parent session. Template/helper upgrades never change a run. A partial file or stale `.append-lock` after
a crash requires inspecting original-session liveness and the exact last write before repair;
never delete it merely because time elapsed. Preserve the original damaged bytes as an artifact.
A local exclusive directory prevents two parents from creating this run on this host; it is not
a distributed tracker lock. Keep the run directory private and out of commits. Never snapshot
env-file contents, credentials, or unrelated comments. Do not weaken required evidence to fit.

Input shape (all values come from verified Phase 0/1 facts):
- `version: 1`, unique `runId`, `parentSessionId`, absolute `parentSessionFile`.
- `config`: `tracker`, `trackerConfig` (including `terminal` as an array of configured terminal
  status names), `label`, `labelSlug`, optional `issueId`, `parentBranch`, `planBranch`, `planPath`,
  `srcPath`, `repoName`, `worktreeRoot`, `verifyCmd`,
  `maxIssueConcurrency` (default 3, integer 1 through 4). For Linear add `currentUserId`,
  `epicGoal`, `epicSlug`. Keep Linear `projectId` in trackerConfig. Other trackers do not need
  Linear fields. Resolve code host separately at publication.
- `selectedIssues`: for Linear, the exact sorted four-field confirmed allowlist from Phase 0.
- `selectionPredicates`: for Linear, the separate sorted pre-confirmation predicate snapshot
  from Phase 0. Retain it unchanged through claim readback and initialization.
- `issues`: parent-read normalized records for ALL four tracker backends, sorted by identifier;
  each has `id`, `identifier`, `title`, `body`, relevant `comments`, `criteria` (exact strings),
  `dependsOn` (IDs), `riskHints`, unique `safeIssueSlug`, `labels`, and `status`. Linear records
  also have explicit `parentId`, `projectId`, and claimed `assigneeId`. Keep raw read artifacts
  for independent comparison. Slugs use lowercased non-alphanumeric runs replaced by `-`,
  trim ends, fallback `issue`; on collision append sanitized id and reject any remaining collision.
- `dependencies`: complete parent-read transitive dependency records, including labels/status
  and `dependsOn`. Resolve external nonterminal prerequisites before waves; do not silently drop
  them. Missing records, cycles, or unresolved ready-for-human block the whole selection.
- `helperBytes`: the exact bytes of the extension-supplied helper resource used for initialization.
- `commandBytes`: the complete exact bytes of this private command; `roles`: Inventory, Implement,
  Review, CriteriaRepair, each with complete self-contained `instructions`, exact available
  `model`, and `thinking`. Review and CriteriaRepair also require `escalation:{model,thinking}`
  for their big configuration; both normal and escalated choices are immutable.
  The common worker contract and role text below MUST be in those bytes.
  Freeze medium/big model mappings from available native models before work; big reviews use a
  stronger model or explicitly higher reasoning. If unavailable, ask rather than silently lower
  the review standard. Resolve mappings once. Inventory uses a fresh worker; Implement is medium;
  Review/CriteriaRepair escalate for risk, retries, uncertainty, failed verification, or conflicts.

The integration override is already resolved before preview and Phase 1. Recheck its actual
worktree root, common git directory, and checked-out branch here; do not change the target now.
Record the same branch/path/parent values in config and trackerConfig.integrationOverride.
The helper checks data, not git state.

Read all selected issues, full criteria, and dependencies with the configured backend in the
parent. For non-Linear retain open ready-for-agent AND selected-label discovery; no invented
Linear project or claim gate. Freeze the resulting scope before worker launch. The Inventory
worker receives only this snapshot, never tracker tools. After Inventory, changing scope requires
fresh selection/confirmation where applicable, not editing the frozen manifest.

`init` must succeed before issue worktrees or native workers. Phase 0 claims and Phase 1 plan
worktree retain their original ordering. Append `run_started` is critical; helper failure stops.
Record bounded `agent_activity` at role start/check/result with issue/role and no raw diff or
secrets. Persist full evidence in separate mode-0600 artifacts; journal stores paths/hashes.
Later journal failure withholds the next gate until repaired; report missing events truthfully.

Pre-init exception: the original ordering permits Phase 0 fetch and exact-pane rename,
confirmed project-config persistence and Linear claims, Phase 1 CodeSight commits/worktree
setup/env seeding before RUN_DIR exists. It permits no issue coding,
issue worktree, worker launch, attestation, push, or PR/MR. Choose runId and persist the intended
scope/content in the durable original parent session before each permitted effect. Save actual
readbacks there, including claim assignee/project/labels/status/parent, config bytes, git SHAs,
worktree identity as applicable; never include env contents. After a crash before
init, inspect those session records AND live tracker/git/config state before any retry.
A missing manifest is not evidence that a claim or setup failed. Reuse a verified prior effect;
if ownership or effect is ambiguous, block that mutation. After init, import each verified prior
effect as a private receipt artifact and append `receipt`/`reconciled` events with its operation
identity. Label it pre-init imported evidence; never invent an earlier journal intent. Import
must finish before worker launch. These readbacks reduce duplicates; they are not a transaction.

After init, before every external mutation, append `intent` with `operationId = hashJson({runId, issueId,
stage, pass, sha})`; record the exact intended content in a private artifact. For every verification
comment, set `stage = JSON.stringify(["verification", role, attempt, boundaryId])` and
`pass = attempt`. Use role `Implement`, `Review`, or `CriteriaRepair` for worker checks and
`Parent` for parent checks. Parent checks use a persisted positive attempt number and a unique
boundaryId within that attempt across all parent check phases. Worker boundaryId is unique
within its issue/role/attempt, including review fixes and repair checks. Persist this tuple before
posting; recovery reuses it unchanged. Never use only `verification` as stage: two checks can
share the same role, attempt, and SHA. Include an operation
marker in tracker comments before their final clean line. After mutation, read it back and save
`{operationId, readback:true, remoteId, contentHash:hashJson(exactContent)}` as a receipt, then
append `receipt` with its path. If a result is uncertain, search the remote first by marker and
exact content. One matching effect is reused; multiple or ambiguous matches block replay.
For checkboxes/status compare the current exact body/state before changing it. Linear claims
remain best-effort without CAS. This protocol also applies to push and PR/MR creation; the
readback is remote SHA and exact source/target, not a comment marker. Never invent receipts.

### Continuity and cancellation

Apply Graph dashboard reporting on owned wake/recovery boundaries and after verified cancellation; the reporter does not schedule or stop workers.

Before launching, use `LoopList` and reuse one 5-minute parent wake bound to run hash, original
parent session, LABEL, and PLAN_PATH. If absent, use `LoopCreate` with `trigger: "5m"`,
`recurring: true`, `maxFires: 288`. This is observation/continuation in the SAME parent, not a
worker scheduler. Do not place task execution code in it. It checks the original native status,
leaves active workers alone, recovers completed/failed stages here, and resumes publication.
Record its ID with a `continuity` journal event. Deduplicate only exact matching owned loops.
If parent wake tools are unavailable, report timed-continuity parity as unavailable before launch;
do not silently substitute another controller. Native delivery alone does not provide a timer.
On every fire, report slices completed/total and floor percent only if native counts exist;
otherwise say unknown. Report each active role and last 3 chronological `agent_activity` entries,
or `No durable activity checkpoint yet`. Never infer transcripts from graph state.
On explicit Cancel, stop all recorded graph/worker identities, verify termination, record cancelled,
leave branches and evidence intact, and pause/delete only this run's wake as appropriate. A wait
cancellation alone does not stop workers. Temporary
user-authority blockers pause the wake. Delete the wake only after verified publication or terminal
failure/cancellation. A normal or unchanged wake does not delete it.

### Readable native worker and graph names

For a new run, name every issue worker
`<context>-<issue-ref>-<issue-title>-<role>-<run>-a<attempt>`.
Use frozen EPIC_SLUG for Linear context, otherwise frozen LABEL_SLUG. Slug each text component
by lowercasing, replacing non-`[a-z0-9]` runs with `-`, and trimming end dashes; use `issue` if
empty. Bound context to 24 characters, issue-ref to 16, and issue-title to 32, then trim trailing
dashes. Derive issue-ref and issue-title from the frozen identifier and title, not batch position.
Roles are `implement`, `review`, and `criteria-repair`; run is the first 8 manifest-hash characters.
For example: `graph-test-1-add-normalizename-implement-9c4e27b1-a1`.
Inventory has no issue: use `<context>-inventory-<run>-a<attempt>`. Batch graphs use
`<context>-wave-<wave>-batch-<batch>-<run>` with positive wave/batch numbers.
Validate the full name against the actual native schema and uniqueness in the original session.
On a collision, stop before appending an attempt or dispatching. Report the conflicting frozen
issue IDs; never consume retry budget or change an existing worker's name to resolve a collision.
If its length limit requires shortening, shorten title then context while retaining issue-ref,
role, run suffix, and attempt. Record the exact final name before dispatch. A new
worker for a proved-failure retry uses its recorded attempt number. Every `agent_send` retains
the original worker name, even when its issue-role attempt counter advances.
These names are recovery identities, not just display labels. Never rename or replace workers
in an existing run to adopt this convention. Resume their original recorded names and IDs.

### Common worker contract and structured evidence

Each frozen task includes role, run hash, issue id/ref/title, exact full issue scope/criteria,
needed dependency facts (only reviewed public summaries), expected base SHA, branch/worktree,
VERIFY_CMD, allowed paths, relevant project instructions, and signed-commit authority boundary.
Workers never mutate trackers, plan branch, remote, or manifests. Parent commits after
verification. Workers never read env contents into responses. Implement/repair tools are
`["read","bash","edit","write","grep","find","ls"]`; Review/Inventory use only
`["read","grep","find","ls"]`. Parent supplies exact diff files to read-only reviewers.
Use `delegate:false`, `skills:[]` unless a specific applicable local skill is needed.
Return strict JSON without fences; parent saves the exact answer. No native result schema is
assumed. For a review, return a JSON string field `raw` containing full raw review text.

A command proof is `{command, output, exitCode:0, sha:<full HEAD>}` with actual exact command and
relevant output, not a claim of green. A criterion is `{text:<exact original>, verified:<boolean>,
proof:<command proof>}`; leave false when no concrete check passes. Never rename criteria.
Implementation/repair result is `{status:"success", issueId, branch, sha, summary, verification,
criteria, evidence}`. Failed/partial work returns a non-success status and actual failure evidence.
Evidence accepts string, flat string array, or JSON object normalized by the helper; malformed
output is a result error, not a reason to destroy or redo implementation. Worker reports use the
current SHA; after parent commit, rerun/rebind checks to the real new SHA. The parent validates
implementation and independently runs VERIFY_CMD before treating it as successful.

For validation write `{kind, issueId, sha, result}` to a private JSON file and run helper `validate`.
Kinds are `native`, `inventory`, `implementation`, `review`, `criteria`, `attestation`,
`publication`, `recovery`, and `batch`. For `native`, also supply expected `workerId` and use the
full direct receipt's AgentInfo as result. It requires matching ID, idle state, and stopReason stop;
truncated/aborted/error results cannot advance. Parse its full `result.text` only after this gate.
For `recovery`, result includes `parentSessionId, workerName, workerId, observedWorkerId, role,
issueId, attempt, state, signals`. Omit issueId only for run-scoped Inventory. The helper binds
these to the manifest and recorded attempt/native_allocated events, not caller-supplied expected
identities. Record role, issueId, attempt, workerName, and workerId on every allocation or retry
binding. Native live state and independent git/tracker signals still require parent inspection.
Failures block the relevant gate. Booleans in JSON do not substitute for parent-observed evidence.

### Inventory and dependency waves (at most 2 attempts)

Spawn one fresh read-only Inventory worker with the frozen normalized issue/dependency records.
Task: return `{waves: Issue[][], impossibleDependencies: string[]}`. Each Issue has exactly `id`,
`trackerRef` (identifier), `title`, `safeIssueSlug`, `criteria`, `dependsOn` (selected IDs only),
`riskHints`. It must contain every frozen identity once, no parent grouping issue, no aliases,
and only earlier-wave dependencies. If no criteria are listed, preserve the empty array and
verify the done-condition from the full issue body with concrete checks; never invent checkboxes.
If an unresolved external prerequisite exists, return it in
impossibleDependencies. Parent compares all external dependencies too; validation cannot infer
live tracker facts. Run helper inventory validation. An impossible dependency stops the entire run
with `Dependency graph is impossible`; do not implement a partial graph. Persist validated inventory
as an immutable artifact and journal its hash/path. Preserve its exact bytes on recovery.

### Implement within one wave (at most 3 attempts per issue)

For each wave, evaluate dependencies from parent-verified integration records. Failed implementation,
failed review, partial/aborted/skipped output, or absent evidence skips its dependents and flags
those issues in the parent. A verified merged branch with only criteria proof still missing may
serve as a dependency, but never counts as Done. `dependencyReady` requires merge ancestry,
plan verification, and review bound to the integrated SHA. Graph state alone never qualifies.

Parent moves each ready issue to configured active status (or start log if no active primitive),
and posts intent plus expected verification commands before coding. Parent creates/reuses each
`WORKTREE_ROOT/df-issue-<safeIssueSlug>` branch from PLAN_BRANCH using Phase 1's exact non-destructive
reuse/prune/path checks. Branch already exists: continue its partial work. Seed missing `.env` and
`.env.*` files from SRC_PATH with `rsync --ignore-existing` exactly as Phase 1; never overwrite a
reused env file. Verify common repository, branch, and dependency ancestry before allowing writes.

Split ready issues with helper `batches(ready,maxIssueConcurrency)`; default 3, maximum 4. One issue:
`agent_spawn`. Two through four: `agent_spawn_graph` with independent nodes, no `after`, no
merge/attest/finalizer node. Every task is self-contained, cwd is its verified issue worktree,
and names follow Readable native worker and graph names above. Run batch validation before native spawn.
The model request cap is not an issue concurrency limit. Record the graph name with the batch
intent BEFORE dispatch too, so native receipt lookup can verify ownership. Inspect individual
worker returns with direct status/wait calls while the batch runs. Service each verification
boundary below before allowing that worker to continue. Finish all stages of the whole batch
before launching the next; finish implementation for the whole wave before serial review/integration. Record attempt/name
BEFORE dispatch: Implement/Review/CriteriaRepair require selected issueId; Inventory is run-scoped
and omits issueId. Record native worker/graph IDs immediately afterward (`native_allocated`). An uncertain
spawn must be resolved by querying original-session status before any retry.

Implement task: inspect partial work and project instructions; run existing tests first, add a
failing regression test for new logic, implement only the issue, and check each exact acceptance
criterion. Follow the verification-boundary protocol below after EVERY verification command,
including baseline, expected-red regression, repair, and criterion checks. Do not verify until
green in one uninterrupted worker turn. Do not commit or touch tracker/plan/remote.

After each check, stop and return strict JSON
`{status:"verification_boundary", issueId, boundaryId, attempt, branch, sha, command, output,
exitCode, expectedFailure, summary, nextStep}`. Use a unique boundaryId within the attempt;
include actual exitCode, output, and the current HEAD (the parent also inspects uncommitted diff).
This is an intermediate return, not implementation success. Do not fix, edit, or run another
verification command until the parent acknowledges this exact boundary. The parent validates
the native receipt and scope, saves the result, posts the chronological check comment immediately,
and reads it back. Only then authorize the next stage. For a stage continuation, send the same
worker a bounded `agent_send` acknowledgement with boundaryId and receipt identity. For a proved
failed attempt that needs different settings, use the fresh-worker escalation procedure instead.
If the tracker write is uncertain, inspect/read back first;
leave that worker idle until resolved. Do not wait for other batch workers before posting.
For an unexpected failure, record result_rejected and reserve the next role attempt before the
fix; stage-only acknowledgements use agent_activity and do not debit attempts. On restart,
inspect the latest native result and tracker receipt before sending; do not repeat a delivered
continuation. The parent applies the same post/readback-before-fix order to its own checks.
This protocol also applies to review fixes and CriteriaRepair, not only the initial Implement.

After acknowledgement of all required checks, return the final implementation result with
changes, command/output evidence, and current SHA. Parent reads diff and checks, posts any new
verification/failure log immediately, stages only explicit job-related paths, signs a commit whose
message references the tracker ref, handles generated CodeSight output, reruns checks at HEAD,
and posts commit/SHA and criterion proof. Preserve unrelated staged/unstaged work. Reuse the same
worker with `agent_send` for bounded fixes. Exhausted attempts flag active, not Done.

### Serial review, fixes, integration, and criteria repair

Only the parent writes PLAN_PATH. For each valid implementation in this wave:
1. Persist/post Review start with exact diff and worker/run identity. Supply `git diff` and relevant
   file artifacts for the exact issue HEAD and integration base to a fresh read-only Review worker.
   Review is the final implementation phase. Task: adversarial correctness/security/test/edge-case
   review, every finding severity/file/line, prior fixes/checks, pass identity and exact SHA/diff.
   Clean raw text ends in a standalone final line exactly `No issues found`. `CLEAN` is invalid.
2. Save the full raw output. Immediately post a SEPARATE chronological tracker comment for this
   pass, with same identity, findings, exact diff, prior fixes/verification, artifact/session path,
   operation marker, and Linear branch fields. Read back before any fix/next pass. Do not delay
   all review comments until a graph finishes. A comment posting failure withholds this gate;
   preserve intended text and repair it without fabricating a receipt.
3. Findings: send only the needed findings to the existing implementation worker on its branch.
   Parent verifies, signs fixes, posts verification/commit, then gets another review. Maximum 3
   review attempts; risk terms (auth, security, payment, migration, data loss, infra, production
   config, secret, credential, permission, privacy), any retry/uncertainty/failed verify/conflict
   require big model/high reasoning. When the budget is exhausted, flag active and block dependents.
4. Build the parent review record `{issueId,sha,baseSha,pass,reviewer,workerId,raw,comment,commentId,
   readback:true,findings:[],priorFixes,artifact}` from actual raw output and remote readback, then
   validate `review`. Both texts must end exactly clean. Never copy a self-reported clean boolean.
5. Merge serially into PLAN_BRANCH with signed merge commits where needed. Inspect an existing
   merge/dirty state first and continue it safely. Regenerate CodeSight after source conflicts;
   never hand-edit, stash, restore old generated output, or choose ours/theirs as final generated
   result. Parent runs VERIFY_CMD after integration. Conflict/source repairs invalidate review:
   perform a new dedicated review of the resulting changes, comment every pass, fix and verify
   until clean within the recorded review budget. Bind the final review record to actual integration
   HEAD; for a conflict-free merge record both reviewed issue SHA and merge/tree equivalence in
   the evidence, and obtain a final review if equivalence is not proved. Never leave plan red as success.
6. Validate all exact criterion proofs at current integration HEAD. For still-unverified criteria,
   use a fresh CriteriaRepair worker with exact texts, original issue, plan snapshot, and up to 2
   attempts. ALWAYS give CriteriaRepair an isolated branch/worktree under WORKTREE_ROOT,
   based on the inspected current integration HEAD. Never set its cwd or writable paths to
   PLAN_PATH; pausing other writers does not authorize direct worker plan writes. Reuse a verified
   repair worktree after failure and preserve partial work. Before repair launch, the parent
   applies the same Phase 1 non-destructive reuse/prune/path checks as issue setup, verifies the
   common repository, repair branch, and integration-base ancestry, and seeds missing `.env` and
   `.env.*` files from SRC_PATH with the exact Phase 1 `rsync --ignore-existing` snippet
   (SRC=SRC_PATH, DEST=repair worktree). Preserve existing env files on reuse; complete this setup
   before allowing worker writes or checks. The parent inspects, signs, and
   integrates its changes serially. Medium initially, big for risk/retry; use the settled-failure
   escalation procedure above when settings must change. Use verification boundaries for each
   check. If source changes, sign, reverify, and repeat final review at the new integration SHA
   before any attestation. Rebind all proofs to that SHA and post the outcome now.
   Never retain old SHA proofs after a repair. If only proof remains unverified, record
   criteria-unverified, keep active, and allow dependents only on the independently verified merged
   state. If review/plan verification fails, mark failed and block dependents.
7. Attest in parent only after exact criteria validation: check every criterion through native
   editable body preserving text; post each criterion's command/output/current SHA proof; post
   `✅ df-done <sha> — verified + review gate passed, all acceptance criteria checked with proofs,
   landed on <PLAN_BRANCH>`; then configured terminal state. Read back ALL effects and journal
   receipts. Validate `attestation` with actual `{sha, criteria, checkboxes:[{text,checked:true}],
   review, verification, gitAncestor:true, proofCommentId, doneComment, doneCommentId, status,
   readback:true}`. Missing/failed operations retain intended text for Phase 3; no false Done.

Flag operations use the configured tracker too: post why an issue could not complete, exact failed
stage/checks, both Linear branch fields, leave nonterminal. Build a parent `report` for every frozen
issue with implemented/reviewed/criteria/attested/flagged evidence, pending intended mutations,
raw artifact paths, native identities, and actual integrated SHA. No child declares aggregate success.
Proceed to Phase 3 after all waves, including failed/skipped entries; publication waits for full repair.


## Phase 3 — Reconcile (parent evidence report)

Apply Graph dashboard reporting per issue and to the whole-selection publication gate; disagreements remain blocked until both independent signals and required proofs agree.

If `report` contains `status: "impossible-dependency-graph"`, do not resume, implement,
or reconcile a partial graph. Output `Dependency graph is impossible`, list every blocker from
`blockers`, and stop.

A completed native batch does not establish aggregate job success.

Do **NOT** trust the workers' self-reported statuses. This may span several turns — do not
abandon it. Read `report` (not native runtime internals) for every issue that had the
label and gather two independent signals:

- **git signal**: `git log "$PLAN_BRANCH" --oneline --grep '<trackerRef>'` + run VERIFY_CMD,
  both inside PLAN_PATH. Use the display tracker ref, not the branch-safe slug.
- **attestation signal**: collect with the tracker native (Linear skill / `gh` / `glab` / local
  issue-file read): the `✅ df-done <sha>` comment/log entry, the per-criterion proof comment/log,
  every chronological review-pass comment (findings, fixes, final clean pass), the issue's checkbox
  state, and current status. Inspect raw native review output too; result fields alone are insufficient.
  Treat `CLEAN`, `approve`, or any clean summary that does not end with that exact standalone line as missing review evidence.

| Condition | Action |
|---|---|
| attestation + matching commits + plan green + all criteria checked with proofs | valid Done ✅ |
| attestation, but no matching commit/sha on the plan branch | revert status to the configured active/In Progress state, comment/log the discrepancy |
| Done or checked criteria, but no per-criterion proof comment | uncheck/flag: verify the criteria yourself in PLAN_PATH; check + post proofs if they pass, otherwise revert to the configured active/In Progress state |
| Done/attested, but missing raw review evidence or chronological review-pass comments | revert active/In Progress; run a real dedicated review of the exact diff, post every pass, fix/verify/re-review until clean, then attest again |
| commits, but no `✅ df-done` attestation | do NOT auto-mark Done (review gate unproven); flag for review |
| commits, but plan branch red | fix the plan branch yourself until verify is green (friction, not a stop), then re-evaluate the row above; only if genuinely unfixable, keep active/In Progress and comment/log what fails |
| neither signal | report skipped/blocked |

Also repair tracker mutations that the parent could not finish: scan every report entry's
`implemented`, `reviewed`, `attested`, and `flagged` fields — any with `applied: false` carries
the intended comment/checkbox/status text in `evidence` (a string, or a string array — apply each
item in order); apply those via the Linear skill, `gh`, `glab`, or local issue-file edits now.
A `journal-errors` report entry lists audit events that could not be written; inspect
`.df-ticket-hub/journal.jsonl` in PLAN_PATH and reconcile missing events.

If the original parent process crashed, use Phase 2 recovery with the frozen manifest, exact
parent session, native worker/graph IDs, and two independent signals. Leave working workers alone.
Continue the earliest incomplete role or publication checkpoint; never replay Inventory/Implement
for checkpointed work. Read raw review artifacts and all chronological tracker receipts.

Repairs via tracker natives only. For markdown-backed trackers (GitHub/GitLab/local-file), use
read-modify-write edits that preserve exact checkbox text. Produce the table:
issue → commits → attestation? → criteria checked+proven? → plan green? → final status,
listing every repair and every disagreement between the signals.

Do not proceed to publication until both signals agree for every selected issue. Leave the plan
worktree (`$PLAN_PATH`) in place on `$PLAN_BRANCH`. Continue directly into Phase 4.

## Phase 4 — Publish the integration branch (you, deterministically)

Apply Graph dashboard reporting to final checks, existing authorized publication, and remote readbacks. Include both report links and the absolute export path in the final summary.

Invoking this prompt authorizes signed commits of job-related changes, pushing PLAN_BRANCH to
origin, and opening a PR/MR against PARENT_BRANCH. It does not authorize merging the PR/MR,
automatic merge, force-pushing, or deleting branches.

Run this phase only after Phase 3 confirms that every selected issue has merged into PLAN_BRANCH,
all acceptance criteria have proof, all review gates pass, and VERIFY_CMD passes in PLAN_PATH.

1. Confirm that PLAN_PATH has PLAN_BRANCH checked out and that PLAN_BRANCH differs from
   PARENT_BRANCH. Use the parent branch recorded in Phase 0, not the repository default branch.
2. Inspect staged, unstaged, and untracked files. Preserve unrelated work. Stage explicit paths
   and make signed commits only for verified job-related changes left after reconciliation.
   Apply the existing CodeSight policy. Create no empty commit when all changes are committed.
3. Run VERIFY_CMD against the final committed integration state. If repairs are necessary,
   repeat the applicable verification and review gates, commit the repairs, and verify again.
   Confirm that no job-related source changes remain uncommitted after checks and commit hooks.
4. Push PLAN_BRANCH to origin with upstream tracking. Never force-push. If the remote branch
   has diverged, inspect and reconcile it safely, then repeat verification before retrying.
5. Resolve the code-hosting platform from origin and repository configuration, independently
   of TRACKER. Read the applicable GitLab or GitHub skill; use glab for GitLab or gh for GitHub.
   Find an existing open PR/MR in that repository with source PLAN_BRANCH and target
   PARENT_BRANCH. Reuse it if present; otherwise create one. If multiple matches exist, resolve
   the ambiguity before creating anything. Include the selected issues, change summary,
   verification evidence, and remaining limitations in its description. Preserve human-written
   content when updating an existing description. Do not enable automatic merge.
6. Read the remote branch SHA and PR/MR details from the host. Verify that the remote branch
   SHA matches local HEAD, and that the open PR/MR has the exact source and target branches.
   Record the URL, verified SHA, source branch, and target branch in the final report.
   Validate `publication` using actual `{head, remoteSha, source, target, open:true, url,
   matches:1, diffCount}` from git and host readbacks before the next step.
7. Only after these checks pass, delete CONTINUITY_LOOP_ID and leave PLAN_PATH in place for review.

Do not report the job complete until publication is verified. If publication fails, preserve the
integration worktree and resume this phase from its last verified checkpoint. Inspect the remote
branch and existing PR/MR before retrying an uncertain push or creation result. Do not restart
implementation or create a duplicate PR/MR. Report a missing remote, inaccessible host, or empty
source-to-target diff as a publication blocker rather than claiming an MR exists.
