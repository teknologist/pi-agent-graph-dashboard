import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import * as h from './df-ticket-hub.mjs'

const sourcePrompt = new URL('../prompts/private_df-implement-tickets.md', import.meta.url)
const promptPath = fs.existsSync(sourcePrompt) ? sourcePrompt : new URL('../prompts/df-implement-tickets.md', import.meta.url)

const sha='a'.repeat(40)
const issue={id:'uuid-1',identifier:'TEAM-1',title:'One',parentId:null,body:'Full issue',comments:[],criteria:['Works'],dependsOn:[],riskHints:[],labels:['ready-for-agent'],status:'Todo',projectId:'p',assigneeId:'u',safeIssueSlug:'team-1'}
const config={tracker:'linear',trackerConfig:{projectId:'p',terminal:['Done']},label:'ready-for-agent',labelSlug:'ready-for-agent',currentUserId:'u',epicGoal:'Goal',epicSlug:'goal',parentBranch:'main',planBranch:'df-goal',repoName:'fixture',srcPath:'/source',worktreeRoot:path.join(os.homedir(),'Dev/worktrees/fixture'),planPath:path.join(os.homedir(),'Dev/worktrees/fixture/df-goal'),verifyCmd:'node --test',maxIssueConcurrency:3}
const input={version:1,runId:'fixture-run',parentSessionId:'parent-1',parentSessionFile:'/sessions/parent-1.jsonl',config,selectionPredicates:[{id:issue.id,status:'Todo',projectId:'p',labels:['ready-for-agent']}],selectedIssues:[{id:issue.id,identifier:issue.identifier,title:issue.title,parentId:null}],issues:[issue],dependencies:[],commandBytes:'command snapshot',helperBytes:fs.readFileSync(new URL('./df-ticket-hub.mjs',import.meta.url),'utf8'),roles:{Inventory:{instructions:'inventory',model:'provider/model',thinking:'medium'},Implement:{instructions:'implement',model:'provider/model',thinking:'medium'},Review:{instructions:'review',model:'provider/model',thinking:'medium',escalation:{model:'provider/big',thinking:'high'}},CriteriaRepair:{instructions:'repair',model:'provider/model',thinking:'medium',escalation:{model:'provider/big',thinking:'high'}}}}
const check={command:'node --test',output:'1 passing',exitCode:0,sha}
const result={status:'success',issueId:issue.id,branch:'df-issue-team-1',sha,summary:'Implemented',verification:check,criteria:[{text:'Works',verified:true,proof:check}],evidence:{checks:['pass']}}
const pass={issueId:issue.id,sha,baseSha:'b'.repeat(40),pass:1,reviewer:'review-1',workerId:'worker-1',raw:'Reviewer review-1\nNo issues found',comment:'Implementation branch: df-issue-team-1\nIntegration plan branch: df-goal\nNo issues found',commentId:'comment-1',readback:true,findings:[],priorFixes:'Initial pass',artifact:'/artifacts/review-1.txt'}

test('four configured trackers retain backend independence',()=>{
 for(const tracker of ['linear','github','gitlab','local-file']){
  const c={...config,tracker}
  assert.equal(h.selectIssues([issue],c).length,1)
  assert.equal(h.selectIssues([{...issue,labels:[]}],c).length,0)
 }
 assert.throws(()=>h.selectIssues([issue],{...config,tracker:'unknown'}))
 assert.throws(()=>h.selectIssues([issue],{...config,trackerConfig:{}}))
 assert.throws(()=>h.selectIssues([{...issue,parentId:undefined}],config))
 assert.equal(h.selectIssues([{...issue,assigneeId:'other'}],config).length,0)
 assert.throws(()=>h.selectIssues(Array(250).fill(issue),config,{listed:true}),/truncation/)
})
test('selection confirmation rejects cancel and predicate drift',()=>{
 assert.equal(h.confirmSelection([issue],[issue],config,false).proceed,false)
 const predicates=[{id:issue.id,status:'Todo',projectId:'p',labels:['ready-for-agent']}]
 assert.equal(h.confirmSelection(input.selectedIssues,[{...issue,parentId:'new'}],config,true,predicates).proceed,false)
 assert.equal(h.confirmSelection(input.selectedIssues,[{...issue,labels:[]}],config,true,predicates).proceed,false)
 assert.equal(h.confirmSelection(input.selectedIssues,[issue],config,true,predicates).proceed,true)
 assert.equal(h.confirmSelection(input.selectedIssues,[{...issue,status:'In Progress'}],config,true,predicates).proceed,false)
 assert.throws(()=>h.confirmSelection(input.selectedIssues,[issue],config,true),/predicate snapshot/)
})
test('transitive human blockers and missing dependencies fail closed',()=>{
 const child={...issue,dependsOn:['dep']}
 assert.throws(()=>h.validateDependencies([child],[],config),/Missing dependency/)
 assert.throws(()=>h.validateDependencies([child],[{...issue,id:'dep',dependsOn:['human']},{...issue,id:'human',labels:['ready-for-human']}],config),/Dependency graph is impossible/)
 assert.throws(()=>h.validateDependencies([child],[{...issue,id:'dep',dependsOn:[issue.id]}],config),/cycle/)
 assert.doesNotThrow(()=>h.validateDependencies([child],[{...issue,id:'dep',status:'Done'}],config))
 assert.throws(()=>h.validateDependencies([child],[{...issue,id:'dep'}],config),/unresolved external/)
})
test('inventory exact identity, criteria, slugs, and earlier waves',()=>{
 const one={id:issue.id,trackerRef:issue.identifier,title:issue.title,safeIssueSlug:'team-1',criteria:issue.criteria,dependsOn:[],riskHints:[]}
 const inventory={waves:[[one]],impossibleDependencies:[]}
 assert.doesNotThrow(()=>h.validateInventory(inventory,[issue]))
 assert.doesNotThrow(()=>h.validateInventory({...inventory,waves:[[{...one,safeIssueSlug:'team--1'}]]},[{...issue,safeIssueSlug:'team--1'}]))
 assert.throws(()=>h.validateInventory({...inventory,waves:[[{...one,id:'parent'}]]},[issue]))
 assert.throws(()=>h.validateInventory({...inventory,waves:[[{...one,criteria:['different']}]]},[issue]))
 assert.throws(()=>h.validateInventory('```json\n{}\n```',[issue]))
 assert.throws(()=>h.validateInventory({...inventory,waves:[[one,one]]},[issue]))
 const two={...issue,id:'2',identifier:'TEAM-2',safeIssueSlug:'team-2',dependsOn:[issue.id]}
 assert.throws(()=>h.validateInventory({waves:[[one,{...one,id:'2',trackerRef:'TEAM-2',safeIssueSlug:'team-2',dependsOn:[issue.id]}]],impossibleDependencies:[]},[issue,two]))
})
test('normal worker answer is not verified success; exact proof and SHA required',()=>{
 assert.doesNotThrow(()=>h.validateImplementation(result,issue))
 assert.deepEqual(h.normalizeEvidence({z:['one','two'],a:1}),['a: 1','z[0]: one','z[1]: two'])
 for(const status of ['failed','partial','skipped','aborted']) assert.throws(()=>h.validateImplementation({...result,status},issue))
 assert.throws(()=>h.validateImplementation({...result,verification:{...check,exitCode:1}},issue))
 assert.throws(()=>h.validateImplementation({...result,criteria:[...result.criteria,...result.criteria]},issue))
 assert.throws(()=>h.validateImplementation({...result,criteria:[{...result.criteria[0],proof:{...check,output:''}}]},issue))
 assert.throws(()=>h.validateImplementation({...result,criteria:[{...result.criteria[0],proof:{...check,sha:'b'.repeat(40)}}]},issue))
 assert.throws(()=>h.validateImplementation({...result,branch:'main'},issue))
})
test('raw review AND chronological readback must end in exact clean line',()=>{
 assert.doesNotThrow(()=>h.validateReview(pass,sha,config,issue))
 for(const raw of ['CLEAN','approve','No issues found\ntrailing',' No issues found']) assert.throws(()=>h.validateReview({...pass,raw},sha,config,issue))
 for(const change of [{uncertain:true},{needsRepair:true},{verifyFailed:true},{readback:false},{commentId:''},{comment:'No issues found'},{findings:[{severity:'high',file:'x',line:1}]},{sha:'b'.repeat(40)}]) assert.throws(()=>h.validateReview({...pass,...change},sha,config,issue))
 assert.throws(()=>h.validateReview(pass,'c'.repeat(40),config,issue))
})
test('native result state and stop reason are gates, not graph completion',()=>{
 const worker={id:'worker-1',state:'idle',result:{stopReason:'stop',text:'{}'}}
 assert.equal(h.validateNativeOutcome(worker,'worker-1'),'{}')
 for(const state of ['working','failed','interrupted','skipped']) assert.throws(()=>h.validateNativeOutcome({...worker,state},'worker-1'))
 for(const stopReason of ['error','aborted','length','toolUse']) assert.throws(()=>h.validateNativeOutcome({...worker,result:{...worker.result,stopReason}},'worker-1'))
 assert.throws(()=>h.validateNativeOutcome(worker,'worker-2'))
})

test('dependency release requires verified integration, not graph or Done status',()=>{
 for(const state of ['failed','partial','skipped','aborted','idle']) assert.equal(h.dependencyReady({state}),false)
 const integrated={state:'merged',sha,gitAncestor:true,verification:check,review:pass}
 assert.equal(h.dependencyReady(integrated),true)
 assert.equal(h.dependencyReady({...integrated,criteriaVerified:false}),true)
 assert.equal(h.dependencyReady({...integrated,gitAncestor:false}),false)
 assert.equal(h.dependencyReady({...integrated,review:{...pass,readback:false}}),false)
 for(const flag of ['uncertain','needsRepair','verifyFailed']) assert.equal(h.dependencyReady({...integrated,review:{...pass,[flag]:true}}),false,flag)
})
test('snapshot canonical hash binds arrays, role bytes, selection, target, and concurrency',()=>{
 const snapshot=h.makeSnapshot(input)
 assert.equal(h.verifySnapshot(snapshot).runId,input.runId)
 assert.equal(h.hashJson({b:2,a:1}),h.hashJson({a:1,b:2}))
 for(const mutate of [x=>x.config.verifyCmd='false',x=>x.roles.Review.instructions+='changed',x=>x.selectedIssues[0].id='other',x=>x.config.parentBranch='develop',x=>x.config.maxIssueConcurrency=4]){
  const copy=structuredClone(snapshot);mutate(copy.input);assert.throws(()=>h.verifySnapshot(copy),/hash/)
 }
 assert.notEqual(h.hashJson([1,2]),h.hashJson([2,1]))
 for(const maxIssueConcurrency of [0,5,'3']) assert.throws(()=>h.makeSnapshot({...input,config:{...config,maxIssueConcurrency}}))
 assert.throws(()=>h.makeSnapshot({...input,parentSessionId:''}))
 assert.throws(()=>h.makeSnapshot({...input,roles:{...input.roles,Review:{...input.roles.Review,escalation:undefined}}}))
})
test('nondefault integration target and selection predicates remain frozen independently of selectedIssues',()=>{
 const override={branch:'ticket-integration',path:path.join(config.worktreeRoot,'custom-target'),parentBranch:'develop'}
 const custom={...input,config:{...config,planBranch:override.branch,planPath:override.path,parentBranch:override.parentBranch,trackerConfig:{...config.trackerConfig,integrationOverride:override}}}
 assert.equal(h.verifySnapshot(h.makeSnapshot(custom)).config.planPath,override.path)
 assert.deepEqual(Object.keys(custom.selectedIssues[0]).sort(),['id','identifier','parentId','title'])
 assert.throws(()=>h.makeSnapshot({...custom,config:{...custom.config,planPath:config.planPath}}))
 assert.throws(()=>h.makeSnapshot({...input,selectionPredicates:undefined}),/predicate snapshot/)
 assert.throws(()=>h.makeSnapshot({...input,issues:[{...issue,status:'In Progress'}]}),/predicate drift/)
})

test('pre-init local-file effect can be read back and imported without a fabricated intent',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'df-hub-preinit-')), file=path.join(root,'issue.json')
 const operation={runId:'preinit',issueId:issue.id,stage:'claim',pass:1,sha:''}
 const content={id:issue.id,assigneeId:'u',status:'Todo'}
 fs.writeFileSync(file,JSON.stringify(content)) // The effect persists; no journal exists yet.
 assert.equal(fs.existsSync(path.join(root,'run','manifest.json')),false)
 assert.equal(h.mutationDecision(operation,[],content),'inspect')
 const observed=JSON.parse(execFileSync(process.execPath,['-e','process.stdout.write(require("node:fs").readFileSync(process.argv[1]))',file],{encoding:'utf8'}))
 assert.deepEqual(observed,content)
 const receipt={operationId:h.operationId(operation),readback:true,remoteId:file,contentHash:h.hashJson(observed)}
 assert.equal(h.mutationDecision(operation,[receipt],content),'reuse')
 assert.equal(h.mutationDecision(operation,[receipt],{...content,assigneeId:'other'}),'blocked')
 const parentSessionFile=path.join(root,'parent.jsonl'), receiptPath=path.join(root,'imported-receipt.json'), dir=path.join(root,'run')
 fs.writeFileSync(parentSessionFile,JSON.stringify({type:'session',id:input.parentSessionId})+'\n')
 fs.writeFileSync(receiptPath,JSON.stringify(receipt),{mode:0o600})
 h.initialize(dir,{...input,runId:'preinit',parentSessionFile})
 h.appendEvent(dir,{event:'receipt',parentSessionId:input.parentSessionId,issueId:issue.id,operationId:receipt.operationId,receiptPath,status:'pre-init-imported'})
 assert.deepEqual(h.readJournal(dir).map(event=>event.event),['run_started','receipt'])
 assert.equal(h.mutationDecision(operation,[JSON.parse(fs.readFileSync(receiptPath))],content),'reuse')
 // This tests data/readback handling, not a real Linear claim or an automatic retry controller.
})

test('exact prompt env snippet seeds missing files and preserves reused repair env',()=>{
 const prompt=fs.readFileSync(promptPath,'utf8')
 const snippet=prompt.match(/\( cd "\$SRC" && find[\s\S]*?"\$DEST\/"/g)
 assert.equal(snippet?.length,1)
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'df-hub-env-'))
 const SRC=path.join(root,'source'), DEST=path.join(root,'repair')
 for(const dir of [SRC,DEST,path.join(SRC,'nested'),path.join(SRC,'node_modules'),path.join(SRC,'.git')]) fs.mkdirSync(dir,{recursive:true})
 for(const [name,body] of [['.env','initial'],['nested/.env.test','nested'],['node_modules/.env','excluded'],['.git/.env','excluded'],['ordinary','excluded']]) fs.writeFileSync(path.join(SRC,name),body)
 const seed=()=>execFileSync('bash',['-e','-c',snippet[0]],{env:{...process.env,SRC,DEST}})
 seed()
 assert.equal(fs.readFileSync(path.join(DEST,'.env'),'utf8'),'initial')
 assert.equal(fs.readFileSync(path.join(DEST,'nested/.env.test'),'utf8'),'nested')
 for(const name of ['node_modules/.env','.git/.env','ordinary']) assert.equal(fs.existsSync(path.join(DEST,name)),false)
 fs.writeFileSync(path.join(DEST,'.env'),'repair-local')
 fs.writeFileSync(path.join(SRC,'.env'),'source-changed')
 fs.writeFileSync(path.join(SRC,'nested/.env.test'),'source-nested-changed')
 fs.writeFileSync(path.join(SRC,'.env.new'),'new')
 seed()
 assert.equal(fs.readFileSync(path.join(DEST,'.env'),'utf8'),'repair-local')
 assert.equal(fs.readFileSync(path.join(DEST,'nested/.env.test'),'utf8'),'nested')
 assert.equal(fs.readFileSync(path.join(DEST,'.env.new'),'utf8'),'new')
 // Directory fixture only: no git worktree, identity checks, or worker launch.
})

test('same-SHA verification boundaries have separate persisted receipts before acknowledgement',()=>{
 const prompt=fs.readFileSync(promptPath,'utf8')
 const expression=prompt.match(/`stage = (JSON\.stringify\([^`]+\))`/)
 assert.ok(expression,'prompt defines the verification stage mapping')
 const stageFor=new Function('role','attempt','boundaryId',`return ${expression[1]}`)
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'df-hub-boundaries-'))
 const operations=['Implement','Review','CriteriaRepair','Parent'].flatMap(role=>['baseline','criterion'].map(boundaryId=>({runId:input.runId,issueId:issue.id,stage:stageFor(role,1,boundaryId),pass:1,sha})))
 assert.equal(new Set(operations.map(h.operationId)).size,8)
 assert.notEqual(stageFor('Parent',1,'criterion'),stageFor('Parent',2,'criterion'))
 const [first,second]=operations
 const contents=['Baseline passed','Criterion passed']
 const receipts=operations.slice(0,2).map((operation,i)=>({operationId:h.operationId(operation),readback:true,remoteId:`comment-${i+1}`,contentHash:h.hashJson(contents[i])}))
 assert.equal(h.operationId(first),h.hashJson(first))
 assert.equal(h.mutationDecision(second,[receipts[0]],contents[1]),'inspect')
 fs.writeFileSync(path.join(root,'receipts.json'),JSON.stringify(receipts))
 // Resume after the second readback, before its acknowledgement; use only persisted receipts.
 const recovered=JSON.parse(execFileSync(process.execPath,['-e','process.stdout.write(require("node:fs").readFileSync(process.argv[1]))',path.join(root,'receipts.json')],{encoding:'utf8'}))
 for(const [i,operation] of [first,second].entries()) assert.equal(h.mutationDecision(operation,recovered,contents[i]),'reuse')
 assert.equal(h.mutationDecision(second,recovered,contents[0]),'blocked')
 assert.equal(h.mutationDecision(second,[...recovered,receipts[1]],contents[1]),'blocked')
 // Real hash/receipt decisions, not a tracker or an acknowledgement controller.
})

test('attestation needs checked exact criteria, current proofs, raw review, and tracker receipt',()=>{
 const receipt={sha,criteria:result.criteria,checkboxes:[{text:'Works',checked:true}],review:pass,verification:check,gitAncestor:true,proofCommentId:'p',doneComment:`✅ df-done ${sha}`,doneCommentId:'d',status:'Done',readback:true}
 assert.doesNotThrow(()=>h.validateAttestation(receipt,config,issue))
 for(const change of [{readback:false},{gitAncestor:false},{proofCommentId:''},{doneCommentId:''},{status:'Todo'},{checkboxes:[{text:'Works',checked:false}]},{criteria:[{text:'Works',verified:false}]}]) assert.throws(()=>h.validateAttestation({...receipt,...change},config,issue))
})

test('bounded independent batches cannot forward predecessor context',()=>{
 const records=Array.from({length:5},(_,i)=>({...issue,id:String(i)}))
 assert.deepEqual(h.batches(records).map(x=>x.length),[3,2])
 assert.deepEqual(h.batches(records,4).map(x=>x.length),[4,1])
 assert.throws(()=>h.batches(records,5))
 assert.throws(()=>h.validateNativeBatch([{name:'a',after:[]},{name:'b',after:['a']}],3))
 assert.doesNotThrow(()=>h.validateNativeBatch([{name:'a'},{name:'b'}],3))
 assert.throws(()=>h.validateNativeBatch([{name:'a',delegate:true}],3))
})
test('operation identities, recovery signals, and uncertain publication',()=>{
 const operation={runId:'r',issueId:'i',stage:'review-comment',pass:1,sha}
 assert.equal(h.operationId(operation),h.operationId({...operation}))
 assert.notEqual(h.operationId(operation),h.operationId({...operation,pass:2}))
 const receipt={operationId:h.operationId(operation),readback:true,remoteId:'comment-1',contentHash:h.hashJson('body')}
 assert.equal(h.mutationDecision(operation,[receipt],'body'),'reuse')
 assert.equal(h.mutationDecision(operation,[],'body'),'inspect')
 assert.equal(h.mutationDecision(operation,[receipt,receipt],'body'),'blocked')
 const publication={head:sha,remoteSha:sha,source:'df-goal',target:'main',open:true,url:'https://host/pr/1',matches:1,diffCount:1}
 assert.doesNotThrow(()=>h.validatePublication(publication,config))
 for(const change of [{target:'develop'},{remoteSha:'b'.repeat(40)},{matches:2},{diffCount:0},{open:false}]) assert.throws(()=>h.validatePublication({...publication,...change},config))
})
test('original parent native receipts expose only requested worker IDs and raw results',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'df-hub-receipts-')), file=path.join(dir,'session.jsonl')
 const worker={id:'7',name:'issue-one',state:'idle',result:{stopReason:'stop',text:'raw evidence'},task:'private task'}
 fs.writeFileSync(file,[{type:'session',id:'parent-1'},{type:'message',message:{role:'user',content:'PRIVATE_CANARY'}},{type:'message',message:{role:'assistant',content:[{type:'toolCall',id:'call-1',name:'agent_wait',arguments:{names:['issue-one']}}]}},{type:'message',message:{role:'toolResult',toolCallId:'call-1',toolName:'agent_wait',details:{agents:[worker,{id:'8',name:'private-other',task:'PRIVATE_CANARY'}],graphs:[]}}}].map(JSON.stringify).join('\n')+'\n')
 const result=await h.readNativeReceipts(file,'parent-1',{toolCallId:'call-1',names:['issue-one']})
 assert.equal(result.agents[0].id,'7');assert.equal(result.agents[0].result.text,'raw evidence')
 assert.ok(!JSON.stringify(result).includes('PRIVATE_CANARY'))
 assert.ok(!JSON.stringify(result).includes('private task'))
 await assert.rejects(h.readNativeReceipts(file,'other',{toolCallId:'call-1',names:['issue-one']}))
 await assert.rejects(h.readNativeReceipts(file,'parent-1',{toolCallId:'call-1',names:['missing']}))
 await assert.rejects(h.readNativeReceipts(file,'parent-1',{toolCallId:'call-1',names:['issue-one'],expectedIds:{'issue-one':'other'}}))
 const original=fs.readFileSync(file,'utf8')
 fs.writeFileSync(file,original.replaceAll('agent_wait','codemode'))
 await assert.rejects(h.readNativeReceipts(file,'parent-1',{toolCallId:'call-1',names:['issue-one']}),/direct native/)
 fs.writeFileSync(file,original+original.trim().split('\n').at(-1)+'\n')
 await assert.rejects(h.readNativeReceipts(file,'parent-1',{toolCallId:'call-1',names:['issue-one']}),/ambiguous receipt/)
 fs.writeFileSync(file,original+'{"incomplete":')
 await assert.rejects(h.readNativeReceipts(file,'parent-1',{toolCallId:'call-1',names:['issue-one']}))
})

test('CLI recovery binds parent and role attempt to allocated native identity',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'df-hub-recovery-')), dir=path.join(root,'run')
 const parentSessionFile=path.join(root,'parent.jsonl'), requestFile=path.join(root,'request.json')
 fs.writeFileSync(parentSessionFile,JSON.stringify({type:'session',id:input.parentSessionId})+'\n')
 h.initialize(dir,{...input,parentSessionFile})
 const cli=(command,request)=>{
  fs.writeFileSync(requestFile,JSON.stringify(request))
  return JSON.parse(execFileSync(process.execPath,[path.join(dir,'helper.mjs'),command,dir,requestFile],{encoding:'utf8',stdio:['ignore','pipe','pipe']})).result
 }
 const attempt={parentSessionId:'parent-1',issueId:issue.id,role:'Implement',attempt:1,workerName:'owned'}
 cli('append',{event:'attempt',...attempt})
 cli('append',{event:'native_allocated',...attempt,workerId:'owned-id'})
 const recovery={...attempt,workerId:'owned-id',observedWorkerId:'owned-id',expectedParentSessionId:'parent-1',state:'idle',signals:[{source:'git',sha},{source:'tracker',sha}]}
 const validate=result=>cli('validate',{kind:'recovery',result})
 assert.equal(validate(recovery),sha)
 // The same native worker can own another failed-attempt retry without losing the first binding.
 cli('append',{event:'attempt',...attempt,attempt:2})
 cli('append',{event:'native_allocated',...attempt,attempt:2,workerId:'owned-id'})
 assert.equal(validate({...recovery,attempt:2}),sha)
 for(const change of [
  {parentSessionId:'foreign',expectedParentSessionId:'foreign'},
  {workerId:'foreign',observedWorkerId:'foreign'},
  {role:'Review'}, {attempt:3}, {workerName:'other'}, {observedWorkerId:'other'}, {state:'working'},
  {signals:[{source:'journal',sha},{source:'journal',sha}]},
  {signals:[{source:'git',sha},{source:'tracker',sha:'b'.repeat(40)}]}
 ]) assert.throws(()=>validate({...recovery,...change}),JSON.stringify(change))
})

test('CLI issue attempt scope and exhausted budgets survive process restarts',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'df-hub-budgets-')), dir=path.join(root,'run')
 const parentSessionFile=path.join(root,'parent.jsonl'), eventFile=path.join(root,'event.json')
 fs.writeFileSync(parentSessionFile,JSON.stringify({type:'session',id:input.parentSessionId})+'\n')
 h.initialize(dir,{...input,parentSessionFile})
 const append=event=>{
  fs.writeFileSync(eventFile,JSON.stringify({parentSessionId:'parent-1',...event}))
  execFileSync(process.execPath,[path.join(dir,'helper.mjs'),'append',dir,eventFile],{stdio:['ignore','pipe','pipe']})
 }
 for(const [role,budget] of [['Implement',3],['Review',3],['CriteriaRepair',2],['Inventory',2]]) {
  const scope=role==='Inventory'?{}:{issueId:issue.id}
  const event={event:'attempt',role,workerName:role,attempt:1}
  if(role!=='Inventory') assert.throws(()=>append(event),/issueId/)
  else assert.throws(()=>append({...event,issueId:issue.id}),/run-scoped/)
  for(let attempt=1;attempt<=budget;attempt++) {
   append({...event,...scope,attempt})
   append({event:'agent_activity',...scope,role,message:'verification boundary; same attempt'})
   assert.equal(h.attemptsRemaining(h.readJournal(dir),scope.issueId,role),budget-attempt)
  }
  assert.throws(()=>append({...event,...scope,attempt:budget+1}),/exhausted/)
  assert.throws(()=>append({...event,...scope,attempt:1}),/exhausted/)
 }
})

test('exclusive snapshot, append-only integrity journal, original parent, persistent budgets',()=>{
 const dir=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'df-hub-state-')),'run')
 const parentSessionFile=path.join(path.dirname(dir),'parent.jsonl')
 fs.writeFileSync(parentSessionFile,JSON.stringify({type:'session',id:input.parentSessionId})+'\n')
 const runInput={...input,parentSessionFile}
 const snapshot=h.initialize(dir,runInput)
 assert.throws(()=>h.initialize(dir,runInput),/exist/)
 const checked=JSON.parse(execFileSync(process.execPath,[path.join(dir,'helper.mjs'),'check',dir],{encoding:'utf8'}))
 assert.equal(checked.result.hash,snapshot.hash)
 assert.ok(!JSON.stringify(checked).includes('command snapshot'),'CLI returns bounded metadata, not private inputs')
 assert.throws(()=>h.initialize(dir+'-no-session',input),/ENOENT/)
 assert.equal(fs.existsSync(dir+'-no-session'),false)
 h.appendEvent(dir,{event:'attempt',issueId:issue.id,role:'Implement',attempt:1,workerId:'w',workerName:'w',parentSessionId:'parent-1'})
 assert.equal(h.readJournal(dir).length,2)
 assert.equal(h.attemptsRemaining(h.readJournal(dir),issue.id,'Implement'),2)
 assert.equal(h.attemptsRemaining([],issue.id,'Review'),3)
 assert.equal(h.attemptsRemaining([],issue.id,'CriteriaRepair'),2)
 assert.throws(()=>h.appendEvent(dir,{event:'attempt',parentSessionId:'other'}))
 assert.throws(()=>h.appendEvent(dir,{event:'agent_activity',parentSessionId:'parent-1',secret:'private'}))
 assert.equal(h.verifySnapshot(JSON.parse(fs.readFileSync(path.join(dir,'manifest.json')))).runId,input.runId)
 const journal=path.join(dir,'journal.jsonl')
 fs.appendFileSync(journal,'{"truncated":')
 assert.throws(()=>h.readJournal(dir))
 assert.throws(()=>h.appendEvent(dir,{event:'cancelled',parentSessionId:'parent-1'}))
 assert.equal(snapshot.hash,h.hashJson(runInput))
})
