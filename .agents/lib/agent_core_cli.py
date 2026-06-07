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

def resolve_db_path():
    import os
    hermes_home = os.environ.get("HERMES_HOME")
    if not hermes_home:
        hermes_home = str(Path.home() / ".hermes")
    
    active_profile_file = Path(hermes_home) / "active_profile"
    profile_name = "default"
    if active_profile_file.exists():
        try:
            profile_name = active_profile_file.read_text().strip() or "default"
        except:
            pass
            
    if profile_name != "default":
        return str(Path(hermes_home) / "profiles" / profile_name / "state.db")
    else:
        return str(Path(hermes_home) / "state.db")

def cmd_lookup_skill(args):
    import sqlite3
    db_path = resolve_db_path()
    if not Path(db_path).exists():
        print(json.dumps({"results": []}))
        return
        
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # Check if table exists
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='skills_registry'")
        if not cursor.fetchone():
            print(json.dumps({"results": []}))
            conn.close()
            return

        query = args.query.lower()
        words = [w for w in query.split() if w]
        
        if not words:
            cursor.execute("SELECT name, description, keywords, status, entrypoint, dependencies FROM skills_registry LIMIT 10")
            rows = cursor.fetchall()
        else:
            clauses = []
            params = []
            for word in words:
                clauses.append("(LOWER(name) LIKE ? OR LOWER(description) LIKE ? OR LOWER(keywords) LIKE ?)")
                like_val = f"%{word}%"
                params.extend([like_val, like_val, like_val])
                
            sql = f"SELECT name, description, keywords, status, entrypoint, dependencies FROM skills_registry WHERE {' AND '.join(clauses)} LIMIT 5"
            cursor.execute(sql, params)
            rows = cursor.fetchall()
            
        results = []
        for r in rows:
            results.append({
                "name": r[0],
                "description": r[1],
                "keywords": r[2],
                "status": r[3],
                "entrypoint": r[4],
                "dependencies": r[5]
            })
            
        print(json.dumps({"results": results}))
        conn.close()
    except Exception as e:
        print(json.dumps({"error": str(e)}))

def cmd_scaffold_skill(args):
    import sqlite3
    import subprocess
    import os
    
    hermes_home = os.environ.get("HERMES_HOME")
    if not hermes_home:
        hermes_home = str(Path.home() / ".hermes")
        
    active_profile_file = Path(hermes_home) / "active_profile"
    profile_name = "default"
    if active_profile_file.exists():
        try:
            profile_name = active_profile_file.read_text().strip() or "default"
        except:
            pass
            
    if profile_name != "default":
        p_home = str(Path(hermes_home) / "profiles" / profile_name)
    else:
        p_home = hermes_home
        
    slug = args.name.lower().replace(" ", "-")
    slug = "".join([c for c in slug if c.isalnum() or c == "-"])
    
    skill_dir = Path(p_home) / "skills" / "custom" / slug
    try:
        skill_dir.mkdir(parents=True, exist_ok=True)
        
        # Write SKILL.md
        skill_md = (
            f"---\n"
            f"name: \"{args.name}\"\n"
            f"description: \"{args.desc}\"\n"
            f"keywords: \"custom, autopoietic, generated\"\n"
            f"---\n\n"
            f"# {args.name}\n\n"
            f"{args.desc}\n"
        )
        (skill_dir / "SKILL.md").write_text(skill_md, encoding="utf-8")
        
        # Write main.py
        (skill_dir / "main.py").write_text(args.code, encoding="utf-8")
        
        # Handle dependencies
        deps_list = [d.strip() for d in args.deps.split(",") if d.strip()] if args.deps else []
        if deps_list:
            (skill_dir / "requirements.txt").write_text("\n".join(deps_list), encoding="utf-8")
            
            # Attempt pip install
            python_bin = os.environ.get("HERMES_PYTHON", sys.executable)
            subprocess.run(
                [python_bin, "-m", "pip", "install"] + deps_list,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=30
            )
            
        # Register in SQLite
        db_path = resolve_db_path()
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS skills_registry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE,
                description TEXT,
                keywords TEXT,
                status TEXT DEFAULT 'active',
                entrypoint TEXT,
                dependencies TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        cursor.execute("""
            INSERT INTO skills_registry (name, description, keywords, status, entrypoint, dependencies)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(name) DO UPDATE SET
                description = excluded.description,
                keywords = excluded.keywords,
                entrypoint = excluded.entrypoint,
                dependencies = excluded.dependencies,
                status = excluded.status
        """, (
            args.name,
            args.desc,
            "custom, autopoietic, generated",
            "active",
            str(skill_dir / "main.py"),
            json.dumps(deps_list)
        ))
        
        conn.commit()
        conn.close()
        
        print(json.dumps({
            "status": "success",
            "path": str(skill_dir),
            "entrypoint": str(skill_dir / "main.py")
        }))
    except Exception as e:
        print(json.dumps({"error": str(e)}))

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

    # Lookup Skill Command
    p_l_skill = subparsers.add_parser("lookup-skill")
    p_l_skill.add_argument("--query", required=True, help="Search terms for registry")
    p_l_skill.set_defaults(func=cmd_lookup_skill)

    # Scaffold Skill Command
    p_s_skill = subparsers.add_parser("scaffold-skill")
    p_s_skill.add_argument("--name", required=True, help="Name of the skill")
    p_s_skill.add_argument("--desc", required=True, help="Description of the skill")
    p_s_skill.add_argument("--code", required=True, help="Python code for the main.py entrypoint")
    p_s_skill.add_argument("--deps", help="Comma-separated pip dependencies")
    p_s_skill.set_defaults(func=cmd_scaffold_skill)

    args = parser.parse_args()
    try:
        args.func(args)
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
