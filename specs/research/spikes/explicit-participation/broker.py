import hashlib, json, os, secrets, sqlite3, sys, time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

root = Path(sys.argv[1]); root.mkdir(parents=True, exist_ok=True)
os.chmod(root, 0o700)
db = sqlite3.connect(root / 'protocol.sqlite')
db.execute('CREATE TABLE IF NOT EXISTS state(id INTEGER PRIMARY KEY, data TEXT)')
row = db.execute('SELECT data FROM state WHERE id=1').fetchone()
state = json.loads(row[0]) if row else {'caps': {}, 'messages': {}, 'streams': {}, 'deliveries': {}, 'receipts': {}, 'events': []}
adminfile = root / 'admin'
if not adminfile.exists(): adminfile.write_text(secrets.token_urlsafe(32)); os.chmod(adminfile, 0o600)
admin = adminfile.read_text()
def save():
    with db: db.execute('INSERT OR REPLACE INTO state VALUES(1,?)', (json.dumps(state),))
def event(kind, **kwargs): state['events'].append({'at': time.time(), 'kind': kind, **kwargs})
def digest(s): return hashlib.sha256(s.encode()).hexdigest()
def issue(actor, kind, room, activation):
    token = secrets.token_urlsafe(32)
    state['caps'][digest(token)] = {'actor': actor, 'kind': kind, 'room': room, 'activation': activation, 'state': 'active'}
    return token
def fail(code, why): raise ValueError(code, why)
def message(c, body, key):
    mid = c['room'] + ':' + c['actor'] + ':' + key
    data = {'id': mid, 'actor': c['actor'], 'room': c['room'], 'activation': c['activation'], 'text': body['text'], 'targets': body.get('targets', []), 'replyTo': body.get('replyTo')}
    old = state['messages'].get(mid)
    if old:
        if old != data: fail(409, 'idempotency conflict')
        return old
    state['messages'][mid] = data
    event('publication', id=mid, actor=c['actor'], room=c['room'])
    for recipient in data['targets']:
        if recipient == c['actor']: continue
        did = mid + '->' + recipient
        state['deliveries'][did] = {'id': did, 'room': c['room'], 'recipient': recipient, 'message': mid, 'state': 'queued'}
        event('delivery-queued', id=did, recipient=recipient)
    return data
def operate(c, op, b):
    forbidden = {'actor', 'author', 'room', 'activation', 'token'} & b.keys()
    if forbidden: fail(400, 'identity and scope are server-bound')
    if c['state'] != 'active': fail(403, 'activation fenced')
    if op == 'read': return {'messages': [m for m in state['messages'].values() if m['room'] == c['room']]}
    if op == 'ack':
        d = state['deliveries'].get(b['delivery'])
        if not d or d['recipient'] != c['actor'] or d['room'] != c['room']: fail(403, 'wrong delivery')
        d.update(state='accepted', activation=c['activation']); event('delivery-accepted', id=d['id'], activation=c['activation']); return d
    if op in ['post', 'request']: return message(c, b, b['key'])
    if op == 'begin':
        sid = c['activation'] + ':' + b['key']
        stream = {'id': sid, 'actor': c['actor'], 'room': c['room'], 'activation': c['activation'], 'state': 'open', 'chunks': [], 'key': b['key']}
        old = state['streams'].get(sid)
        if old: return old
        state['streams'][sid] = stream; event('stream-begin', id=sid); return stream
    if op in ['append', 'commit', 'abort']:
        s = state['streams'].get(b['stream'])
        if not s or any(s[k] != c[k] for k in ['actor', 'room', 'activation']): fail(403, 'wrong stream owner')
        if op == 'commit' and s['state'] == 'committed':
            if s['commitArgs'] != b: fail(409, 'commit identity conflict')
            return state['messages'][s['message']]
        if s['state'] != 'open': fail(409, 'stream terminal')
        if op == 'append':
            seq = b['seq']; chunks = s['chunks']
            if seq < len(chunks):
                if chunks[seq] != b['text']: fail(409, 'chunk conflict')
                return s
            if seq != len(chunks): fail(409, 'chunk sequence gap')
            chunks.append(b['text']); event('stream-chunk', id=s['id'], seq=seq); return s
        if op == 'abort': s['state'] = 'aborted'; event('stream-aborted', id=s['id']); return s
        m = message(c, {'text': ''.join(s['chunks']), 'targets': b.get('targets', []), 'replyTo': b.get('replyTo')}, s['key'])
        s.update(state='committed', message=m['id'], commitArgs=b); event('stream-committed', id=s['id']); return m
    if op == 'settle':
        c['state'] = 'idle'
        for d in state['deliveries'].values():
            if d.get('activation') == c['activation']: d['state'] = 'completed'
        event('activation-idle', activation=c['activation']); return {'state': 'idle'}
    fail(400, 'unknown operation')
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_): pass
    def do_POST(self):
        try:
            body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            token = self.headers.get('Authorization', '').removeprefix('Bearer ')
            if self.path == '/admin':
                if token != admin: fail(403, 'denied')
                op = body['op']
                if op == 'issue': result = {'token': issue(body['actor'], body.get('kind','agent'), body['room'], body['activation'])}
                elif op == 'state': result = {k:v for k,v in state.items() if k != 'caps'}
                elif op == 'stop':
                    for c in state['caps'].values():
                        if c['activation'] == body['activation']: c['state'] = 'stopped'
                    for s in state['streams'].values():
                        if s['activation'] == body['activation'] and s['state'] == 'open': s['state'] = 'aborted'
                    event('activation-stopped', activation=body['activation']); result = {'stopped': True}
                else: fail(400,'unknown admin operation')
            else:
                c = state['caps'].get(digest(token))
                if not c: fail(401, 'unknown credential')
                result = operate(c, body['op'], body.get('args', {}))
            save(); status=200
        except ValueError as e:
            status, why = e.args if len(e.args)==2 else (400,str(e)); result={'error':why}
        except Exception as e: status=400; result={'error':type(e).__name__}
        data=json.dumps(result).encode(); self.send_response(status); self.send_header('Content-Type','application/json'); self.send_header('Content-Length',str(len(data))); self.end_headers(); self.wfile.write(data)
save()
server=HTTPServer(('127.0.0.1',0), Handler)
(root/'endpoint').write_text('http://127.0.0.1:'+str(server.server_port))
print('broker ready',flush=True); server.serve_forever()
