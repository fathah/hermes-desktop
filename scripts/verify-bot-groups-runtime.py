#!/usr/bin/env python3
"""Exercise real Hermes groups and ordinary Chat with isolated state and a local provider.

Run with a Python environment that includes the Agent Dashboard dependencies.
No real provider credential, user profile or paid model endpoint is used.
"""
import argparse
import asyncio
import json
import os
from pathlib import Path
import secrets
import shutil
import sys
import socket
import subprocess
import tempfile
import time
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import websockets

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--agent-repo', type=Path, default=Path(__file__).resolve().parents[1].parent / 'hermes-agent')
parser.add_argument('--python', default=sys.executable, help='Interpreter used for the isolated Dashboard')
parser.add_argument('--output', type=Path, default=Path('.sandbox/bot-groups-runtime/result.json'))
args = parser.parse_args()
ROOT = args.agent_repo.resolve()
PYTHON = args.python
if not (ROOT / 'hermes_cli' / 'web_server.py').is_file():
    parser.error('--agent-repo must point to a Hermes Agent checkout with Dashboard support')
trial = Path(tempfile.mkdtemp(prefix='hermes-held-950-runtime-'))
home = trial / 'home'
home.mkdir()
(home / 'profiles' / 'ops').mkdir(parents=True)
provider_calls = []

class TrialProvider(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass
    def do_GET(self):
        body = json.dumps({'object':'list', 'data':[{'id':'trial','object':'model','context_length':131072}]}).encode()
        self.send_response(200); self.send_header('Content-Type','application/json'); self.end_headers(); self.wfile.write(body)
    def do_POST(self):
        request = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        provider_calls.append(self.path)
        text = '(pass)' if any('[Discussion:' in str(m.get('content')) for m in request.get('messages', [])) else 'Isolated ordinary Chat trial completed.'
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream' if request.get('stream') else 'application/json')
        self.end_headers()
        response = {'id':'trial-completion', 'object':'chat.completion','created':int(time.time()),'model':'trial',
                    'choices':[{'index':0,'message':{'role':'assistant','content':text},'finish_reason':'stop'}],
                    'usage':{'prompt_tokens':100,'completion_tokens':10,'total_tokens':110}}
        if request.get('stream'):
            chunk = {**response, 'object':'chat.completion.chunk', 'choices':[{'index':0,'delta':{'role':'assistant','content':text},'finish_reason':None}]}
            self.wfile.write(('data: '+json.dumps(chunk)+'\n\n').encode())
            chunk['choices']=[{'index':0,'delta':{},'finish_reason':'stop'}]
            self.wfile.write(('data: '+json.dumps(chunk)+'\n\ndata: [DONE]\n\n').encode())
        else:
            self.wfile.write(json.dumps(response).encode())

provider = ThreadingHTTPServer(('127.0.0.1',0), TrialProvider)
threading.Thread(target=provider.serve_forever, daemon=True).start()
provider_url = f'http://127.0.0.1:{provider.server_port}/v1'
for target in (home, home / 'profiles' / 'ops'):
    (target / 'config.yaml').write_text(f'model:\n  provider: custom\n  default: trial\n  base_url: {provider_url}\n  api_key: isolated-trial-only\n  context_length: 131072\nagent:\n  max_turns: 3\n')
token = secrets.token_hex(24)
env = {'PATH': os.environ.get('PATH', ''), 'HOME': str(home), 'HERMES_HOME': str(home),
       'PYTHONPATH': str(ROOT), 'PYTHONDONTWRITEBYTECODE': '1',
       'HERMES_DASHBOARD_SESSION_TOKEN': token, 'HERMES_DASHBOARD_TUI': '1',
       'OPENAI_BASE_URL': provider_url, 'OPENAI_API_KEY': 'isolated-trial-only'}
evidence = {'agentRepo': str(ROOT), 'checks': []}

def launch():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        port = s.getsockname()[1]
    log = open(trial / f'backend-{port}.log', 'w')
    code = f'from hermes_cli.web_server import start_server; start_server(host="127.0.0.1", port={port}, open_browser=False)'
    proc = subprocess.Popen([PYTHON, '-c', code], cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
    return proc, port, log

async def connect(proc, port):
    for _ in range(100):
        if proc.poll() is not None:
            raise RuntimeError(f'Isolated backend exited {proc.returncode}')
        try:
            return await websockets.connect(f'ws://127.0.0.1:{port}/api/ws?token={token}', open_timeout=1)
        except (OSError, TimeoutError):
            await asyncio.sleep(.2)
    raise RuntimeError('Isolated backend did not become ready')

async def rpc(ws, method, params=None):
    rid = secrets.token_hex(4)
    await ws.send(json.dumps({'jsonrpc': '2.0', 'id': rid, 'method': method, 'params': params or {}}))
    while True:
        message = json.loads(await asyncio.wait_for(ws.recv(), 15))
        if message.get('id') == rid:
            if 'error' in message:
                raise RuntimeError(f'{method}: {message["error"]}')
            return message['result']

def stop(proc, log):
    proc.terminate()
    try:
        proc.wait(timeout=8)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=3)
    log.close()

# @lat: [[bot-groups#Verification#Runtime acceptance]]
async def run():
    proc, port, log = launch()
    try:
        async with await connect(proc, port) as ws:
            for _ in range(50):
                cap = await rpc(ws, 'groups.capabilities')
                if cap.get('driver'):
                    break
                await asyncio.sleep(.2)
            assert cap['protocol_version'] == 2 and cap['driver'] is True, cap
            evidence['checks'].append('Actual Dashboard startup advertises protocol 2 with a running hosted driver')
            profiles = await rpc(ws, 'profiles.list')
            assert {'default', 'ops'} <= {p['name'] for p in profiles['profiles']}, profiles
            room = (await rpc(ws, 'groups.create', {'room_id': 'trial-room', 'name': 'Recovery trial', 'members': [
                {'member_id':'default', 'profile':'default', 'handle':'hermes', 'display_name':'Hermes'},
                {'member_id':'ops', 'profile':'ops', 'handle':'ops', 'display_name':'Ops'}]}))['room']
            assert room['room_id'] == 'trial-room' and len(room['members']) == 2
            assert (await rpc(ws, 'groups.state', {'room_id':'trial-room'}))['driver_status']['running'] is True
            listed = await rpc(ws, 'groups.list', {'limit':100, 'offset':0})
            assert any(r['room_id'] == 'trial-room' for r in listed['rooms'])
            log_page = await rpc(ws, 'groups.log', {'room_id':'trial-room', 'since_seq':0, 'limit':100})
            evidence['checks'].append('Two-profile room creation, listing, state and replay use real RPC and SQLite')
            evidence['initialLogCount'] = len(log_page['events'])
            session = await rpc(ws, 'session.create', {'profile':'default', 'title':'Ordinary coexistence trial'})
            sid = session['session_id']
            accepted = await rpc(ws, 'prompt.submit', {'session_id':sid, 'text':'Return a short trial reply.'})
            assert accepted, accepted
            sent = await rpc(ws, 'groups.send', {'room_id':'trial-room','event_id':'trial-message','payload':{'thread_id':'trial-thread','text':'Each participant should pass.'}})
            assert sent['accepted'] is True
            for _ in range(120):
                state = await rpc(ws, 'groups.state', {'room_id':'trial-room'})
                log_page = await rpc(ws, 'groups.log', {'room_id':'trial-room','since_seq':0,'limit':100})
                history = await rpc(ws, 'session.history', {'session_id':sid})
                chat_done = any(m.get('role') == 'assistant' and 'Isolated ordinary Chat trial completed.' in str(m.get('text', m.get('content'))) for m in history.get('messages',[]))
                kinds = {e['kind'] for e in log_page['events']}
                settled_members = {
                    e['payload'].get('member_id')
                    for e in log_page['events']
                    if e['kind'] == 'turn.settled'
                }
                if chat_done and settled_members == {'default', 'ops'} and not state['driver_status']['working']:
                    break
                await asyncio.sleep(.25)
            assert chat_done, history
            assert 'turn.settled' in kinds and not ({'turn.failed', 'turn.cancelled'} & kinds), {'state':state,'log':log_page}
            settled_members = {e['payload'].get('member_id') for e in log_page['events'] if e['kind'] == 'turn.settled'}
            assert settled_members == {'default', 'ops'}, log_page
            assert not state['driver_status']['working'], state
            evidence['checks'].append('Actual Agent ordinary Chat and two-profile hosted discussion complete through an isolated OpenAI-compatible provider fixture')
            evidence['providerCalls'] = len(provider_calls)
            evidence['eventKinds'] = sorted(kinds)
    finally:
        stop(proc, log)
    proc, port, log = launch()
    try:
        async with await connect(proc, port) as ws:
            for _ in range(50):
                cap = await rpc(ws, 'groups.capabilities')
                if cap.get('driver'):
                    break
                await asyncio.sleep(.2)
            state = await rpc(ws, 'groups.state', {'room_id':'trial-room'})
            assert state['room']['name'] == 'Recovery trial'
            assert state['room']['authority_gateway_id'] == room['authority_gateway_id']
            assert cap['driver'] is True
            evidence['checks'].append('Backend restart recovers the same durable room and installation authority')
    finally:
        stop(proc, log)

try:
    asyncio.run(run())
    evidence['passed'] = True
except Exception as exc:
    evidence['passed'] = False
    evidence['error'] = f'{type(exc).__name__}: {exc}'
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(evidence, indent=2)+'\n')
if not evidence['passed']:
    for log_path in trial.glob('backend-*.log'):
        shutil.copy2(log_path, args.output.parent / log_path.name)
print(json.dumps(evidence, indent=2))
provider.shutdown()
shutil.rmtree(trial)
raise SystemExit(0 if evidence['passed'] else 1)
