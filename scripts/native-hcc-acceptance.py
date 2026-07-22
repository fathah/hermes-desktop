#!/usr/bin/env python3
"""Exhaustive Windows native HCC view acceptance for the upstream shell."""
from __future__ import annotations
import json
import os
import subprocess
import sys
import time

DRIVER = r"C:\Users\patri\.local\bin\cua-driver.exe" if os.name == "nt" else "/mnt/c/Users/patri/.local/bin/cua-driver.exe"
VIEWS = [
    ("War Room", "HCC OS / WAR ROOM"),
    ("Control Plane", "CONTROL PLANE"),
    ("Intelligence", "HCC OS / INTELLIGENCE FABRIC"),
    ("Executions", "HUMAN-GATED RUNTIME"),
    ("Capture", "HCC OS / UNIVERSAL INGRESS"),
    ("Decisions", "HCC OS / DELIBERATE STEERING"),
    ("Relationships", "HCC OS / PRIVATE RELATIONSHIP INTELLIGENCE"),
    ("Gateway Map", "OPERATOR FABRIC"),
    ("Opportunities", "DEEP ADVANTAGE · M10"),
    ("Learning", "Turn captured material into demonstrated capability."),
    ("Projects", "HCC OS / PROJECTS"),
    ("Domains", "HCC OS / DOMAINS"),
    ("Memory", "HCC OS / MEMORY BACKBONE"),
    ("Personal API", "HCC OS / MEANING + AUTOMATION"),
    ("Plugins", "HCC OS / APP PLATFORM"),
    ("Review", "HCC OS / REVIEW ENGINE"),
    ("Registry", "HCC OS / CANONICAL STORE"),
    ("Graph", "HCC OS / RELATIONSHIP LAYER"),
    ("Clone / Remix", "HCC OS / CREATIVE INTELLIGENCE"),
]

def call(tool: str, payload: dict) -> dict:
    raw = subprocess.check_output([DRIVER, "call", tool, json.dumps(payload)], text=True).strip()
    try:
        return json.loads(raw) if raw else {}
    except json.JSONDecodeError:
        return {"message": raw}

def state(pid: int, window_id: int) -> dict:
    return call("get_window_state", {"pid": pid, "window_id": window_id, "include_screenshot": False, "max_elements": 500})

def labels(snapshot: dict) -> str:
    return "\n".join(str(item.get("label") or "") for item in snapshot["elements"])

def click_label(pid: int, window_id: int, label: str) -> None:
    snapshot = state(pid, window_id)
    button = next(item for item in snapshot["elements"] if item.get("role") == "Button" and item.get("label") == label)
    call("click", {"pid": pid, "window_id": window_id, "element_index": button["element_index"], "delivery_mode": "foreground"})

def main() -> int:
    windows = call("list_windows", {"on_screen_only": True}).get("windows", [])
    window = next((item for item in windows if item.get("app_name") == "hermes-agent.exe"), None)
    if not window:
        window = next((item for item in windows if item.get("app_name") == "electron.exe"), None)
    if not window:
        raise SystemExit("Hermes desktop window not found")
    pid, window_id = window["pid"], window["window_id"]
    click_label(pid, window_id, "HCC OS")
    time.sleep(0.5)
    results = []
    for label, expected in VIEWS:
        error = None
        try:
            click_label(pid, window_id, f"HCC: {label}")
        except Exception as exc:
            error = str(exc)
        deadline = time.time() + (20 if label == "Intelligence" else 5)
        snapshot = state(pid, window_id)
        text = labels(snapshot)
        while expected.lower() not in text.lower() and time.time() < deadline:
            time.sleep(0.5)
            snapshot = state(pid, window_id)
            text = labels(snapshot)
        errors = [
            str(item.get("label"))
            for item in snapshot["elements"]
            if (lambda value: value.startswith(("error invoking", "failed to load")) or (value.endswith(" unavailable") and value.strip() != "unavailable"))(str(item.get("label") or "").lower())
        ]
        results.append({"view": label, "passed": error is None and expected.lower() in text.lower() and not errors, "expected": expected, "errors": errors or ([error] if error else [])})
    report = {"total": len(results), "passed": sum(item["passed"] for item in results), "failed": [item for item in results if not item["passed"]]}
    print(json.dumps(report, indent=2))
    return 1 if report["failed"] else 0

if __name__ == "__main__":
    sys.exit(main())
