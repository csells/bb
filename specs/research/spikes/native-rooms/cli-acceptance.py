import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import time
import urllib.error
import urllib.request
import uuid


QA = Path('/Users/admin/rooms-native-qa')
REPO = Path('/Users/admin/code/Forks/get-bb/bb-native-rooms')
BASE = 'http://127.0.0.1:38910'
PROJECT = 'proj_fwx8qghk8z'
ENVIRONMENT = 'env_hjav59i3rz'
TOKEN_FILE = QA / 'operator-token'
TOKEN = TOKEN_FILE.read_text().strip()
FIXTURE = QA / ('cli-fixture-' + uuid.uuid4().hex)
os.umask(0o077)
FIXTURE.mkdir(mode=0o700)
report = {'gateway': BASE, 'steps': []}
sections = []
room_id = None
thread_id = None
phase = 'starting'


def api(path, method='GET', payload=None):
    headers = {'authorization': 'Bearer ' + TOKEN}
    data = None
    if payload is not None:
        headers['content-type'] = 'application/json'
        data = json.dumps(payload).encode()
    req = urllib.request.Request(BASE + '/api/v1' + path, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=60) as response:
        return json.load(response)


def cli(*args):
    env = {key: value for key, value in os.environ.items() if not key.startswith('BB_')}
    result = subprocess.run(['/opt/homebrew/bin/node', str(REPO / 'apps/cli/dist/index.js'), 'rooms', '--server', BASE, '--token-file', str(TOKEN_FILE), *args], cwd=REPO, env=env, capture_output=True, timeout=90)
    (FIXTURE / ('command-' + str(len(report['steps'])) + '.private')).write_bytes(result.stdout + result.stderr)
    if result.returncode:
        raise RuntimeError('Rooms CLI exited ' + str(result.returncode))
    value = json.loads(result.stdout)
    report['steps'].append({'command': args[0], 'exitCode': result.returncode})
    return value


try:
    phase = 'sections'
    for suffix in ['create', 'update']:
        sections.append(api('/thread-sections', 'POST', {'name': 'CLI fixture ' + suffix + ' ' + uuid.uuid4().hex[:8]})['id'])
    phase = 'create'
    room = cli('create', 'Native CLI fixture ' + uuid.uuid4().hex[:8], '--project', PROJECT, '--environment', ENVIRONMENT, '--section', sections[0])
    room_id = room['id']
    report['roomId'] = room_id
    assert room['projectId'] == PROJECT and room['defaultEnvironmentId'] == ENVIRONMENT and room['sectionId'] == sections[0]
    phase = 'context'
    context = {'projectId': PROJECT, 'defaultEnvironmentId': ENVIRONMENT, 'sectionId': sections[1]}
    context_file = FIXTURE / 'context.json'
    context_file.write_text(json.dumps(context))
    updated = cli('context', room_id, '--file', str(context_file))
    assert all(updated[key] == value for key, value in context.items())
    phase = 'list_show'
    listed = cli('list')
    assert any(entry['id'] == room_id and entry['sectionId'] == sections[1] for entry in listed)
    shown = cli('show', room_id)
    assert all(shown['room'][key] == value for key, value in context.items())
    phase = 'pause'
    policy_file = FIXTURE / 'policy.json'
    policy_file.write_text(json.dumps({'paused': True, 'maxActivations': None}))
    cli('policy', room_id, '--file', str(policy_file))
    phase = 'scheduled_fixture_thread'
    thread = api('/threads', 'POST', {'projectId': PROJECT, 'providerId': 'codex', 'origin': 'sdk', 'title': 'CLI attachment fixture without dispatch', 'input': [{'type': 'text', 'text': 'Scheduled fixture; delete before dispatch.', 'mentions': []}], 'environment': {'type': 'reuse', 'environmentId': ENVIRONMENT}, 'sendAt': int(time.time() * 1000) + 86400000})
    thread_id = thread['id']
    report['threadId'] = thread_id
    assert thread['status'] != 'active'
    phase = 'attach'
    agent_file = FIXTURE / 'agent.json'
    agent_file.write_text(json.dumps({'handle': 'clifixture', 'name': 'CLI fixture agent', 'threadId': thread_id}))
    agent = cli('agent-add', room_id, '--file', str(agent_file))
    assert agent['threadId'] == thread_id and agent['projectId'] == PROJECT and agent['environmentId'] == ENVIRONMENT
    shown = cli('show', room_id)
    assert any(value['threadId'] == thread_id for value in shown['agents'])
    current = api('/threads/' + thread_id)
    assert current['status'] != 'active'
    report['providerTurnStarted'] = False
    report['attachedAuthoritativeContext'] = True
    report['passed'] = True
except Exception as error:
    report['passed'] = False
    report['failure'] = {'phase': phase, 'type': type(error).__name__}
finally:
    if room_id:
        try:
            with sqlite3.connect(QA / 'rooms-data/rooms.sqlite') as connection:
                connection.execute('PRAGMA foreign_keys=ON')
                assert connection.execute('SELECT count(*) FROM rooms_activations WHERE room_id=?', (room_id,)).fetchone()[0] == 0
                assert connection.execute('SELECT count(*) FROM rooms_messages WHERE room_id=?', (room_id,)).fetchone()[0] == 0
                connection.execute('DELETE FROM rooms_agents WHERE room_id=?', (room_id,))
                connection.execute('DELETE FROM rooms_members WHERE room_id=?', (room_id,))
                connection.execute('DELETE FROM rooms_rooms WHERE id=?', (room_id,))
            report['roomRemoved'] = True
        except Exception:
            report['roomRemoved'] = False
    if thread_id:
        try:
            api('/threads/' + thread_id, 'DELETE', {'childThreadsConfirmed': True})
            report['threadRemoved'] = True
        except Exception:
            report['threadRemoved'] = False
    report['sectionsRemoved'] = True
    for section in sections:
        try:
            api('/thread-sections', 'DELETE', {'id': section})
        except Exception:
            report['sectionsRemoved'] = False
    if report.get('passed') and report.get('roomRemoved') and report.get('threadRemoved') and report['sectionsRemoved']:
        shutil.rmtree(FIXTURE)
        report['fixtureRemoved'] = True
    else:
        report['fixtureRemoved'] = False
        report['fixtureDirectory'] = str(FIXTURE)
    (QA / 'cli-acceptance.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))
    if not report.get('passed') or not report.get('fixtureRemoved'):
        raise SystemExit(1)
