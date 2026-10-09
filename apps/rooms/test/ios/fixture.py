import argparse
import json
import mimetypes
import pathlib
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

parser = argparse.ArgumentParser()
parser.add_argument('--web', required=True)
parser.add_argument('--evidence', required=True)
parser.add_argument('--port', type=int, default=38901)
args = parser.parse_args()
web = pathlib.Path(args.web).resolve()
evidence = pathlib.Path(args.evidence)
evidence.mkdir(parents=True, exist_ok=True)
user = {'id': 'safari-human', 'name': 'Safari Human', 'handle': 'safari'}
room = {'id': 'safari-room', 'name': 'Safari Rooms verification', 'ownerId': user['id'], 'revision': 1, 'paused': False, 'pauseReason': None, 'maxActivations': None, 'activationsUsed': 0}
snapshot = {'room': room, 'members': [{**user, 'role': 'owner'}], 'agents': [], 'messages': [], 'deliveries': [], 'online': [user['id']]}
audit = []
script = r'''<script>
(() => {
  let firstDrawer = null;
  let previous = '';
  let openCount = 0;
  let wasOpen = false;
  const observe = () => {
    const root = document.querySelector('#root');
    const drawer = document.querySelector('[data-bb-portaled-overlay][role="dialog"]');
    const open = drawer?.dataset.state === 'open';
    if (open && !wasOpen) openCount++;
    wasOpen = open;
    if (drawer && !firstDrawer) firstDrawer = drawer;
    const result = {
      time: performance.now(), rootInert: root?.hasAttribute('inert') ?? false,
      rootHidden: root?.getAttribute('aria-hidden') === 'true', open: !!open,
      openCount, realized: !!drawer?.querySelector('#room-panel-title'),
      placeholder: !!drawer?.querySelector('[data-responsive-drawer-placeholder]'),
      sameDrawer: !drawer || !firstDrawer || drawer === firstDrawer,
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      keyboardHeight: innerHeight - (visualViewport?.height ?? innerHeight)
    };
    const signature = JSON.stringify({...result, time: 0});
    if (signature !== previous) {
      previous = signature;
      fetch('/test/audit', {method: 'POST', body: JSON.stringify(result)});
    }
  };
  new MutationObserver(observe).observe(document.documentElement, {subtree: true, childList: true, attributes: true, attributeFilter: ['inert', 'aria-hidden', 'data-state']});
  window.addEventListener('resize', observe);
  window.visualViewport?.addEventListener('resize', observe);
  window.addEventListener('load', observe);
})();
</script>'''

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *values):
        pass

    def respond(self, value, status=200):
        data = json.dumps(value).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/test/evidence':
            return self.respond({'audit': audit, 'messages': snapshot['messages']})
        if path == '/api/me':
            return self.respond({'user': user, 'rooms': [room]})
        if path.endswith('/events'):
            return self.respond({'error': 'Fixture uses snapshot polling'}, 404)
        if path.startswith('/api/rooms/'):
            return self.respond(snapshot)
        target = (web / path.lstrip('/')).resolve()
        if not target.is_relative_to(web):
            return self.respond({'error': 'Invalid path'}, 403)
        if not target.is_file():
            target = web / 'index.html'
        data = target.read_bytes()
        if target.name == 'index.html':
            data = data.replace(b'</head>', script.encode() + b'</head>')
        self.send_response(200)
        self.send_header('Content-Type', mimetypes.guess_type(target.name)[0] or 'application/octet-stream')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        value = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or '{}')
        if self.path == '/test/audit':
            audit.append(value)
            (evidence / 'safari-dom-audit.json').write_text(json.dumps(audit, indent=2))
            return self.respond({'ok': True})
        if self.path.endswith('/messages'):
            message = {'id': value['requestId'], 'roomId': room['id'], 'authorId': user['id'], 'authorName': user['name'], 'kind': 'human', 'text': value['text'], 'status': 'complete', 'createdAt': int(time.time() * 1000), 'causeId': None, 'intent': value['intent'], 'recipients': value['recipients'], 'replyTo': None}
            snapshot['messages'].append(message)
            room['revision'] += 1
            (evidence / 'safari-messages.json').write_text(json.dumps(snapshot['messages'], indent=2))
            return self.respond(message)
        return self.respond({'error': 'Unsupported fixture operation'}, 404)

ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()
