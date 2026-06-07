#!/usr/bin/env python3
import sys
import json
import argparse
from pathlib import Path

# Add current directory to path to import local modules
sys.path.insert(0, str(Path(__file__).parent.resolve()))

from token_juice import TokenJuice
from autonomy_security import AutonomySecurity, AutonomyTier, CommandClass, Decision
from memory_tree import MemoryTreeManager

def cmd_compress(args):
    compressor = TokenJuice()
    result = compressor.compress(args.text, args.tool)
    print(json.dumps({"compressed": result}))

def cmd_classify_command(args):
    security = AutonomySecurity(args.action_dir or str(Path.cwd()))
    cmd_args = json.loads(args.args)
    cmd_class = security.classify_command(cmd_args)
    print(json.dumps({"class": cmd_class.value}))

def cmd_is_path_allowed(args):
    security = AutonomySecurity(args.action_dir)
    allowed = security.is_path_allowed(args.path)
    print(json.dumps({"allowed": allowed}))

def cmd_evaluate_execution(args):
    security = AutonomySecurity(args.action_dir)
    cmd_args = json.loads(args.args)
    tier = AutonomyTier(args.tier)
    paths = json.loads(args.paths) if args.paths else None
    
    decision, reason = security.evaluate_command_execution(cmd_args, tier, paths)
    print(json.dumps({
        "decision": decision.value,
        "reason": reason
    }))

def cmd_memory_save(args):
    manager = MemoryTreeManager(args.vault)
    meta = json.loads(args.meta)
    manager.save_page(args.id, meta, args.body)
    print(json.dumps({"status": "success"}))

def cmd_memory_search(args):
    manager = MemoryTreeManager(args.vault)
    results = manager.search(args.query)
    print(json.dumps({"results": [{"id": r[0], "score": r[1]} for r in results]}))

def cmd_memory_graph(args):
    manager = MemoryTreeManager(args.vault)
    outgoing, backlinks = manager.build_link_graph()
    
    # Convert sets to lists for JSON serialization
    serialized_outgoing = {k: list(v) for k, v in outgoing.items()}
    serialized_backlinks = {k: list(v) for k, v in backlinks.items()}
    
    print(json.dumps({
        "outgoing": serialized_outgoing,
        "backlinks": serialized_backlinks
    }))

def main():
    parser = argparse.ArgumentParser(description="Hermes Agent Python Core Bridge CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # Compress Command
    p_compress = subparsers.add_parser("compress")
    p_compress.add_argument("--text", required=True, help="Text to compress")
    p_compress.add_argument("--tool", help="Tool name context")
    p_compress.set_defaults(func=cmd_compress)

    # Classify Command
    p_classify = subparsers.add_parser("classify-command")
    p_classify.add_argument("--args", required=True, help="JSON array of command arguments")
    p_classify.add_argument("--action-dir", help="Sandbox action directory")
    p_classify.set_defaults(func=cmd_classify_command)

    # Path Allowed Command
    p_path = subparsers.add_parser("is-path-allowed")
    p_path.add_argument("--path", required=True, help="Path to validate")
    p_path.add_argument("--action-dir", required=True, help="Sandbox action directory")
    p_path.set_defaults(func=cmd_is_path_allowed)

    # Evaluate Command Execution
    p_eval = subparsers.add_parser("evaluate-execution")
    p_eval.add_argument("--args", required=True, help="JSON array of command arguments")
    p_eval.add_argument("--tier", required=True, choices=["readonly", "supervised", "full"], help="Autonomy security tier")
    p_eval.add_argument("--paths", help="JSON array of paths to validate")
    p_eval.add_argument("--action-dir", required=True, help="Sandbox action directory")
    p_eval.set_defaults(func=cmd_evaluate_execution)

    # Memory Save
    p_m_save = subparsers.add_parser("memory-save")
    p_m_save.add_argument("--vault", required=True, help="Path to markdown vault directory")
    p_m_save.add_argument("--id", required=True, help="Page ID/slug")
    p_m_save.add_argument("--meta", required=True, help="JSON object representing frontmatter metadata")
    p_m_save.add_argument("--body", required=True, help="Markdown body text")
    p_m_save.set_defaults(func=cmd_memory_save)

    # Memory Search
    p_m_search = subparsers.add_parser("memory-search")
    p_m_search.add_argument("--vault", required=True, help="Path to markdown vault directory")
    p_m_search.add_argument("--query", required=True, help="Search query")
    p_m_search.set_defaults(func=cmd_memory_search)

    # Memory Graph
    p_m_graph = subparsers.add_parser("memory-graph")
    p_m_graph.add_argument("--vault", required=True, help="Path to markdown vault directory")
    p_m_graph.set_defaults(func=cmd_memory_graph)

    args = parser.parse_args()
    try:
        args.func(args)
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
