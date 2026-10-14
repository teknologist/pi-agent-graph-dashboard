#!/usr/bin/env node
// Data boundary only. The parent owns native agents and all external operations.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { createInterface } from 'node:readline'

export const stableJson = value => JSON.stringify(value, (_key, child) => child && typeof child === 'object' && !Array.isArray(child)
  ? Object.fromEntries(Object.keys(child).sort().map(key => [key, child[key]])) : child)
export const hashJson = value => createHash('sha256').update(stableJson(value)).digest('hex')
const nonempty = value => typeof value === 'string' && value.trim().length > 0
const shaValid = value => typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)
const safeSlug = value => typeof value === 'string' && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value)
const terminal = (issue, cfg) => cfg.trackerConfig.terminal.includes(issue.status)
const exactClean = value => typeof value === 'string' && /(?:^|\r?\n)No issues found(?:\r?\n)?$/.test(value)
const unique = values => values.length === new Set(values).size
const roles = { Inventory:2, Implement:3, Review:3, CriteriaRepair:2 }

function validateConfig(cfg) {
  assert.ok(['linear','github','gitlab','local-file'].includes(cfg.tracker), 'unsupported tracker')
  assert.ok(cfg.trackerConfig && Array.isArray(cfg.trackerConfig.terminal) && cfg.trackerConfig.terminal.length, 'terminal status mapping required')
  assert.ok(nonempty(cfg.label), 'label required')
  if (cfg.tracker === 'linear') {
    assert.ok(nonempty(cfg.trackerConfig.projectId), 'projectId required')
    assert.ok(nonempty(cfg.currentUserId), 'currentUserId required')
  }
}

/** Normalize backend records in the parent; retain raw records as evidence. */
export function selectIssues(records, cfg, { listed = false } = {}) {
  validateConfig(cfg)
  assert.ok(Array.isArray(records), 'records required')
  if (cfg.tracker === 'linear' && listed) assert.ok(records.length < 250, 'Linear query truncation')
  for (const issue of records) {
    assert.ok(nonempty(issue.id) && nonempty(issue.identifier) && nonempty(issue.title), 'issue identity required')
    assert.ok(Array.isArray(issue.labels) && nonempty(issue.status), 'labels/status required')
    if (cfg.tracker === 'linear') assert.ok(issue.parentId === null || nonempty(issue.parentId), 'explicit parentId required')
  }
  const selected = records.filter(issue => issue.labels.includes('ready-for-agent') &&
    (cfg.issueId ? issue.identifier === cfg.issueId : issue.labels.includes(cfg.label)) && !terminal(issue,cfg) &&
    (cfg.tracker !== 'linear' || (issue.projectId === cfg.trackerConfig.projectId && (!issue.assigneeId || issue.assigneeId === cfg.currentUserId))))
  assert.ok(unique(selected.map(x=>x.id)) && unique(selected.map(x=>x.identifier)), 'duplicate issue identity')
  return selected.sort((a,b)=>a.identifier.localeCompare(b.identifier))
}

export function confirmSelection(frozen, current, cfg, confirmed, predicateSnapshot) {
  if (confirmed !== true) return {proceed:false,reason:'cancelled'}
  const selected = selectIssues(current,cfg)
  const identity = items => items.map(({id,identifier,title,parentId})=>({id,identifier,title,parentId}))
  assert.ok(Array.isArray(predicateSnapshot) && predicateSnapshot.length===frozen.length,'predicate snapshot required')
  const predicates=selected.map(({id,status,projectId,labels})=>({id,status,projectId,labels:[...labels].sort()}))
  return {proceed:stableJson(identity(frozen)) === stableJson(identity(selected)) && stableJson(predicateSnapshot) === stableJson(predicates),selected}
}

export function validateDependencies(issues, dependencies, cfg) {
  const records = new Map([...dependencies,...issues].map(x=>[x.id,x]))
  const selected = new Set(issues.map(x=>x.id)), unresolved = new Set()
  for (const root of issues) {
    const visit = (id, chain) => {
      const item=records.get(id)
      assert.ok(item, `Missing dependency ${id}`)
      assert.ok(!chain.includes(id), `Dependency cycle: ${[...chain,id].join(' -> ')}`)
      if (id !== root.id && terminal(item,cfg)) return
      assert.ok(Array.isArray(item.labels) && nonempty(item.status), 'dependency labels/status required')
      assert.ok(!item.labels.includes('ready-for-human'), `Dependency graph is impossible: ${root.identifier} -> ${item.identifier}`)
      if (!selected.has(id)) unresolved.add(id)
      assert.ok(Array.isArray(item.dependsOn), 'dependency edges required')
      for (const next of item.dependsOn) visit(next,[...chain,id])
    }
    visit(root.id,[])
  }
  assert.equal(unresolved.size,0,`unresolved external dependencies: ${[...unresolved].join(', ')}`)
  return true
}

export function validateInventory(result, issues) {
  assert.ok(result && Array.isArray(result.waves) && Array.isArray(result.impossibleDependencies), 'inventory shape')
  assert.equal(result.impossibleDependencies.length,0,'Dependency graph is impossible')
  const expected=new Map(issues.map(x=>[x.id,x])), seen=new Set(), slugs=new Set()
  for(const wave of result.waves) {
    assert.ok(Array.isArray(wave) && wave.length, 'nonempty wave required')
    const earlier=new Set(seen)
    for(const item of wave) {
      assert.deepEqual(Object.keys(item).sort(),['criteria','dependsOn','id','riskHints','safeIssueSlug','title','trackerRef'])
      const original=expected.get(item.id)
      assert.ok(original && !seen.has(item.id),'unknown or duplicate issue')
      assert.equal(item.trackerRef,original.identifier)
      assert.equal(item.title,original.title)
      assert.deepEqual(item.criteria,original.criteria)
      assert.deepEqual(item.dependsOn,original.dependsOn.filter(id=>expected.has(id)))
      assert.ok(item.dependsOn.every(id=>earlier.has(id)), 'dependency must be in earlier wave')
      assert.ok(safeSlug(item.safeIssueSlug) && !slugs.has(item.safeIssueSlug),'unsafe or duplicate issue slug')
      assert.equal(item.safeIssueSlug,original.safeIssueSlug)
      assert.ok(Array.isArray(item.riskHints) && item.riskHints.every(x=>typeof x==='string'))
      seen.add(item.id);slugs.add(item.safeIssueSlug)
    }
  }
  assert.equal(seen.size,expected.size,'missing selected issue')
  return result
}

export function normalizeEvidence(value) {
  if(typeof value==='string') return value
  if(Array.isArray(value) && value.every(x=>typeof x==='string')) return value
  assert.ok(value && typeof value==='object' && !Array.isArray(value),'evidence must be string, string[], or JSON object')
  const flattened=[]
  const visit=(item,key)=>{
    if(item===null || ['string','number','boolean'].includes(typeof item)) flattened.push(`${key}: ${String(item)}`)
    else if(Array.isArray(item)) item.forEach((child,i)=>visit(child,`${key}[${i}]`))
    else { assert.ok(item && typeof item==='object','invalid evidence leaf'); for(const k of Object.keys(item).sort()) visit(item[k],key?`${key}.${k}`:k) }
  }
  visit(value,'');return flattened
}

export function validateCheck(check, sha) {
  assert.ok(check && nonempty(check.command) && nonempty(check.output), 'concrete command and output required')
  assert.equal(check.exitCode,0,'verification failed')
  assert.ok(shaValid(sha),'full SHA required')
  assert.equal(check.sha,sha,'proof SHA mismatch')
  return check
}

export function validateCriteria(criteria, expected, sha, requireAll = true) {
  assert.ok(Array.isArray(criteria) && unique(criteria.map(x=>x.text)),'duplicate or invalid criteria')
  assert.deepEqual(criteria.map(x=>x.text).sort(),[...expected].sort(),'exact criteria required')
  for(const criterion of criteria) {
    assert.equal(typeof criterion.verified,'boolean')
    if(requireAll) assert.equal(criterion.verified,true,'unverified criterion')
    if(criterion.verified) validateCheck(criterion.proof,sha)
  }
  return criteria
}

export function validateNativeOutcome(worker, expectedId) {
  assert.equal(worker.id,expectedId,'native identity mismatch')
  assert.equal(worker.state,'idle','native worker did not finish normally')
  assert.equal(worker.result?.stopReason,'stop','native result interrupted or incomplete')
  assert.ok(nonempty(worker.result.text),'native result missing')
  return worker.result.text
}

export function validateImplementation(result, issue) {
  assert.equal(result?.status,'success','worker did not succeed')
  assert.equal(result.issueId,issue.id)
  assert.equal(result.branch,`df-issue-${issue.safeIssueSlug}`)
  assert.ok(nonempty(result.summary))
  validateCheck(result.verification,result.sha)
  validateCriteria(result.criteria,issue.criteria,result.sha,false)
  return {...result,evidence:normalizeEvidence(result.evidence)}
}

function validateReviewEvidence(review, sha) {
  for(const key of ['uncertain','needsRepair','verifyFailed']) assert.ok(review[key]===undefined || review[key]===false,`review ${key} blocks success`)
  assert.equal(review.sha,sha,'review invalidated by changed SHA')
  assert.ok(shaValid(sha) && shaValid(review.baseSha),'exact review diff required')
  for(const key of ['reviewer','workerId','artifact','commentId','priorFixes']) assert.ok(nonempty(review[key]),`review ${key} required`)
  assert.ok(Number.isInteger(review.pass) && review.pass>0,'review pass required')
  assert.equal(review.readback,true,'review comment not read back')
  assert.ok(exactClean(review.raw) && exactClean(review.comment),'exact clean conclusion required')
  assert.deepEqual(review.findings,[],'unresolved review findings')
}

export function validateReview(review, sha, cfg, issue) {
  validateReviewEvidence(review,sha)
  assert.equal(review.issueId,issue.id)
  if(cfg.tracker==='linear') {
    assert.ok(review.comment.includes(`Implementation branch: df-issue-${issue.safeIssueSlug}`))
    assert.ok(review.comment.includes(`Integration plan branch: ${cfg.planBranch}`))
  }
  return review
}

export function validateAttestation(receipt, cfg, issue) {
  assert.equal(receipt.readback,true);assert.equal(receipt.gitAncestor,true)
  validateCheck(receipt.verification,receipt.sha)
  validateCriteria(receipt.criteria,issue.criteria,receipt.sha)
  validateReview(receipt.review,receipt.sha,cfg,issue)
  assert.deepEqual(receipt.checkboxes,issue.criteria.map(text=>({text,checked:true})))
  for(const key of ['proofCommentId','doneCommentId']) assert.ok(nonempty(receipt[key]),`${key} required`)
  assert.ok(receipt.doneComment.includes(`✅ df-done ${receipt.sha}`))
  assert.ok(cfg.trackerConfig.terminal.includes(receipt.status),'terminal status required')
  return receipt
}

/** Only a parent-inspected merge can release a dependency, even when criteria need repair. */
export function dependencyReady(record) {
  try {
    assert.equal(record.state,'merged'); assert.equal(record.gitAncestor,true)
    validateCheck(record.verification,record.sha)
    validateReviewEvidence(record.review,record.sha)
    return true
  } catch {return false}
}

export function batches(items, limit=3) {
  assert.ok(Number.isInteger(limit) && limit>=1 && limit<=4,'issue concurrency must be 1..4')
  return Array.from({length:Math.ceil(items.length/limit)},(_,i)=>items.slice(i*limit,(i+1)*limit))
}
export function validateNativeBatch(specs, limit=3) {
  assert.ok(specs.length && batches(specs,limit).length===1,'batch exceeds issue concurrency')
  assert.ok(unique(specs.map(x=>x.name)) && specs.every(x=>nonempty(x.name)))
  for(const spec of specs) { assert.ok(!spec.after?.length,'graph edges forward context and do not gate success'); assert.ok(!spec.delegate,'worker delegation forbidden') }
  return specs
}

export function validateInput(input) {
  assert.equal(input.version,1)
  for(const key of ['runId','parentSessionId','parentSessionFile','commandBytes','helperBytes']) assert.ok(nonempty(input[key]),`${key} required`)
  assert.ok(path.isAbsolute(input.parentSessionFile),'durable parent session required')
  const cfg=input.config;validateConfig(cfg)
  for(const key of ['srcPath','planPath','worktreeRoot']) assert.ok(path.isAbsolute(cfg[key]),`${key} must be absolute`)
  for(const key of ['verifyCmd','parentBranch','planBranch','repoName']) assert.ok(nonempty(cfg[key]),`${key} required`)
  assert.equal(path.basename(cfg.repoName),cfg.repoName)
  assert.equal(cfg.worktreeRoot,path.join(homedir(),'Dev/worktrees',cfg.repoName))
  assert.ok(safeSlug(cfg.labelSlug),'safe label slug required')
  assert.ok(![cfg.parentBranch,'main','develop'].includes(cfg.planBranch),'protected integration branch')
  const override=cfg.trackerConfig.integrationOverride
  if(override) {assert.equal(override.branch,cfg.planBranch);assert.equal(override.path,cfg.planPath);assert.equal(override.parentBranch,cfg.parentBranch)}
  else {
    assert.equal(cfg.planBranch,cfg.tracker==='linear'?`df-${cfg.epicSlug}`:`df-plan-${cfg.labelSlug}`)
    assert.equal(cfg.planPath,path.join(cfg.worktreeRoot,cfg.planBranch))
  }
  if(cfg.tracker==='linear') {
    assert.ok(nonempty(cfg.epicGoal) && safeSlug(cfg.epicSlug) && cfg.epicSlug.length<=60)
    assert.ok(Array.isArray(input.selectedIssues) && input.selectedIssues.length)
    for(const selected of input.selectedIssues) assert.deepEqual(Object.keys(selected).sort(),['id','identifier','parentId','title'])
    assert.deepEqual(input.selectedIssues,input.issues.map(({id,identifier,parentId,title})=>({id,identifier,parentId,title})))
    assert.equal(confirmSelection(input.selectedIssues,input.issues,cfg,true,input.selectionPredicates).proceed,true,'selection predicate drift')
  }
  batches([],cfg.maxIssueConcurrency)
  assert.ok(Array.isArray(input.issues) && input.issues.length)
  assert.deepEqual(selectIssues(input.issues,cfg),input.issues,'frozen selection mismatch')
  const slugs=[]
  for(const issue of input.issues) {
    assert.equal(typeof issue.body,'string');assert.ok(Array.isArray(issue.comments))
    assert.ok(Array.isArray(issue.criteria) && issue.criteria.every(nonempty) && unique(issue.criteria),'invalid criteria')
    assert.ok(Array.isArray(issue.riskHints) && Array.isArray(issue.dependsOn))
    assert.ok(safeSlug(issue.safeIssueSlug));slugs.push(issue.safeIssueSlug)
    if(cfg.tracker==='linear') assert.equal(issue.assigneeId,cfg.currentUserId,'claim readback required')
  }
  assert.ok(unique(slugs),'duplicate issue slugs')
  validateDependencies(input.issues,input.dependencies,cfg)
  for(const role of Object.keys(roles)) for(const key of ['instructions','model','thinking']) assert.ok(nonempty(input.roles?.[role]?.[key]),`${role}.${key} required`)
  for(const role of ['Review','CriteriaRepair']) for(const key of ['model','thinking']) assert.ok(nonempty(input.roles[role].escalation?.[key]),`${role}.escalation.${key} required`)
  return input
}
export function makeSnapshot(input) {validateInput(input);return {hash:hashJson(input),input:JSON.parse(stableJson(input))}}
export function verifySnapshot(snapshot) {assert.equal(snapshot.hash,hashJson(snapshot.input),'immutable input hash mismatch');return validateInput(snapshot.input)}

/** Read one direct native tool receipt; never inspect unrelated transcript content. */
export async function readNativeReceipts(file, parentSessionId, request) {
  assert.ok(nonempty(request.toolCallId) && Array.isArray(request.names) && request.names.length && unique(request.names))
  const stream=fs.createReadStream(file,{encoding:'utf8'})
  const lines=createInterface({input:stream,crlfDelay:Infinity})
  let session, call, receipt
  try {
    for await(const line of lines) {
      const entry=JSON.parse(line)
      if(entry.type==='session') {assert.equal(session,undefined,'ambiguous session header');session=entry.id;assert.equal(session,parentSessionId,'original parent session mismatch')}
      const message=entry.type==='message'?entry.message:undefined
      if(message?.role==='assistant') for(const part of message.content||[]) {
        if(part.type==='toolCall' && part.id===request.toolCallId) {assert.equal(call,undefined,'ambiguous call');call=part}
      }
      if(message?.role==='toolResult' && message.toolCallId===request.toolCallId) {assert.equal(receipt,undefined,'ambiguous receipt');receipt=message}
    }
  } finally {lines.close();stream.destroy()}
  assert.equal(session,parentSessionId,'original parent session missing')
  assert.ok(call && receipt && !receipt.isError,'missing or failed native receipt')
  assert.ok(['agent_spawn','agent_spawn_graph','agent_status','agent_wait','agent_send','agent_stop'].includes(call.name),'direct native call required; codemode details are not assumed')
  assert.equal(receipt.toolName,call.name)
  const agents=(receipt.details?.agents||[]).filter(a=>request.names.includes(a.name))
  const graphs=(receipt.details?.graphs||[]).filter(g=>request.names.includes(g.name))
  const all=[...agents,...graphs]
  assert.equal(all.length,request.names.length,'missing or ambiguous native identity')
  assert.ok(unique(all.map(x=>x.name)) && all.every(x=>nonempty(x.id)))
  for(const item of all) if(request.expectedIds?.[item.name]) assert.equal(item.id,request.expectedIds[item.name],'native identity changed')
  return {toolCallId:request.toolCallId,agents:agents.map(({id,name,state,result,graph})=>({id,name,state,result,graph})),graphs:graphs.map(({id,name,state,nodes})=>({id,name,state,nodes:nodes.map(({agentId,name})=>({agentId,name}))}))}
}

export const operationId = operation => hashJson(operation)
export function mutationDecision(operation, receipts, content) {
  const matching=receipts.filter(x=>x.operationId===operationId(operation))
  if(!matching.length) return 'inspect'
  if(matching.length!==1 || !matching[0].readback || !nonempty(matching[0].remoteId) || matching[0].contentHash!==hashJson(content)) return 'blocked'
  return 'reuse'
}
export function validateRecovery(record, input, journal) {
  assert.ok(nonempty(record.parentSessionId) && nonempty(record.workerId))
  assert.equal(record.parentSessionId,input.parentSessionId,'resume original parent')
  const matches=journal.filter(event=>event.event==='native_allocated' && event.workerId===record.workerId && event.role===record.role && event.issueId===record.issueId && event.attempt===record.attempt)
  assert.ok(matches.length>0,'worker not allocated by this run')
  for(const allocation of matches) for(const key of ['parentSessionId','workerName','role','issueId','attempt']) {
    assert.equal(record[key],allocation[key],`recovery ${key} mismatch`)
  }
  assert.ok(journal.some(event=>event.event==='attempt' && ['parentSessionId','workerName','role','issueId','attempt'].every(key=>event[key]===record[key])),'recorded role attempt required')
  assert.equal(record.workerId,record.observedWorkerId,'inspect original worker')
  assert.ok(['idle','failed','interrupted','skipped'].includes(record.state),'leave running worker alone')
  assert.ok(record.signals.length>=2 && unique(record.signals.map(x=>x.source)),'two independent signals required')
  assert.ok(record.signals.every(x=>['git','tracker','journal'].includes(x.source) && x.sha===record.signals[0].sha))
  assert.ok(shaValid(record.signals[0].sha));return record.signals[0].sha
}
export function validatePublication(receipt,cfg) {
  assert.ok(shaValid(receipt.head));assert.equal(receipt.remoteSha,receipt.head)
  assert.equal(receipt.source,cfg.planBranch);assert.equal(receipt.target,cfg.parentBranch)
  assert.equal(receipt.open,true);assert.equal(receipt.matches,1);assert.ok(receipt.diffCount>0)
  assert.ok(/^https?:\/\//.test(receipt.url));return receipt
}
export function attemptsRemaining(events,issueId,role) {
  assert.ok(role in roles)
  const attempts=events.filter(x=>x.event==='attempt' && x.issueId===issueId && x.role===role).map(x=>x.attempt)
  return Math.max(0,roles[role]-Math.max(0,...attempts))
}

const eventKeys=new Set(['event','parentSessionId','issueId','role','attempt','workerId','workerName','graphId','graphName','sha','baseSha','operationId','receiptPath','artifact','message','loopId','status','commandHash'])
const events=new Set(['run_started','attempt','native_allocated','agent_activity','result_rejected','verified','review_posted','merged','criteria_unverified','intent','receipt','attested','reconciled','published','continuity','cancelled','failed','warning'])
export function readJournal(dir) {
  const snapshot=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));verifySnapshot(snapshot)
  const text=fs.readFileSync(path.join(dir,'journal.jsonl'),'utf8')
  assert.ok(!text || text.endsWith('\n'),'partial journal tail; inspect and repair before append')
  const lines=text.trim()?text.trim().split('\n').map(JSON.parse):[]
  let previous=snapshot.hash
  for(const [i,line] of lines.entries()) {
    const {hash,...body}=line
    assert.equal(line.sequence,i+1);assert.equal(line.previous,previous);assert.equal(line.manifestHash,snapshot.hash)
    assert.equal(hash,hashJson(body),'journal hash mismatch');previous=hash
  }
  return lines
}
export function appendEvent(dir,event) {
  for(const key of Object.keys(event)) assert.ok(eventKeys.has(key),`unexpected journal field ${key}`)
  assert.ok(events.has(event.event),'unknown journal event')
  assert.ok(Buffer.byteLength(stableJson(event))<=4096,'bounded journal event exceeded')
  const snapshot=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'))
  const input=verifySnapshot(snapshot)
  assert.equal(event.parentSessionId,input.parentSessionId,'journal parent mismatch')
  if(event.issueId!==undefined) assert.ok(input.issues.some(x=>x.id===event.issueId),'journal issue outside frozen selection')
  if(event.role!==undefined) assert.ok(event.role in roles,'unknown role')
  const lock=path.join(dir,'.append-lock')
  const fd=fs.openSync(lock,'wx',0o600)
  try {
    const lines=readJournal(dir)
    if(event.event==='attempt') {
      assert.ok(event.role in roles && nonempty(event.workerName))
      if(event.role==='Inventory') assert.equal(event.issueId,undefined,'Inventory is run-scoped')
      else assert.ok(nonempty(event.issueId),'issueId required for issue-role attempt')
      const remaining=attemptsRemaining(lines,event.issueId,event.role)
      assert.ok(remaining>0,'role attempt budget exhausted')
      assert.equal(event.attempt,roles[event.role]-remaining+1,'attempt must advance by one')
    }
    const body={...event,sequence:lines.length+1,previous:lines.at(-1)?.hash||snapshot.hash,manifestHash:snapshot.hash}
    const record={...body,hash:hashJson(body)}
    const journal=fs.openSync(path.join(dir,'journal.jsonl'),'a',0o600)
    try {fs.writeSync(journal,stableJson(record)+'\n');fs.fsyncSync(journal)} finally {fs.closeSync(journal)}
    return record
  } finally {fs.closeSync(fd);fs.unlinkSync(lock)}
}
export function initialize(dir,input) {
  const snapshot=makeSnapshot(input)
  assert.equal(input.helperBytes,fs.readFileSync(new URL(import.meta.url),'utf8'),'snapshot exact helper bytes')
  const session=fs.openSync(input.parentSessionFile,'r')
  try {
    const buffer=Buffer.alloc(8192), length=fs.readSync(session,buffer,0,buffer.length,0)
    const text=buffer.subarray(0,length).toString('utf8'), end=text.indexOf('\n')
    assert.ok(end>0,'persistent session header required')
    const header=JSON.parse(text.slice(0,end))
    assert.equal(header.type,'session');assert.equal(header.id,input.parentSessionId,'original parent session mismatch')
  } finally {fs.closeSync(session)}
  fs.mkdirSync(dir,{mode:0o700}) // Exclusive directory; existing state always requires inspection.
  fs.writeFileSync(path.join(dir,'helper.mjs'),input.helperBytes,{flag:'wx',mode:0o400})
  fs.writeFileSync(path.join(dir,'manifest.json'),stableJson(snapshot)+'\n',{flag:'wx',mode:0o400})
  fs.writeFileSync(path.join(dir,'journal.jsonl'),'',{flag:'wx',mode:0o600})
  appendEvent(dir,{event:'run_started',parentSessionId:input.parentSessionId})
  return snapshot
}

if(process.argv[1] && fs.existsSync(process.argv[1]) && import.meta.url===pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const [command,dir,file]=process.argv.slice(2)
  const read=()=>JSON.parse(fs.readFileSync(file,'utf8'))
  let result
  if(command==='init') result=initialize(dir,read())
  else if(command==='check') {result=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));verifySnapshot(result);readJournal(dir)}
  else if(command==='append') result=appendEvent(dir,read())
  else if(command==='native') {
    const events=readJournal(dir), request=read()
    const owned=new Set(events.flatMap(x=>[x.workerName,x.graphName]).filter(Boolean))
    assert.ok(request.names.every(name=>owned.has(name)),'native name not owned by frozen run')
    const input=verifySnapshot(JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8')))
    result=await readNativeReceipts(input.parentSessionFile,input.parentSessionId,request)
  }
  else if(command==='validate') {
    const journal=readJournal(dir)
    const request=read(), snapshot=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8')), input=verifySnapshot(snapshot)
    const issue=input.issues.find(x=>x.id===request.issueId)
    const validators={native:()=>validateNativeOutcome(request.result,request.workerId),inventory:()=>validateInventory(request.result,input.issues),implementation:()=>validateImplementation(request.result,issue),review:()=>validateReview(request.result,request.sha,input.config,issue),criteria:()=>validateCriteria(request.result,issue.criteria,request.sha),attestation:()=>validateAttestation(request.result,input.config,issue),publication:()=>validatePublication(request.result,input.config),recovery:()=>validateRecovery(request.result,input,journal),batch:()=>validateNativeBatch(request.result,input.config.maxIssueConcurrency)}
    assert.ok(request.kind in validators,'unknown validation kind');result=validators[request.kind]()
  } else throw new Error('usage: df-ticket-hub.mjs init|check|append|validate|native RUN_DIRECTORY [JSON_FILE]')
  if(command==='init' || command==='check') result={hash:result.hash,runId:result.input.runId,parentSessionId:result.input.parentSessionId}
  console.log(stableJson({ok:true,result}))
}
