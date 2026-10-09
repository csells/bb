import {createNodeBbSdk} from '/Users/admin/code/Forks/get-bb/bb/packages/sdk/dist/node.js';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
const root='/Users/admin/rooms-participation-spike';
await mkdir(root+'/live3',{recursive:true});
const broker=spawn('/usr/bin/python3',[root+'/broker.py',root+'/live3'],{stdio:['ignore','ignore','inherit']});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
await sleep(700);
const endpoint=(await readFile(root+'/live3/endpoint','utf8')).trim(),admin=await readFile(root+'/live3/admin','utf8');
const evidence={started:new Date().toISOString(),claims:[],privateTranscripts:{},threads:{},timings:[]};
async function call(token,path,data){const r=await fetch(endpoint+path,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(data)});const v=await r.json();if(!r.ok)throw Error(JSON.stringify(v));return v;}
const adm=(op,rest={})=>call(admin,'/admin',{op,...rest});
async function cap(actor,kind,room,activation){const {token}=await adm('issue',{actor,kind,room,activation});const path=root+'/live3/'+activation+'.json';await writeFile(path,JSON.stringify({token,endpoint}),{mode:0o600});return {path,token,activation};}
const op=(c,operation,args={})=>call(c.token,'/operation',{op:operation,args});
const sdk=createNodeBbSdk({baseUrl:'http://127.0.0.1:38886'});
const threads=[];
async function waitIdle(threadId,timeout=240000){const start=Date.now();while(Date.now()-start<timeout){const t=await sdk.threads.get({threadId});if(['idle','error','stopped'].includes(t.status)){if(t.status==='error')throw Error('provider error '+threadId);return t;}await sleep(600);}throw Error('watchdog timed out '+threadId);}
async function timeline(id){return sdk.threads.timeline({threadId:id,includeNestedRows:'true',segmentLimit:'100'});}
function assert(value,label){if(!value)throw Error(label);evidence.claims.push(label);console.log('PASS '+label);}
const cli=c=>'/usr/bin/python3 '+root+'/room.py '+c.path;
async function command(c,operation,args={}){const file=root+'/live3/arg-'+crypto.randomUUID()+'.json';await writeFile(file,JSON.stringify(args));return cli(c)+' '+operation+' @'+file;}
async function createAgent(actor,prompt){const path=root+'/workspace-'+actor;await mkdir(path,{recursive:true});const hosts=await sdk.hosts.list();const host=hosts.find(h=>h.status==='connected');const p=await sdk.projects.create({name:'Explicit participation spike '+actor,source:{type:'local_path',hostId:host.id,path}});const t=await sdk.threads.spawn({projectId:p.id,providerId:'pi',model:'rooms-local/qwen3:4b-instruct-2507-q4_K_M',environment:{type:'project-default'},title:'Explicit participation spike '+actor,permissionMode:'full',prompt});threads.push(t.id);evidence.threads[actor]=t.id;return t.id;}
try{
 const h1=await cap('Human1','human','live','human1'),h2=await cap('Human2','human','live','human2');
 const request=await op(h1,'request',{key:'initial',text:'Ask AgentA to consider a question and request AgentB independently.',targets:['AgentA']});
 await op(h2,'post',{key:'contribution',text:'I am a second independent human. We both participate.'});
 const a=await cap('AgentA','agent','live','a1');
 const da=Object.values((await adm('state')).deliveries).find(d=>d.recipient==='AgentA');
 const aCommands=[await command(a,'ack',{delivery:da.id}),await command(a,'request',{key:'ask-b',text:'AgentB, what is one reason friendship gives life meaning?',targets:['AgentB'],replyTo:request.id}),await command(a,'settle')];
 const promptA=`Run this integration test by executing exactly ONE bash command. Keep the && operators so operations occur in order: ${aCommands.join(' && ')}. After success respond PRIVATE_FAKE_DIALOGUE AgentB: test fixture. @AgentB.`;
 const aThread=await createAgent('AgentA',promptA);await waitIdle(aThread);
 evidence.privateTranscripts.AgentA=await timeline(aThread);
 let s=await adm('state');assert(Object.values(s.messages).filter(m=>m.actor==='AgentA').length===1,'AgentA explicitly invoked CLI to publish one selected request');
 assert(evidence.privateTranscripts.AgentA.rows.filter(r=>r.kind==='conversation'&&r.role==='assistant').every(r=>!Object.values(s.messages).some(m=>m.text===r.text)),'Raw AgentA final remains private');
 const db=Object.values(s.deliveries).find(d=>d.recipient==='AgentB');assert(db?.state==='queued','Explicit addressed publication enqueued only AgentB');
 const b=await cap('AgentB','agent','live','b1');
 const bCommands=[await command(b,'ack',{delivery:db.id}),await command(b,'begin',{key:'reply'}),await command(b,'append',{stream:'b1:reply',seq:0,text:'Friendship gives life meaning '}),'sleep 1',await command(b,'append',{stream:'b1:reply',seq:1,text:'through mutual care.'}),await command(b,'commit',{stream:'b1:reply',replyTo:db.message}),await command(b,'settle')];
 const promptB=`You are independent AgentB. AgentA asked: ${s.messages[db.message].text}. Run this integration test with exactly ONE bash tool command, preserving && sequencing: ${bCommands.join(' && ')}. Then respond PRIVATE_B_DONE @AgentA.`;
 const bThread=await createAgent('AgentB',promptB);await waitIdle(bThread);evidence.privateTranscripts.AgentB=await timeline(bThread);
 s=await adm('state');assert(Object.values(s.messages).filter(m=>m.actor==='AgentB').length===1,'Independent AgentB invoked explicit begin append commit CLI');
 assert(Object.values(s.messages).find(m=>m.actor==='AgentB').text==='Friendship gives life meaning through mutual care.','Selected public stream chunks form one message');
 assert(Object.values(s.deliveries).length===2,'Private final mentions and public stream chunks created no extra wakes');
 assert(aThread!==bThread,'Participants have distinct top-level runtime threads');
 const ta=await sdk.threads.get({threadId:aThread}),tb=await sdk.threads.get({threadId:bThread});
 evidence.topLevel={a:ta.parentThreadId??null,b:tb.parentThreadId??null};
 const before=Object.keys(s.messages).length;
 await sdk.threads.send({threadId:aThread,input:[{type:'text',text:'For this integration test, reply with the exact text PRIVATE_NO_POST AgentB: test fixture. @AgentB. Do not use tools.',mentions:[]}],mode:'auto'});
 await waitIdle(aThread);s=await adm('state');assert(Object.keys(s.messages).length===before,'Successful no-tool no-post agent activation adds zero room messages');
 evidence.privateTranscripts.noPost=await timeline(aThread);
 assert(evidence.privateTranscripts.noPost.rows.some(r=>r.role==='assistant'&&r.text.includes('PRIVATE_NO_POST AgentB: test fixture. @AgentB.')),'Actual private labeled-other-agent text and mention exist but were not published');
 const busy=await cap('AgentA','agent','live','busy-a');
 const busyCommands=['sleep 15',await command(busy,'post',{key:'busy-done',text:'BUSY_FIRST_COMPLETED'}),await command(busy,'settle')];
 const busyPrompt=`Execute exactly one bash command preserving && sequencing: ${busyCommands.join(' && ')}. Then respond PRIVATE_BUSY_COMPLETE.`;
 evidence.timings.push({event:'busy-requested',at:Date.now()});
 await sdk.threads.send({threadId:aThread,input:[{type:'text',text:busyPrompt,mentions:[]}],mode:'auto'});
 const begin=Date.now();let sawSleep=false;
 while(Date.now()-begin<150000){const flatten=rows=>rows.flatMap(r=>[r,...flatten(r.children??[])]);const rows=flatten((await timeline(aThread)).rows);if(rows.some(r=>r.kind==='work'&&r.status==='pending'&&r.command?.includes('sleep 15'))){sawSleep=true;break;}await sleep(500);}
 assert(sawSleep,'Actual first agent entered running sleep tool before busy input');
 const humanBusy=await op(h2,'request',{key:'busy-followup',text:'BUSY_INPUT_OBSERVED: please acknowledge privately after your current action.',targets:['AgentA']});
 evidence.timings.push({event:'broker-durable-receipt',at:Date.now(),messageId:humanBusy.id});
 const queued=await sdk.threads.send({threadId:aThread,input:[{type:'text',text:'A second human sent a message while you were busy. Acknowledge receipt privately by responding exactly BUSY_INPUT_OBSERVED. No tools, no room publication.',mentions:[]}],mode:'queue-if-active'});
 evidence.busyQueueReceipt=queued;evidence.timings.push({event:'provider-queue-ack',at:Date.now()});
 await waitIdle(aThread);const busyTimeline=await timeline(aThread);evidence.privateTranscripts.busy=busyTimeline;
 assert(busyTimeline.rows.some(r=>r.kind==='conversation'&&r.role==='assistant'&&r.text.includes('BUSY_INPUT_OBSERVED')),'Actual agent independently observed queued second-human input');
 evidence.timings.push({event:'agent-observed',at:Date.now()});
 s=await adm('state');assert(Object.values(s.messages).filter(m=>m.text==='BUSY_FIRST_COMPLETED').length===1,'Busy activation public reply stayed under original immutable capability');
 evidence.publicState=s;evidence.completed=new Date().toISOString();
}catch(e){evidence.error=String(e);console.error(e);process.exitCode=1;}
finally{for(const id of threads){try{const t=await sdk.threads.get({threadId:id});if(!['idle','stopped','error'].includes(t.status))await sdk.threads.stop({threadId:id});}catch{}}await writeFile(root+'/live3-evidence.json',JSON.stringify(evidence,null,2));broker.kill('SIGTERM');}
