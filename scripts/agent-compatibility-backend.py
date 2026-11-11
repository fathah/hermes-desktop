#!/usr/bin/env python3
"""Run an isolated real Agent transport with controlled server-request stimuli.

The Agent's JSON-RPC validation, WebSocket auth, request correlation, cancellation
and replay are unchanged. Only eager model construction is disabled; compat.*
handlers generate requests without inference, credentials or shell execution.
This fixture must only run against a disposable home marked by its parent runner.
"""

import argparse
import os
from pathlib import Path
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--agent-repo", required=True, type=Path)
    parser.add_argument("--home", required=True, type=Path)
    parser.add_argument("--port", required=True, type=int)
    parser.add_argument("--token-file", required=True, type=Path)
    args = parser.parse_args()
    if not (args.home / ".desktop-compatibility-fixture").is_file():
        parser.error("the disposable home must contain .desktop-compatibility-fixture")
    os.environ["HERMES_HOME"] = str(args.home.resolve())
    os.environ["HERMES_DASHBOARD_SESSION_TOKEN"] = args.token_file.read_text().strip()
    os.environ["HERMES_SERVE_HEADLESS"] = "1"
    sys.path.insert(0, str(args.agent_repo.resolve()))

    from tui_gateway import server, server_requests
    from hermes_cli import web_server

    # A protocol smoke test must never build an AIAgent or contact a provider.
    server._schedule_agent_build = lambda _sid: None
    replies = {}
    cancellations = {}

    @server.method("compat.ask")
    def ask(rid, params):
        sid, key = params["session_id"], params["key"]
        if sid not in server._sessions:
            return server._err(rid, -32602, "unknown fixture session")
        replies.pop(key, None)
        cancellations[key] = server_requests.send_async(
            params["method"], sid, params["params"],
            lambda result: replies.__setitem__(key, result),
        )
        return server._ok(rid, {"accepted": True})

    @server.method("compat.result")
    def result(rid, params):
        key = params["key"]
        return server._ok(rid, {"present": key in replies, "value": replies.get(key)})

    @server.method("compat.cancel")
    def cancel(rid, params):
        settle = cancellations.pop(params["key"], None)
        if settle is not None:
            settle("fixture-cancel")
        return server._ok(rid, {"cancelled": settle is not None})

    web_server.start_server(
        host="127.0.0.1", port=args.port, open_browser=False,
        headless=True, isolated=True,
    )


if __name__ == "__main__":
    main()
