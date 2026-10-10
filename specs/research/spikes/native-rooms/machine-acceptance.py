import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import signal
import sqlite3
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid


BASE = 'http://127.0.0.1:38910'
QA = Path('/Users/admin/rooms-native-qa')
REPO = Path('/Users/admin/code/Forks/get-bb/bb-native-rooms')
TOKEN = (QA / 'operator-token').read_text().strip()
FIXTURE = QA / ('machine-fixture-' + uuid.uuid4().hex)
REPORT = QA / 'machine-acceptance.json'
os.umask(0o077)
FIXTURE.mkdir(mode=0o700)
report = {'gateway': BASE, 'fixtureDirectory': str(FIXTURE), 'steps': []}
host_id = None
daemon = None
original_access = None
phase = 'starting'


def request(path, method='GET', payload=None, headers=None, operator=True):
    values = {'authorization': 'Bearer ' + TOKEN} if operator else {}
    if headers:
        values.update(headers)
    data = None if payload is None else json.dumps(payload).encode()
    if data is not None:
        values['content-type'] = 'application/json'
    target = path if path.startswith('http') else BASE + path
    req = urllib.request.Request(target, data=data, headers=values, method=method)
    try:
        response = urllib.request.urlopen(req, timeout=90)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, response.headers, response.read()


def api(path, method='GET', payload=None):
    status, _, body = request('/api/v1' + path, method, payload)
    if not 200 <= status < 300:
        raise RuntimeError('API status ' + str(status))
    return json.loads(body)


def record(step, **values):
    report['steps'].append({'step': step, **values})
    REPORT.write_text(json.dumps(report, indent=2) + '\n')


try:
    phase = 'settings'
    existing_hosts = api('/hosts')
    previous_ids = {host['id']: host['status'] for host in existing_hosts}
    settings = api('/system/config')['generalSettings']
    original_access = {key: settings[key] for key in ('machineServerUrl', 'defaultMachineAccess')}
    api('/settings/general', 'PUT', {**settings, 'machineServerUrl': BASE, 'defaultMachineAccess': 'direct'})
    record('direct_access_configured')
    phase = 'create_machine'
    host = api('/hosts', 'POST', {'key': 'rooms-machine-acceptance-' + uuid.uuid4().hex, 'machineProviderId': 'manual', 'inputs': None})
    host_id = host['id']
    report['hostId'] = host_id
    deadline = time.monotonic() + 60
    enrollment = None
    while time.monotonic() < deadline:
        enrollment = api('/hosts/' + host_id + '/enrollment-command')
        if enrollment:
            break
        time.sleep(0.5)
    if not enrollment:
        raise RuntimeError('No enrollment command')
    words = shlex.split(enrollment['command'])
    header = words[words.index('-H') + 1]
    header_name, header_value = header.split(': ', 1)
    installer_url = next(word for word in words if word.startswith('http'))
    if installer_url != BASE + '/install.sh' or header_name.lower() != 'x-bb-enrollment':
        raise RuntimeError('Unexpected installer command')
    status, _, installer = request(installer_url, headers={header_name: header_value}, operator=False)
    if status != 200:
        raise RuntimeError('Installer status ' + str(status))
    assignment = shlex.split(installer.decode().splitlines()[0])
    if len(assignment) != 2 or assignment[0] != 'export' or not assignment[1].startswith('BB_ENROLLMENT='):
        raise RuntimeError('Invalid installer bootstrap')
    bootstrap = json.loads(assignment[1].split('=', 1)[1])
    if bootstrap['hostId'] != host_id or bootstrap['serverUrl'] != BASE:
        raise RuntimeError('Bootstrap identity mismatch')
    (FIXTURE / 'bootstrap.json').write_text(json.dumps(bootstrap))
    record('generated_installer_retrieved', status=status, serverUrl=bootstrap['serverUrl'])
    phase = 'artifacts'
    status, _, body = request('/install/version', operator=False)
    version = json.loads(body)
    if status != 200 or not version.get('version'):
        raise RuntimeError('Version endpoint failed')
    status, headers, artifact = request('/install/bb-app.tgz', operator=False)
    digest = hashlib.sha256(artifact).hexdigest()
    if status != 200 or digest != headers.get('x-bb-artifact-sha256'):
        raise RuntimeError('Artifact integrity failed')
    record('installer_artifact_verified', bytes=len(artifact), sha256=digest, protocolVersion=version.get('protocolVersion'))
    package_file = FIXTURE / 'bb-app.tgz'
    package_file.write_bytes(artifact)
    del artifact
    phase = 'enroll_cli'
    env = {key: value for key, value in os.environ.items() if not key.startswith('BB_') and key not in ('CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'OPENAI_API_KEY')}
    env.update({'PATH': '/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin', 'BB_DATA_DIR': str(FIXTURE / 'data'), 'BB_SERVER_URL': BASE, 'BB_APP_URL': BASE, 'BB_HOST_DAEMON_AUTO_UPDATE': 'false', 'BB_HOST_DAEMON_SUPERVISED': 'false'})
    with (FIXTURE / 'process.private').open('wb') as private_log:
        phase = 'install_served_package'
        prefix = FIXTURE / 'runtime'
        result = subprocess.run(['/opt/homebrew/bin/npm', 'install', '-g', '--allow-scripts=better-sqlite3,node-pty,@parcel/watcher', '--prefix', str(prefix), str(package_file)], cwd=FIXTURE, env=env, stdout=private_log, stderr=subprocess.STDOUT, timeout=300)
        if result.returncode != 0:
            raise RuntimeError('Served package installation failed')
        record('served_package_installed')
        phase = 'enroll_cli'
        package_root = prefix / 'lib/node_modules/bb-app'
        result = subprocess.run(['/opt/homebrew/bin/node', str(package_root / 'dist/bb.js'), 'machine', 'enroll', '--bootstrap-file', str(FIXTURE / 'bootstrap.json')], cwd=FIXTURE, env=env, stdout=private_log, stderr=subprocess.STDOUT, timeout=90)
        if result.returncode != 0:
            raise RuntimeError('CLI enrollment failed')
        status, _, _ = request('/internal/hosts/enroll', 'POST', {'hostId': host_id, 'hostName': 'replay'}, {'authorization': 'Bearer ' + bootstrap['credential']}, operator=False)
        if status != 401:
            raise RuntimeError('Enrollment replay was accepted')
        record('cli_enrolled_and_replay_denied', replayStatus=status)
        phase = 'daemon_connect'
        daemon_port = (FIXTURE / 'data/host-daemon-port').read_text().strip()
        daemon = subprocess.Popen(['/opt/homebrew/bin/node', str(package_root / 'dist/bb-host-daemon.js'), '--server-url', BASE, '--host-daemon-port', daemon_port], cwd=FIXTURE, env=env, stdout=private_log, stderr=subprocess.STDOUT, start_new_session=True)
        report['daemonPid'] = daemon.pid
        deadline = time.monotonic() + 90
        connected = False
        while time.monotonic() < deadline:
            if daemon.poll() is not None:
                raise RuntimeError('Fixture daemon exited')
            host = api('/hosts/' + host_id)
            if host['status'] == 'connected' and host['lifecycle']['phase'] == 'active':
                connected = True
                break
            time.sleep(1)
        if not connected:
            raise RuntimeError('Fixture daemon did not connect')
        record('real_daemon_connected', status=host['status'], phase=host['lifecycle']['phase'])
        phase = 'daemon_rpc'
        sentinel = FIXTURE / 'data' / 'rooms-machine-sentinel.txt'
        sentinel.write_text('native gateway fixture\n')
        listing = api('/hosts/' + host_id + '/directory?' + urllib.parse.urlencode({'path': str(sentinel.parent)}))
        if not any(entry['name'] == sentinel.name for entry in listing['entries']):
            raise RuntimeError('Daemon WebSocket RPC did not return fixture')
        with sqlite3.connect('file:' + str(QA / 'bb-data' / 'bb.db') + '?mode=ro', uri=True) as connection:
            row = connection.execute('SELECT status, protocol_version FROM host_daemon_sessions WHERE host_id=? ORDER BY created_at DESC LIMIT 1', (host_id,)).fetchone()
        if row is None or row[0] != 'active':
            raise RuntimeError('No native active daemon session')
        record('native_session_and_websocket_rpc_verified', sessionStatus=row[0], protocolVersion=row[1], sentinelFound=True)
        current_hosts = {host['id']: host['status'] for host in api('/hosts')}
        if any(current_hosts.get(host_id) != status for host_id, status in previous_ids.items()):
            raise RuntimeError('Existing host status changed')
        record('existing_hosts_preserved', count=len(previous_ids))
        report['passed'] = True
except Exception as error:
    report['passed'] = False
    report['failure'] = {'phase': phase, 'type': type(error).__name__}
finally:
    if daemon is not None and daemon.poll() is None:
        os.killpg(daemon.pid, signal.SIGTERM)
        try:
            daemon.wait(timeout=15)
        except subprocess.TimeoutExpired:
            os.killpg(daemon.pid, signal.SIGKILL)
            daemon.wait(timeout=5)
    report['daemonStopped'] = daemon is None or daemon.poll() is not None
    if host_id:
        try:
            api('/hosts/' + host_id, 'DELETE')
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                if not any(host['id'] == host_id for host in api('/hosts')):
                    report['hostRemoved'] = True
                    break
                time.sleep(0.5)
            else:
                report['hostRemoved'] = False
        except Exception:
            report['hostRemoved'] = False
    if original_access is not None:
        try:
            current = api('/system/config')['generalSettings']
            api('/settings/general', 'PUT', {**current, **original_access})
            report['settingsRestored'] = True
        except Exception:
            report['settingsRestored'] = False
    report['fixtureRemoved'] = False
    if report.get('passed') and report.get('hostRemoved') and report.get('settingsRestored') and report['daemonStopped']:
        shutil.rmtree(FIXTURE)
        report['fixtureRemoved'] = True
    REPORT.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))
    if not report.get('passed') or not report.get('fixtureRemoved'):
        raise SystemExit(1)
