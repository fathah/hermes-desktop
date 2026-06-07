#!/usr/bin/env python3
import os
import re
from pathlib import Path
from typing import Dict, Any, List, Set, Tuple, Optional

class MemoryTreeManager:
    """
    Obsidian-style local memory vault manager.
    Parses frontmatter, body content, wikilinks, and maintains a local link graph.
    """

    def __init__(self, vault_dir: str):
        self.vault_dir = Path(vault_dir).resolve()
        self.vault_dir.mkdir(parents=True, exist_ok=True)
        self.wikilink_pattern = re.compile(r"\[\[([^\]|]+)(?:\|[^\]]+)?\]\]")
        self.frontmatter_pattern = re.compile(r"^---\s*\n([\s\S]*?)\n---\s*\n")

    def _get_page_path(self, page_id: str) -> Path:
        """Returns the absolute file path for a given page_id (slugified or direct)."""
        # Ensure traversal safety
        safe_name = re.sub(r"[\\/:*?\"<>|]", "_", page_id)
        if not safe_name.endswith(".md"):
            safe_name += ".md"
        return (self.vault_dir / safe_name).resolve()

    def parse_page(self, page_id: str) -> Tuple[Dict[str, Any], str]:
        """
        Parses an on-disk markdown page.
        Returns:
            metadata: Dict of YAML frontmatter keys
            body: Clean string of remaining markdown body
        """
        path = self._get_page_path(page_id)
        if not path.exists():
            return {}, ""

        with open(path, "r", encoding="utf-8") as f:
            content = f.read()

        frontmatter: Dict[str, Any] = {}
        body = content

        match = self.frontmatter_pattern.match(content)
        if match:
            fm_text = match.group(1)
            body = content[match.end():]
            
            # Simple YAML-like key-value parser for basic frontmatter
            for line in fm_text.split("\n"):
                if ":" in line:
                    k, v = line.split(":", 1)
                    k = k.strip()
                    v = v.strip()
                    # Strip quotes if present
                    if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
                        v = v[1:-1]
                    
                    # Parse lists e.g. [tag1, tag2]
                    if v.startswith("[") and v.endswith("]"):
                        v = [val.strip().strip('"').strip("'") for val in v[1:-1].split(",") if val.strip()]
                    
                    frontmatter[k] = v

        return frontmatter, body

    def save_page(self, page_id: str, metadata: Dict[str, Any], body: str):
        """
        Saves a page to disk with structured frontmatter and markdown body.
        """
        path = self._get_page_path(page_id)
        
        # Build YAML frontmatter string
        fm_lines = ["---"]
        for k, v in metadata.items():
            if isinstance(v, list):
                val_str = "[" + ", ".join(f'"{item}"' for item in v) + "]"
                fm_lines.append(f"{k}: {val_str}")
            else:
                # Escape any strings with quotes if they contain special chars
                if isinstance(v, str) and (":" in v or "-" in v or "#" in v):
                    fm_lines.append(f'{k}: "{v}"')
                else:
                    fm_lines.append(f"{k}: {v}")
        fm_lines.append("---")
        fm_text = "\n".join(fm_lines)

        content = f"{fm_text}\n{body}"
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)

    def extract_links(self, body: str) -> List[str]:
        """Extracts target link names from [[wikilink]] style links in the body."""
        return [match.strip() for match in self.wikilink_pattern.findall(body)]

    def delete_page(self, page_id: str, use_trash: bool = True):
        """Deletes a page, either permanently or by archiving it into a .trash subfolder."""
        path = self._get_page_path(page_id)
        if not path.exists():
            return

        if use_trash:
            trash_dir = self.vault_dir / ".trash"
            trash_dir.mkdir(exist_ok=True)
            path.rename(trash_dir / path.name)
        else:
            path.unlink()

    def build_link_graph(self) -> Tuple[Dict[str, Set[str]], Dict[str, Set[str]]]:
        """
        Scans all files in the vault to build a bi-directional link and backlink graph.
        Returns:
            outgoing: Dict mapping page_id -> set of linked page_ids
            backlinks: Dict mapping page_id -> set of pages linking back to it
        """
        outgoing: Dict[str, Set[str]] = {}
        backlinks: Dict[str, Set[str]] = {}

        # Scan all .md files in the vault directory
        for item in self.vault_dir.glob("*.md"):
            if item.name.startswith("."):
                continue
            
            page_id = item.stem # Page name without extension
            _, body = self.parse_page(page_id)
            links = self.extract_links(body)
            
            outgoing[page_id] = set(links)
            for link in links:
                if link not in backlinks:
                    backlinks[link] = set()
                backlinks[link].add(page_id)

        return outgoing, backlinks

    def search(self, query: str) -> List[Tuple[str, int]]:
        """
        Performs full-text search in all vault pages.
        Returns a sorted list of tuples: (page_id, score/frequency of matches).
        """
        results: List[Tuple[str, int]] = []
        if not query:
            return results

        query_pat = re.compile(re.escape(query), re.IGNORECASE)

        for item in self.vault_dir.glob("*.md"):
            if item.name.startswith("."):
                continue

            page_id = item.stem
            metadata, body = self.parse_page(page_id)
            
            # Search title, tags, and body
            score = 0
            
            # Match in title
            title = metadata.get("title", page_id)
            score += len(query_pat.findall(title)) * 5
            
            # Match in tags
            tags = metadata.get("tags", [])
            if isinstance(tags, list):
                for tag in tags:
                    if query.lower() in tag.lower():
                        score += 3
            
            # Match in body
            score += len(query_pat.findall(body))

            if score > 0:
                results.append((page_id, score))

        # Sort by score desc
        results.sort(key=lambda x: x[1], reverse=True)
        return results
