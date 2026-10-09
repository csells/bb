import json
from pathlib import Path
root=Path(__file__).parent
e=json.loads((root/'live-attempt3-passed.json').read_text())
messages=list(e['publicState']['messages'].values())
a_text=[r['text'] for r in e['privateTranscripts']['AgentA']['rows'] if r.get('role')=='assistant']
assert a_text and all(t not in [m['text'] for m in messages] for t in a_text)
private='PRIVATE_NO_POST AgentB: test fixture. @AgentB.'
assert any(r.get('role')=='assistant' and private in r.get('text','') for r in e['privateTranscripts']['noPost']['rows'])
assert not any(private in m['text'] for m in messages)
assert len(e['publicState']['deliveries'])==3
assert e['topLevel']=={'a':None,'b':None}
assert e['busyQueueReceipt']['delivery']=='queued'
print('PASS recorded AgentA ordinary final is absent from public messages')
print('PASS actual later private other-agent label and mention exists, absent from all public messages')
print('PASS only two explicitly requested initial deliveries plus second human busy request exist')
print('PASS both recorded BB parentThreadId fields are null and busy receipt is queued')
