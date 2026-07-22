#!/usr/bin/env python3
"""Exhaustive Windows native HCC view acceptance through Spotlight routing."""
from __future__ import annotations
import json,os,subprocess,sys,time
DRIVER=(r"C:\Users\patri\.local\bin\cua-driver.exe" if os.name=="nt" else "/mnt/c/Users/patri/.local/bin/cua-driver.exe")
VIEWS=[
("Open War Room","HCC OS / WAR ROOM"),("Open Control Plane","CONTROL PLANE"),
("Open Intelligence Fabric","HCC OS / INTELLIGENCE FABRIC"),("Open Execution Center","HUMAN-GATED RUNTIME"),
("Open Capture Inbox","HCC OS / UNIVERSAL INGRESS"),("Open Decision Center","HCC OS / DELIBERATE STEERING"),
("Open Relationship Center","HCC OS / PRIVATE RELATIONSHIP INTELLIGENCE"),("Open Gateway Map","OPERATOR FABRIC"),
("Open Opportunity Radar","DEEP ADVANTAGE · M10"),("Open Learning Engine","Turn captured material into demonstrated capability."),
("Open Projects","HCC OS / PROJECTS"),("Open Domains","HCC OS / DOMAINS"),("Open Memory Center","HCC OS / MEMORY BACKBONE"),
("Open Personal API","HCC OS / MEANING + AUTOMATION"),("Open Plugin Center","HCC OS / APP PLATFORM"),
("Open Review Center","HCC OS / REVIEW ENGINE"),("Open Registry","HCC OS / CANONICAL STORE"),
("Open Graph","HCC OS / RELATIONSHIP LAYER"),("Open Clone Remix","HCC OS / CREATIVE INTELLIGENCE"),
]
def call(tool,payload):
 raw=subprocess.check_output([DRIVER,"call",tool,json.dumps(payload)],text=True).strip()
 if not raw:return {}
 try:return json.loads(raw)
 except json.JSONDecodeError:return {"message":raw}
def state(pid,wid):return call("get_window_state",{"pid":pid,"window_id":wid,"include_screenshot":False,"max_elements":500})
def labels(s):return "\n".join(str(x.get("label") or "") for x in s["elements"])
def navigate(pid,wid,command,window):
 s=state(pid,wid);opener=next(x for x in s["elements"] if x.get("role")=="Button" and str(x.get("label") or "").startswith("Open spotlight"));call("click",{"pid":pid,"window_id":wid,"element_index":opener["element_index"],"delivery_mode":"background"});time.sleep(.2)
 s=state(pid,wid)
 if not any(x.get("role")=="Edit" for x in s["elements"]):
  opener=next(x for x in s["elements"] if x.get("role")=="Button" and str(x.get("label") or "").startswith("Open spotlight"));call("click",{"pid":pid,"window_id":wid,"element_index":opener["element_index"],"delivery_mode":"foreground"});time.sleep(.2);s=state(pid,wid)
 edit=next(x for x in s["elements"] if x.get("role")=="Edit" and x.get("label")=="Search views, commands, and workflows");call("set_value",{"pid":pid,"window_id":wid,"element_index":edit["element_index"],"value":command});time.sleep(.2)
 s=state(pid,wid);hit=next((x for x in s["elements"] if x.get("role")=="Button" and str(x.get("label") or "").startswith("Top hit ")),None)
 if not hit:return False,"top hit missing"
 call("click",{"pid":pid,"window_id":wid,"element_index":hit["element_index"],"delivery_mode":"foreground"});time.sleep(.45)
 return True,None
def main():
 windows=call("list_windows",{"on_screen_only":True}).get("windows",[]);window=next((x for x in windows if x.get("app_name")=="electron.exe" and str(x.get("title") or "").startswith("Hermes Agent")),None)
 if not window:raise SystemExit("Hermes Agent window not found")
 pid,wid=window["pid"],window["window_id"];results=[]
 for command,expected in VIEWS:
  try:ok,error=navigate(pid,wid,command,window)
  except Exception as exc:ok,error=False,str(exc)
  deadline=time.time()+(20 if command=="Open Intelligence Fabric" else 5);s=state(pid,wid);text=labels(s)
  while expected.lower() not in text.lower() and time.time()<deadline:
   time.sleep(.5);s=state(pid,wid);text=labels(s)
  errors=[str(x.get("label")) for x in s["elements"] if (lambda value:value.startswith(("error invoking","failed to load")) or (value.endswith(" unavailable") and value.strip()!="unavailable"))(str(x.get("label") or "").lower())]
  results.append({"view":command,"passed":ok and expected.lower() in text.lower() and not errors,"expected":expected,"errors":errors or ([error] if error else [])})
 report={"total":len(results),"passed":sum(x["passed"] for x in results),"failed":[x for x in results if not x["passed"]]};print(json.dumps(report,indent=2));return 1 if report["failed"] else 0
if __name__=="__main__":sys.exit(main())
