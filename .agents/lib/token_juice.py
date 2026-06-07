#!/usr/bin/env python3
import json
import os
import re
from typing import Dict, List, Optional, Union

class TokenJuice:
    """
    TokenJuice is a smart token compression layer designed to reduce verbose agent outputs
    (shell logs, HTML scrapes, tool responses) before passing them to an LLM context.
    """

    def __init__(self, rules_path: Optional[str] = None):
        self.rules: List[Dict[str, str]] = []
        self._load_builtin_rules()
        if rules_path:
            self.load_custom_rules(rules_path)

    def _load_builtin_rules(self):
        """Initializes default built-in rules for common tools (git, bash, npm, cargo)."""
        # Git status compression rules
        self.git_status_rules = [
            (r"(?i)On branch \S+", ""),
            (r"(?i)Your branch is up to date with .*", ""),
            (r"(?i)nothing to commit, working tree clean", "Status: Clean"),
            (r"(?i)Changes not staged for commit:[\s\S]*?\(use \"git add[\s\S]*?\)", "Unstaged:"),
            (r"(?i)Changes to be committed:[\s\S]*?\(use \"git restore[\s\S]*?\)", "Staged:"),
            (r"(?i)Untracked files:[\s\S]*?\(use \"git add[\s\S]*?\)", "Untracked:"),
            (r"^\s*\(use \"git[\s\S]*?\n", "", re.MULTILINE),
            (r"^\s*modified:\s*(.+)$", r"M \1", re.MULTILINE),
            (r"^\s*deleted:\s*(.+)$", r"D \1", re.MULTILINE),
            (r"^\s*new file:\s*(.+)$", r"A \1", re.MULTILINE),
            (r"^\s*renamed:\s*(.+) -> (.+)$", r"R \1 -> \2", re.MULTILINE),
            (r"\n{2,}", "\n"), # Collapse multiple newlines
        ]

        # General Terminal output noise reduction
        self.terminal_rules = [
            (r"\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])", ""), # Strip ANSI escape codes (color codes)
            (r"^[. ]*\r", "", re.MULTILINE), # Remove carriage returns / progress dots
            (r"Progress: \d+%.*?\r", "", re.MULTILINE),
            (r"Downloading.*?\r", "", re.MULTILINE),
            (r"Extracting.*?\r", "", re.MULTILINE),
        ]

        # URL shortening rules
        self.url_pattern = re.compile(r"https?://\S+")

    def load_custom_rules(self, rules_path: str):
        """Loads custom regex replacement rules from a JSON file."""
        if not os.path.exists(rules_path):
            return
        try:
            with open(rules_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list):
                    self.rules.extend(data)
        except Exception as e:
            print(f"Error loading TokenJuice rules from {rules_path}: {e}")

    def shorten_urls(self, text: str) -> str:
        """Truncates long URLs and strips excessive query parameters to save tokens."""
        def repl(match):
            url = match.group(0)
            if len(url) <= 40:
                return url
            parts = url.split("?", 1)
            base_url = parts[0]
            if len(parts) > 1:
                return base_url + "?..."
            if len(base_url) > 60:
                return base_url[:57] + "..."
            return base_url

        return self.url_pattern.sub(repl, text)

    def clean_html(self, html_content: str) -> str:
        """Converts raw HTML strings into semantic, condensed Markdown."""
        # 1. Strip scripts, styles, header, footer, head
        html = re.sub(r"(?is)<script\b[^>]*>([\s\S]*?)</script>", "", html_content)
        html = re.sub(r"(?is)<style\b[^>]*>([\s\S]*?)</style>", "", html)
        html = re.sub(r"(?is)<head\b[^>]*>([\s\S]*?)</head>", "", html)
        html = re.sub(r"(?is)<!--([\s\S]*?)-->", "", html) # Strip HTML comments

        # 2. Structural tags to Markdown equivalents
        html = re.sub(r"(?i)<h[1-3]\b[^>]*>(.*?)</h[1-3]>", r"\n# \1\n", html)
        html = re.sub(r"(?i)<h[4-6]\b[^>]*>(.*?)</h[4-6]>", r"\n## \1\n", html)
        html = re.sub(r"(?i)<p\b[^>]*>(.*?)</p>", r"\n\1\n", html)
        html = re.sub(r"(?i)<li\b[^>]*>(.*?)</li>", r"\n* \1", html)
        html = re.sub(r"(?i)<strong\b[^>]*>(.*?)</strong>|<b\b[^>]*>(.*?)</b>", r" **\1\2** ", html)
        html = re.sub(r"(?i)<em\b[^>]*>(.*?)</em>|<i\b[^>]*>(.*?)</i>", r" *\1\2* ", html)
        html = re.sub(r"(?i)<a\b[^>]*href=\"([^\"]*)\"[^>]*>(.*?)</a>", r" [\2](\1) ", html)
        html = re.sub(r"(?i)<br\s*/?>", "\n", html)

        # 3. Strip all remaining HTML tags
        html = re.sub(r"<[^>]+>", "", html)

        # 4. Collapse extra whitespace and empty lines
        lines = [line.strip() for line in html.split("\n")]
        non_empty_lines = []
        for line in lines:
            if line:
                # Replace multiple spaces with a single space
                line = re.sub(r"[ \t]+", " ", line)
                non_empty_lines.append(line)
        
        return "\n".join(non_empty_lines)

    def compress(self, text: str, tool_name: Optional[str] = None) -> str:
        """
        Compresses the input text by applying terminal, url, html and tool-specific rules.
        """
        if not text:
            return ""

        # Step 1: Strip escape codes and clean general terminal noise
        for pattern, replacement, *flags in self.terminal_rules:
            flag_val = flags[0] if flags else 0
            text = re.sub(pattern, replacement, text, flags=flag_val)

        # Step 2: Apply custom rules if loaded
        for rule in self.rules:
            pattern = rule.get("pattern", "")
            replacement = rule.get("replacement", "")
            if pattern:
                text = re.sub(pattern, replacement, text)

        # Step 3: Apply tool-specific compression rules
        normalized_tool = (tool_name or "").lower()
        if "git" in normalized_tool or (not tool_name and "On branch" in text):
            for pattern, replacement, *flags in self.git_status_rules:
                flag_val = flags[0] if flags else 0
                text = re.sub(pattern, replacement, text, flags=flag_val)

        # Step 4: Check if HTML and clean it
        if "<html" in text.lower() or "<body" in text.lower() or ("<div" in text and "<p" in text):
            text = self.clean_html(text)

        # Step 5: Shorten long URLs
        text = self.shorten_urls(text)

        # Step 6: Final clean (multiple spaces and empty lines)
        lines = []
        for line in text.split("\n"):
            cleaned = line.strip()
            if cleaned:
                cleaned = re.sub(r"\s+", " ", cleaned)
                lines.append(cleaned)
        
        return "\n".join(lines)

# Simple standalone function interface
def compress_output(text: str, tool_name: Optional[str] = None) -> str:
    compressor = TokenJuice()
    return compressor.compress(text, tool_name)
