import json, os, subprocess, sys, time, urllib.request, urllib.error
from pathlib import Path
root=Path(sys.argv[1]); root.mkdir(parents=True,exist_ok=True)
server=None; results=[]
def start():
 global server,endpoint,admin
 server=subprocess.Popen([sys.executable,str(Path(__file__).with_name('broker.py')),str(root)],stdout=subprocess.DEVNULL)
 time.sleep(.4); endpoint=(root/'endpoint').read_text(); admin=(root/'admin').read_text()
def request(token,op,args=None,admin_call=False,expected=200):
 body={'op':op,**(args or {})} if admin_call else {'op':op,'args':args or {}}
 req=urllib.request.Request(endpoint+('/admin' if admin_call else '/operation'),data=json.dumps(body).encode(),headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
 try:
  with urllib.request.urlopen(req) as r: code,data=r.status,json.load(r)
 except urllib.error.HTTPError as e: code,data=e.code,json.load(e)
 assert code==expected,(op,code,expected,data)
 return data
def adm(op,**args):return request(admin,op,args,True)
def cap(actor,room,activation,kind='agent'):return adm('issue',actor=actor,room=room,activation=activation,kind=kind)['token']
def check(ok,name):
 assert ok,name
 results.append(name);print('PASS',name,flush=True)
def state():return adm('state')
try:
 start()
 h1=cap('H1','R1','H1','human');h2=cap('H2','R1','H2','human')
 a1=cap('A','R1','A1');a2=cap('A','R2','A2');b=cap('B','R1','B1')
 request(h1,'post',{'key':'h1','text':'first human'})
 request(h2,'post',{'key':'h2','text':'second human'})
 check({m['actor'] for m in state()['messages'].values()}=={'H1','H2'},'two human principals preserve independent authors')
 request(a1,'post',{'key':'forged','text':'bad','actor':'B'},expected=400)
 request(a1,'post',{'key':'otherroom','text':'bad','room':'R2'},expected=400)
 check(True,'author and room override rejected')
 s=request(a1,'begin',{'key':'stream'})
 request(b,'append',{'stream':s['id'],'seq':0,'text':'hijack'},expected=403)
 request(a2,'append',{'stream':s['id'],'seq':0,'text':'hijack'},expected=403)
 check(True,'other agent and same agent other activation cannot append stream')
 request(a1,'append',{'stream':s['id'],'seq':1,'text':'gap'},expected=409)
 request(a1,'append',{'stream':s['id'],'seq':0,'text':'Hello '})
 request(a1,'append',{'stream':s['id'],'seq':0,'text':'Hello '})
 request(a1,'append',{'stream':s['id'],'seq':0,'text':'conflict'},expected=409)
 request(a1,'append',{'stream':s['id'],'seq':1,'text':'B'})
 check(len(state()['deliveries'])==0,'begin append replay never wake an agent')
 first=request(a1,'commit',{'stream':s['id'],'targets':['B']})
 duplicate=request(a1,'commit',{'stream':s['id'],'targets':['B']})
 request(a1,'commit',{'stream':s['id'],'targets':['A']},expected=409)
 check(True,'conflicting commit retry recipient is rejected')
 check(first==duplicate and len(state()['deliveries'])==1,'lost commit acknowledgment retry returns one publication and one delivery')
 did=next(iter(state()['deliveries']))
 request(b,'ack',{'delivery':did});request(b,'settle')
 check(state()['deliveries'][did]['state']=='completed' and len(state()['messages'])==3,'ack and no-post settle is successful silence')
 request(b,'post',{'key':'stale','text':'bad'},expected=403)
 check(True,'idle activation cannot publish late')
 old=request(a1,'post',{'key':'oldroom','text':'old reply'})
 new=request(a2,'post',{'key':'newroom','text':'new reply'})
 check(old['room']=='R1' and new['room']=='R2','same agent concurrent immutable capabilities retain their original rooms')
 s2=request(a2,'begin',{'key':'aborted'});adm('stop',activation='A2')
 request(a2,'append',{'stream':s2['id'],'seq':0,'text':'late'},expected=403)
 check(state()['streams'][s2['id']]['state']=='aborted','stop makes open stream terminal and fences stale appends')
 server.terminate();server.wait();start()
 request(a2,'post',{'key':'after-restart','text':'late'},expected=403)
 replay=request(a1,'commit',{'stream':s['id'],'targets':['B']})
 check(replay==first and len(state()['deliveries'])==1,'restart preserves canceled fence and publication/delivery replay identity')
 check(len(state()['messages'])==5,'no phantom public output after all negative operations')
 evidence={'passed':results,'state':state(),'limitations':['No generic active lease fencing on restart; canceled leases persist fenced.','No OS principal isolation; this validates HTTP capability boundary.','No live model in deterministic fixture.','No full production scheduler, membership revocation, or browser streaming UI.']}
 (root.parent/'protocol-evidence.json').write_text(json.dumps(evidence,indent=2))
finally:
 if server:server.terminate();server.wait()
