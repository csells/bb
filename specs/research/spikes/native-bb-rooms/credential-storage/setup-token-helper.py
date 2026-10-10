import fcntl
import json
import os
from pathlib import Path
import pty
import re
import select
import shlex
import signal
import struct
import subprocess
import sys
import termios
import time
from urllib.parse import urlparse


BASE = Path('/Users/admin/.bb-rooms-stage/private/setup-token-20261010')
STATUS = BASE / 'status.json'


def private_write(path, value):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as stream:
        stream.write(value)


def status(value):
    private_write(STATUS, json.dumps(value))


def run():
    os.umask(0o077)
    BASE.mkdir(parents=True, exist_ok=False, mode=0o700)
    config = BASE / 'config'
    config.mkdir(mode=0o700)
    browser = BASE / 'capture-browser'
    private_write(browser, '#!/bin/sh\nprintf "%s" "$1" > "' + str(BASE / 'authorization-url') + '"\n')
    browser.chmod(0o700)
    env = {key: value for key, value in os.environ.items() if key not in ('CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN')}
    env.update({'CLAUDE_CONFIG_DIR': str(config), 'BROWSER': str(browser), 'TERM': 'xterm-256color', 'PATH': '/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin'})
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 50, 300, 0, 0))
    process = subprocess.Popen(['/opt/homebrew/bin/claude', 'setup-token'], stdin=slave, stdout=slave, stderr=slave, cwd=BASE, env=env, start_new_session=True)
    os.close(slave)
    status({'phase': 'starting', 'helperPid': os.getpid(), 'cliPid': process.pid})
    output = BASE / 'terminal.private'
    captured = bytearray()
    code_sent = False
    authorization_url = None
    deadline = time.monotonic() + 1800
    try:
        with output.open('wb') as transcript:
            while time.monotonic() < deadline:
                if select.select([master], [], [], 0.25)[0]:
                    try:
                        chunk = os.read(master, 65536)
                    except OSError:
                        break
                    if not chunk:
                        break
                    transcript.write(chunk)
                    transcript.flush()
                    captured.extend(chunk)
                    visible = re.sub(rb'\x1b\[[0-?]*[ -/]*[@-~]', b'', captured).decode('utf-8', errors='replace')
                    token = re.search(r'sk-ant-oat01-[A-Za-z0-9_-]{40,}(?=\s)', visible)
                    if token:
                        private_write(BASE / 'token.env', 'CLAUDE_CODE_OAUTH_TOKEN=' + shlex.quote(token.group()) + '\n')
                        status({'phase': 'complete', 'tokenFile': str(BASE / 'token.env')})
                        return
                    if authorization_url is None:
                        url_file = BASE / 'authorization-url'
                        candidates = [url_file.read_text()] if url_file.exists() else re.findall(r'https://[^\s\x1b]+', visible)
                        for candidate in candidates:
                            parsed = urlparse(candidate)
                            if parsed.hostname in ('claude.ai', 'claude.com') and '/oauth/authorize' in parsed.path:
                                authorization_url = candidate
                                private_write(BASE / 'authorization-url', candidate)
                                status({'phase': 'awaiting_authorization', 'authorizationUrl': candidate, 'helperPid': os.getpid(), 'cliPid': process.pid})
                                break
                code_file = BASE / 'authorization.env'
                if not code_sent and code_file.exists():
                    assignments = [line.split('=', 1)[1] for line in code_file.read_text().splitlines() if line.startswith('CLAUDE_SETUP_CODE=')]
                    if len(assignments) != 1:
                        raise ValueError('invalid code assignment')
                    fields = shlex.split(assignments[0])
                    if len(fields) != 1 or not 1 <= len(fields[0]) <= 4096 or any(ord(character) < 32 for character in fields[0]):
                        raise ValueError('invalid code')
                    os.write(master, fields[0].encode() + b'\r')
                    code_file.unlink()
                    code_sent = True
                    status({'phase': 'authorization_submitted', 'helperPid': os.getpid(), 'cliPid': process.pid})
                if process.poll() is not None:
                    break
        status({'phase': 'failed', 'exitCode': process.poll(), 'reason': 'No token captured; inspect private terminal locally without exporting credentials'})
    except Exception as error:
        status({'phase': 'failed', 'reason': type(error).__name__})
    finally:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=5)
        os.close(master)


if sys.argv[1] == 'run':
    run()
elif sys.argv[1] == 'status':
    print(STATUS.read_text() if STATUS.exists() else json.dumps({'phase': 'not_started'}))
