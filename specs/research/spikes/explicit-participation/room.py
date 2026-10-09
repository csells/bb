import json, sys, urllib.request
from pathlib import Path
cap=json.loads(Path(sys.argv[1]).read_text())
raw = sys.argv[3] if len(sys.argv)>3 else '{}'
args = json.loads(Path(raw[1:]).read_text()) if raw.startswith('@') else json.loads(raw)
if not isinstance(args,dict): raise SystemExit('Arguments must be a JSON object, or @path to a JSON file')
req=urllib.request.Request(cap['endpoint']+'/operation',data=json.dumps({'op':sys.argv[2], 'args':args}).encode(),headers={'Authorization':'Bearer '+cap['token'],'Content-Type':'application/json'})
with urllib.request.urlopen(req) as response: print(response.read().decode())
