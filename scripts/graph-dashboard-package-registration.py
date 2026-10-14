#!/usr/bin/env python3
"""Dry by default. One zero-prompt RPC host; one get_commands request; EOF shutdown."""
import argparse
import hashlib
import json
import os
import pathlib
import selectors
import signal
import shutil
import subprocess
import time

SOURCE = pathlib.Path(__file__).resolve().parent.parent
ROOT = None
CLI = None
RUN = None
PROBE = None
DASHBOARD = None
COPY_FILES = ['graph-dashboard-browser.ts', 'graph-dashboard-runtime.ts', 'graph-dashboard-store.ts', 'graph-dashboard-render.ts', 'graph-dashboard-server.ts', 'graph-dashboard-cli.ts', 'df-ticket-hub.mjs']
REQUEST = {'id': 'registration-commands-1', 'type': 'get_commands'}
LIMIT = 35
MAX_BYTES = 1024 * 1024

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

WRAPPER = r'''
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import managed from __MANAGED_EXTENSION__
import relocated from __CANONICAL_EXTENSION__

// The real imported extensions resolve peers through the host loader. This
// recorder captures registration only; it does not implement schema/resource logic.
export default function (pi: ExtensionAPI) {
  const root = process.env.DASHBOARD_REGISTRATION_PROBE_ROOT
  if (!root) throw new Error('Owned evidence root required')
  const captures = [
    { layout: 'managed', register: managed },
    { layout: 'canonical relocated', register: relocated },
  ].map(({ layout, register }) => {
    const tools: { name: string; promptGuidelines: string[] }[] = []
    const commands: string[] = []
    let callbacks = 0
    const recorder = {
      on() { callbacks++ },
      registerCommand(name: string) { commands.push(name) },
      registerTool(tool: { name: string; promptGuidelines?: string[] }) {
        tools.push({ name: tool.name, promptGuidelines: tool.promptGuidelines ?? [] })
      },
    }
    register(recorder as unknown as ExtensionAPI)
    return { layout, tools, commands, recordedCallbacks: callbacks, invokedCallbacks: 0, invokedHandlers: 0 }
  })
  writeFileSync(join(root, 'registration-capture.json'), JSON.stringify({ captures, cwd: process.cwd() }, null, 2), { flag: 'wx', mode: 0o600 })
  // Only witness lifecycle callbacks enter the real host registry.
  pi.on('session_start', () => {
    const names = pi.getAllTools().map(tool => tool.name).sort()
    writeFileSync(join(root, 'registered-tools.json'), JSON.stringify({ source: 'actual-host pi.getAllTools', names }), { flag: 'wx', mode: 0o600 })
  })
  pi.on('session_shutdown', () => {
    writeFileSync(join(root, 'session-shutdown.json'), JSON.stringify({ observed: true, registeredToolNames: pi.getAllTools().map(tool => tool.name).sort() }), { flag: 'wx', mode: 0o600 })
  })
  pi.on('tool_call', () => ({ block: true, reason: 'Registration capture permits no tool calls' }))
}
'''

def wrapper_text():
    return WRAPPER.replace('__MANAGED_EXTENSION__', json.dumps(str(DASHBOARD))).replace('__CANONICAL_EXTENSION__', json.dumps(str(ROOT / 'canonical package with spaces/extensions/agent-graph-dashboard.ts')))

def copy_records():
    files = [(DASHBOARD, ROOT / 'canonical package with spaces/extensions/agent-graph-dashboard.ts')]
    files += [(SOURCE / 'scripts' / name, ROOT / 'canonical package with spaces/scripts' / name) for name in COPY_FILES]
    return [{'source': str(src), 'copy': str(dst), 'sha256': sha(src)} for src, dst in files]

def proposal():
    argv = [CLI, '--offline', '--no-approve', '--no-extensions', '--no-mcp', '--no-skills',
        '--no-context-files', '--no-themes', '--no-builtin-tools',
        '-e', str(PROBE), '--no-session', '--mode', 'rpc']
    env = {'HOME': str(RUN / 'home'), 'TMPDIR': str(RUN / 'tmp'), 'LANG': 'en_US.UTF-8', 'PI_SKIP_VERSION_CHECK': '1', 'PI_CODING_AGENT_SESSION_DIR': str(RUN / 'sessions')}
    node = shutil.which('node')
    if node is None:
        raise RuntimeError('Node.js must be available for the Pi registration check')
    env.update(PATH=str(pathlib.Path(CLI).parent) + ':' + str(pathlib.Path(node).parent) + ':/usr/bin:/bin:/usr/sbin:/sbin',
        PI_CODING_AGENT_DIR=str(RUN / 'agent'), PI_OFFLINE='1', PI_TELEMETRY='0', DASHBOARD_REGISTRATION_PROBE_ROOT=str(RUN))
    return {'argv': argv, 'environment': env, 'cwd': str(RUN), 'request': REQUEST,
        'shutdown': 'close stdin after registry and response, or on failure', 'timeoutSeconds': LIMIT,
        'cleanupGraceSeconds': 2, 'outputLimitBytesPerStream': MAX_BYTES,
        'sourceCopyHashes': copy_records(),
        'scope': 'Registration capture only; zero prompts/tools/target lifecycle callbacks',
        'controllerSha256': sha(pathlib.Path(__file__)), 'probeSha256': hashlib.sha256(wrapper_text().encode()).hexdigest(), 'dashboardSha256': sha(DASHBOARD)}

def proposal_hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()

def group_exists(pid):
    try:
        os.killpg(pid, 0)
        return True
    except ProcessLookupError:
        return False

def cleanup(child):
    # Signal only this live, unreaped leader's verified private process group.
    sent = []
    refused = False
    for sig, grace in ((signal.SIGTERM, 2), (signal.SIGKILL, 2)):
        if child.returncode is not None:
            break
        try:
            owned = os.getpgid(child.pid) == child.pid and child.pid != os.getpgrp()
        except ProcessLookupError:
            child.poll()
            break
        if not owned:
            refused = True
            break
        try:
            os.killpg(child.pid, sig)
            sent.append(sig.name)
        except ProcessLookupError:
            pass
        end = time.monotonic() + grace
        while time.monotonic() < end:
            if child.poll() is not None:
                break
            time.sleep(0.05)
    child.poll()
    return sent, not group_exists(child.pid) if not refused else False

def run(value):
    os.umask(0o077)
    # The caller approves this exact fresh source snapshot before any run writes.
    ROOT.mkdir(mode=0o700, exist_ok=False)
    for record in value['sourceCopyHashes']:
        src, dst = pathlib.Path(record['source']), pathlib.Path(record['copy'])
        data = src.read_bytes()
        if hashlib.sha256(data).hexdigest() != record['sha256']:
            raise RuntimeError('Source changed before staging')
        dst.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        dst.write_bytes(data)
        dst.chmod(0o400)
    PROBE.write_text(wrapper_text())
    PROBE.chmod(0o400)
    canonical = ROOT / 'canonical package with spaces'
    for directory in sorted((p for p in canonical.rglob('*') if p.is_dir()), reverse=True):
        directory.chmod(0o500)
    canonical.chmod(0o500)
    RUN.mkdir(mode=0o700, exist_ok=False)
    for name in ('home', 'agent', 'tmp', 'sessions'):
        (RUN / name).mkdir(mode=0o700)
    (RUN / 'command.json').write_text(json.dumps(value, indent=2) + '\n')
    start = time.monotonic()
    deadline = start + LIMIT
    child = None
    errors = []
    commands = None
    eof = False
    parent_exit_at = None
    signals = []
    group_gone = False
    timed_out = False
    buffer = b''
    sizes = {'stdout': 0, 'stderr': 0}
    selector = selectors.DefaultSelector()
    files = {}
    def close_stdin():
        nonlocal eof
        if child and not eof:
            try:
                child.stdin.close()
                eof = True
            except OSError:
                errors.append('stdin close failed')
    try:
        files = {name: (RUN / (name + '.log')).open('xb') for name in sizes}
        child = subprocess.Popen(value['argv'], cwd=RUN, env=value['environment'], stdin=subprocess.PIPE,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
        selector.register(child.stdout, selectors.EVENT_READ, 'stdout')
        selector.register(child.stderr, selectors.EVENT_READ, 'stderr')
        child.stdin.write(json.dumps(REQUEST).encode() + b'\n')
        child.stdin.flush()  # One small inspect-only record; no prompt, bash, or tool request.
        while True:
            now = time.monotonic()
            if child.poll() is not None and parent_exit_at is None:
                parent_exit_at = now
            if now >= deadline:
                timed_out = parent_exit_at is None
                if selector.get_map():
                    errors.append('stream drain exceeds 35-second bound')
                break
            for key, _ in selector.select(min(0.05, deadline - now)):
                data = os.read(key.fileobj.fileno(), 8192)
                name = key.data
                if not data:
                    selector.unregister(key.fileobj)
                    continue
                remaining = max(0, MAX_BYTES - sizes[name])
                files[name].write(data[:remaining])
                sizes[name] += len(data)
                if sizes[name] > MAX_BYTES:
                    if 'output limit exceeded' not in errors:
                        errors.append('output limit exceeded')
                    continue
                if name != 'stdout':
                    continue
                buffer += data
                while b'\n' in buffer:
                    line, buffer = buffer.split(b'\n', 1)
                    try:
                        record = json.loads(line.rstrip(b'\r'))
                        if not isinstance(record, dict):
                            raise ValueError('object required')
                    except (ValueError, UnicodeError):
                        errors.append('invalid JSONL record')
                        continue
                    kind = record.get('type', '')
                    if kind == 'extension_error' or kind.startswith(('agent_', 'turn_', 'tool_execution_', 'message_', 'compaction_', 'auto_retry_', 'summarization_retry_')):
                        errors.append('unexpected activity/error: ' + kind)
                    if kind == 'extension_ui_request' and (record.get('method') in ('select', 'confirm', 'input', 'editor') or record.get('notifyType') == 'error'):
                        errors.append('unexpected dialog or error notification')
                    if kind == 'response':
                        if record.get('id') != REQUEST['id'] or record.get('command') != 'get_commands' or record.get('success') is not True or commands is not None:
                            errors.append('unexpected or failed RPC response')
                        else:
                            entries = record.get('data', {}).get('commands')
                            if not isinstance(entries, list) or not all(isinstance(c, dict) and isinstance(c.get('name'), str) for c in entries):
                                errors.append('invalid command list')
                            else:
                                commands = [{'name': c['name'], 'source': c.get('source')} for c in entries]
            if errors or (commands is not None and (RUN / 'registered-tools.json').is_file()):
                close_stdin()
            if parent_exit_at is not None and not selector.get_map():
                break
        close_stdin()
        if buffer:
            errors.append('unterminated JSONL record')
    except Exception as error:
        errors.append('controller failure: ' + type(error).__name__)
    finally:
        close_stdin()
        if child:
            if child.poll() is not None and parent_exit_at is None:
                parent_exit_at = time.monotonic()
            signals, group_gone = cleanup(child)
            for pipe in (child.stdin, child.stdout, child.stderr):
                pipe.close()
        selector.close()
        for file in files.values():
            file.close()
    names = []
    shutdown_names = []
    shutdown = False
    try:
        registry = json.loads((RUN / 'registered-tools.json').read_text())
        names = registry['names']
        if registry['source'] != 'actual-host pi.getAllTools' or not isinstance(names, list) or not all(isinstance(n, str) for n in names):
            raise ValueError('invalid registry')
        shutdown_receipt = json.loads((RUN / 'session-shutdown.json').read_text())
        shutdown = shutdown_receipt.get('observed') is True
        shutdown_names = shutdown_receipt.get('registeredToolNames', [])
        if not isinstance(shutdown_names, list) or not all(isinstance(n, str) for n in shutdown_names):
            raise ValueError('invalid shutdown registry')
    except (OSError, ValueError, KeyError, TypeError):
        names = []
        errors.append('missing or invalid probe receipt')
    command_pass = commands is not None and not any(c['name'] == 'agent-graph-dashboard' for c in commands)
    registration = None
    registration_loaded = False
    resource_checks = []
    try:
        registration = json.loads((RUN / 'registration-capture.json').read_text())
        captures = registration['captures']
        registration_loaded = registration['cwd'] == str(RUN) and [c['layout'] for c in captures] == ['managed', 'canonical relocated'] and all(c['invokedCallbacks'] == 0 and c['invokedHandlers'] == 0 and c['commands'] == ['agent-graph-dashboard-open', 'agent-graph-dashboard'] and len(c['tools']) == 1 and c['tools'][0]['name'] == 'agent_graph_dashboard' for c in captures)
        for capture, expected in zip(captures, [str(DASHBOARD.parent.parent / 'scripts/df-ticket-hub.mjs'), str(ROOT / 'canonical package with spaces/scripts/df-ticket-hub.mjs')]):
            prefix = 'DF helper resource (path data, not shell source): '
            lines = [line for line in capture['tools'][0]['promptGuidelines'] if line.startswith(prefix)]
            supplied = None
            if len(lines) == 1:
                supplied, _ = json.JSONDecoder().raw_decode(lines[0][len(prefix):])
            resource_checks.append({'layout': capture['layout'], 'expected': expected, 'supplied': supplied, 'pass': supplied == expected})
    except (OSError, ValueError, KeyError, TypeError):
        errors.append('missing or invalid real registration capture')
    resource_green = registration_loaded and len(resource_checks) == 2 and all(c['pass'] for c in resource_checks)
    tool_pass = 'agent_graph_dashboard' not in names and 'agent_graph_dashboard' not in shutdown_names
    natural = child is not None and child.returncode == 0 and parent_exit_at is not None and parent_exit_at <= deadline and not timed_out and not signals
    unchanged = sha(pathlib.Path(__file__)) == value['controllerSha256'] and sha(PROBE) == value['probeSha256'] and sha(DASHBOARD) == value['dashboardSha256'] and all(sha(pathlib.Path(r['source'])) == r['sha256'] == sha(pathlib.Path(r['copy'])) for r in value['sourceCopyHashes'])
    if not unchanged:
        errors.append('probe/controller/dashboard changed during run')
    result = {'candidateUnchanged': unchanged, 'registeredToolNames': names, 'registeredToolNamesAtShutdown': shutdown_names,
        'registryChangesAfterStart': names != shutdown_names, 'commands': commands,
        'registrationLoaded': registration_loaded, 'resourceChecks': resource_checks, 'helperResourceGreen': resource_green,
        'detachedProcessAbsence': 'unproved; process-group evidence only', 'noLiveDashboardTool': tool_pass,
        'noLiveDashboardCommand': command_pass, 'eofRequested': eof, 'sessionShutdownObserved': shutdown,
        'childReturnCode': child.returncode if child else None, 'timedOut': timed_out,
        'parentExitSeconds': parent_exit_at - start if parent_exit_at else None,
        'naturalExit': natural, 'cleanupSignals': signals, 'ownedGroupGone': group_gone,
        'elapsedSecondsIncludingCleanup': time.monotonic() - start, 'errors': errors,
        'pass': resource_green and unchanged and tool_pass and command_pass and natural and eof and shutdown and group_gone and not errors}
    (RUN / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
    return 0 if result['pass'] else 1

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--pi', required=True, help='Verified absolute public Pi executable; no alias or personal launcher')
    parser.add_argument('--evidence-dir', required=True, help='New absolute private evidence directory; must not exist')
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--approved-proposal-sha256')
    args = parser.parse_args()
    global ROOT, CLI, RUN, PROBE, DASHBOARD
    executable = pathlib.Path(args.pi)
    ROOT = pathlib.Path(args.evidence_dir)
    if not executable.is_absolute() or not executable.is_file() or not os.access(executable, os.X_OK):
        raise RuntimeError('Verified executable must be an absolute executable file')
    if not ROOT.is_absolute():
        raise RuntimeError('Evidence directory must be absolute')
    ROOT = ROOT.resolve()
    if ROOT.exists() or not ROOT.parent.is_dir():
        raise RuntimeError('Evidence directory must be a new absolute path with an existing parent')
    if SOURCE == ROOT or SOURCE in ROOT.parents:
        raise RuntimeError('Keep test evidence outside the source profile')
    CLI = str(executable)
    RUN = ROOT / 'run'
    PROBE = ROOT / 'registration-wrapper.ts'
    managed = SOURCE / 'private_extensions/agent-graph-dashboard.ts'
    DASHBOARD = managed if managed.is_file() else SOURCE / 'extensions/agent-graph-dashboard.ts'
    value = proposal()
    digest = proposal_hash(value)
    if not args.execute:
        print(json.dumps({'execute': False, 'proposalSha256': digest, 'proposal': value}, indent=2))
        return 0
    if args.approved_proposal_sha256 != digest:
        raise RuntimeError('Fresh parent read-before-execute approval hash required')
    return run(value)

if __name__ == '__main__':
    raise SystemExit(main())
