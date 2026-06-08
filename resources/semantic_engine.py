#!/usr/bin/env python3
# semantic_engine.py — helper process for txtai-based semantic indexing,
# community clustering, and GraphRAG. Exposes a line-by-line JSON-RPC API on stdin/stdout.

import sys
import os
import json
import re
import traceback

# Try to import txtai. Fall back to standard library TF-IDF if unavailable.
try:
    from txtai.embeddings import Embeddings
    TXTAI_AVAILABLE = True
except ImportError:
    TXTAI_AVAILABLE = False

class SimpleTfidfEngine:
    """Fallback semantic search using basic TF-IDF if txtai is not installed."""
    def __init__(self):
        self.documents = {} # path -> text
        self.vocab = {}
        self.idf = {}

    def index(self, docs):
        self.documents = docs
        # Build vocabulary
        word_counts = {}
        doc_count = len(docs)
        if doc_count == 0:
            return

        for path, text in docs.items():
            words = set(self._tokenize(text))
            for w in words:
                word_counts[w] = word_counts.get(w, 0) + 1
        
        self.vocab = {w: i for i, w in enumerate(word_counts.keys())}
        self.idf = {}
        import math
        for w, count in word_counts.items():
            self.idf[w] = math.log(doc_count / count)

    def _tokenize(self, text):
        return re.findall(r'[a-zA-Z0-9_]+', text.lower())

    def search(self, query, limit=5):
        q_words = self._tokenize(query)
        scores = []
        for path, text in self.documents.items():
            d_words = self._tokenize(text)
            # Simple overlap score weighted by IDF
            score = 0.0
            for w in q_words:
                if w in d_words:
                    score += self.idf.get(w, 1.0)
            if score > 0:
                scores.append((path, score))
        scores.sort(key=lambda x: x[1], reverse=True)
        return [{"path": path, "score": score} for path, score in scores[:limit]]

    def get_graph(self):
        # Fallback graph returns empty or basic wikilinks
        return {"nodes": [], "edges": []}


class SemanticEngine:
    def __init__(self):
        self.txtai_db = None
        self.fallback_db = None
        self.docs_cache = {}

    def init_db(self):
        if TXTAI_AVAILABLE:
            try:
                # In-memory embeddings database with relational-backed Graph network
                self.txtai_db = Embeddings({
                    "path": "sentence-transformers/all-MiniLM-L6-v2",
                    "content": True,
                    "graph": {
                        "backend": "rdbms",
                        "limit": 5,
                        "minscore": 0.4,
                        "communities": {}
                    }
                })
            except Exception as e:
                # Fall back to TF-IDF if transformers fails to initialize
                self.txtai_db = None
                self.fallback_db = SimpleTfidfEngine()
        else:
            self.fallback_db = SimpleTfidfEngine()

    def handle_index(self, vault_path):
        if not os.path.exists(vault_path):
            return {"ok": False, "error": f"Vault path {vault_path} does not exist"}

        # Scan all markdown files
        self.docs_cache = {}
        for root, _, files in os.walk(vault_path):
            # Ignore internal dirs
            if ".obsidian" in root or ".git" in root:
                continue
            for f in files:
                if f.endswith((".md", ".markdown")):
                    full_path = os.path.join(root, f)
                    rel_path = os.relpath(full_path, vault_path).replace("\\", "/")
                    try:
                        with open(full_path, "r", encoding="utf-8") as file:
                            content = file.read()
                            # Strip frontmatter for cleaner semantic indexing
                            body = re.sub(r'^---.*?^---', '', content, flags=re.MULTILINE | re.DOTALL)
                            self.docs_cache[rel_path] = body.strip()
                    except Exception:
                        pass

        if self.txtai_db:
            try:
                # Format for txtai indexing: list of tuples (id, text, tags)
                data = [(path, text, None) for path, text in self.docs_cache.items()]
                self.txtai_db.index(data)
                return {
                    "ok": True, 
                    "engine": "txtai", 
                    "notes": len(data),
                    "txtai_installed": True
                }
            except Exception as e:
                # Fall back to TF-IDF if indexing fails
                self.txtai_db = None
                self.fallback_db = SimpleTfidfEngine()
                self.fallback_db.index(self.docs_cache)
                return {
                    "ok": True, 
                    "engine": "tfidf-fallback", 
                    "notes": len(self.docs_cache),
                    "txtai_installed": True,
                    "error": f"txtai index error: {str(e)}"
                }
        else:
            self.fallback_db.index(self.docs_cache)
            return {
                "ok": True, 
                "engine": "tfidf-fallback", 
                "notes": len(self.docs_cache), 
                "txtai_installed": False
            }

    def handle_search(self, query, limit=5):
        if self.txtai_db:
            try:
                results = self.txtai_db.search(query, limit)
                # txtai search returns tuples or dicts depending on setup
                out = []
                for r in results:
                    # Parse structure
                    if isinstance(r, dict):
                        out.append({"path": r.get("id"), "score": float(r.get("score", 0.0))})
                    elif isinstance(r, tuple) and len(r) >= 2:
                        out.append({"path": r[0], "score": float(r[1])})
                return {"results": out}
            except Exception:
                pass
        
        # Fall back to TF-IDF
        if self.fallback_db:
            return {"results": self.fallback_db.search(query, limit)}
        return {"results": []}

    def handle_graph(self):
        if self.txtai_db and self.txtai_db.graph:
            try:
                # Extract graph representation
                graph = self.txtai_db.graph
                nodes = []
                edges = []
                
                # Check for communities (clusters)
                communities = graph.scan() if hasattr(graph, 'scan') else {}
                
                # Retrieve nodes and connections
                for node_id in graph.nodes():
                    nodes.append({
                        "id": node_id,
                        "label": os.path.basename(node_id).replace(".md", ""),
                        "community": communities.get(node_id, 0)
                    })
                
                for u, v, data in graph.edges(data=True):
                    edges.append({
                        "source": u,
                        "target": v,
                        "weight": float(data.get("weight", 1.0))
                    })
                return {"nodes": nodes, "edges": edges}
            except Exception:
                pass
                
        # Simple fallback graph: build mock connections based on term overlapping
        nodes = [{"id": path, "label": os.path.basename(path).replace(".md", ""), "community": 0} for path in self.docs_cache]
        return {"nodes": nodes, "edges": []}

    def handle_rag(self, query, limit=3):
        # Return contents of matching nodes to be injected as prompt context
        search_res = self.handle_search(query, limit)
        context_docs = []
        for doc in search_res.get("results", []):
            path = doc["path"]
            if path in self.docs_cache:
                context_docs.append({
                    "path": path,
                    "title": os.path.basename(path).replace(".md", ""),
                    "content": self.docs_cache[path]
                })
        return {"context": context_docs}


def main():
    engine = SemanticEngine()
    engine.init_db()

    # Process JSON commands line-by-line
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            cmd = req.get("cmd")
            args = req.get("args", {})
            
            if cmd == "index":
                res = engine.handle_index(args.get("vault_path"))
            elif cmd == "search":
                res = engine.handle_search(args.get("query"), args.get("limit", 5))
            elif cmd == "graph":
                res = engine.handle_graph()
            elif cmd == "rag":
                res = engine.handle_rag(args.get("query"), args.get("limit", 3))
            elif cmd == "status":
                res = {"ok": True, "txtai_installed": TXTAI_AVAILABLE}
            else:
                res = {"error": f"Unknown command: {cmd}"}
                
            print(json.dumps({"id": req.get("id"), "result": res}), flush=True)
        except Exception as e:
            err_msg = traceback.format_exc()
            print(json.dumps({"id": req.get("id", 0), "error": err_msg}), flush=True)

if __name__ == "__main__":
    main()
