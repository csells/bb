import json
import os
from pathlib import Path
import secrets
import subprocess
import sys


BASE = Path('/Users/admin/.bb-rooms-stage/private')
KEYCHAIN = Path('/Users/admin/Library/Keychains/bb-rooms-stage.keychain-db')
PASSWORD = BASE / 'keychain-password'
METADATA = BASE / 'keychain-before.json'
PROBE = BASE / 'keychain-probe-value'
SERVICE = 'BB Rooms staging keychain qualification'
ACCOUNT = 'admin'


def command(args, input=None):
    result = subprocess.run(['/usr/bin/security', *args], input=input,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15)
    if result.returncode or result.stderr.strip():
        raise RuntimeError(f'security {args[0]}: exit {result.returncode}')
    return result.stdout


def private_write(path, data):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(data)


def unlock():
    password = PASSWORD.read_text()
    query = f'unlock-keychain -p "{password}" "{KEYCHAIN}"\n'
    command(['-i'], query.encode())


def create():
    if KEYCHAIN.exists() or PASSWORD.exists() or METADATA.exists():
        raise RuntimeError('dedicated keychain state already exists; inspect before reuse')
    BASE.mkdir(parents=True, exist_ok=True, mode=0o700)
    before = {
        'default': command(['default-keychain', '-d', 'user']).decode().strip().strip('"'),
        'search': [line.strip().strip('"') for line in command(['list-keychains', '-d', 'user']).decode().splitlines()]
    }
    private_write(METADATA, json.dumps(before).encode())
    password = secrets.token_urlsafe(48).encode()
    private_write(PASSWORD, password)
    query = f'create-keychain -p "{password.decode()}" "{KEYCHAIN}"\n'
    command(['-i'], query.encode())
    configure()


def configure():
    unlock()
    before = json.loads(METADATA.read_text())
    command(['set-keychain-settings', str(KEYCHAIN)])
    command(['list-keychains', '-d', 'user', '-s', str(KEYCHAIN), *before['search']])
    command(['default-keychain', '-d', 'user', '-s', str(KEYCHAIN)])


def write_probe(update):
    if update:
        if not PROBE.exists():
            raise RuntimeError('initial probe missing')
        PROBE.unlink()
    private_write(PROBE, secrets.token_urlsafe(32).encode())
    value = PROBE.read_bytes()
    query = f'add-generic-password -U -a "{ACCOUNT}" -s "{SERVICE}" -T /usr/bin/security -X "{value.hex()}"\n'
    command(['-i'], query.encode())


def read_probe():
    actual = command(['find-generic-password', '-a', ACCOUNT, '-s', SERVICE, '-w']).rstrip(b'\n')
    expected = PROBE.read_bytes()
    if actual != expected and actual != expected.hex().encode():
        raise RuntimeError('probe read did not match stored value')


def cleanup_probe():
    command(['delete-generic-password', '-a', ACCOUNT, '-s', SERVICE, str(KEYCHAIN)])
    PROBE.unlink(missing_ok=True)


def rollback():
    before = json.loads(METADATA.read_text())
    command(['default-keychain', '-d', 'user', '-s', before['default']])
    command(['list-keychains', '-d', 'user', '-s', *before['search']])
    command(['delete-keychain', str(KEYCHAIN)])
    PASSWORD.unlink()
    PROBE.unlink(missing_ok=True)


operation = sys.argv[1]
operations = {
    'create': create,
    'configure': configure,
    'unlock': unlock,
    'probe-write': lambda: write_probe(False),
    'probe-update': lambda: write_probe(True),
    'probe-read': read_probe,
    'probe-cleanup': cleanup_probe,
    'rollback': rollback,
}
try:
    operations[operation]()
    print(json.dumps({'operation': operation, 'ok': True}))
except Exception as error:
    print(json.dumps({'operation': operation, 'ok': False, 'error': str(error)}))
    sys.exit(1)
