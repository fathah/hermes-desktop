#!/usr/bin/env python3
import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path

from token_juice import TokenJuice
from autonomy_security import AutonomySecurity, CommandClass, AutonomyTier, Decision
from memory_tree import MemoryTreeManager

class TestTokenJuice(unittest.TestCase):
    def setUp(self):
        self.compressor = TokenJuice()

    def test_terminal_stripping(self):
        text = "\x1B[31mError:\x1B[0m Execution failed\rProgress: 10%\rProgress: 100%"
        compressed = self.compressor.compress(text)
        self.assertEqual(compressed, "Error: Execution failed Progress: 100%")

    def test_url_shortening(self):
        long_url = "https://example.com/some/extremely/long/path/name/to/document?param1=value1&param2=value2&param3=value3"
        compressed = self.compressor.compress(f"Check link: {long_url}")
        self.assertIn("https://example.com/some/extremely/long/path/name/to/document?...", compressed)

    def test_html_cleaning(self):
        html = """
        <html>
          <head><style>body { color: red; }</style></head>
          <body>
            <h1>Main Title</h1>
            <p>This is a <b>bold</b> paragraph with a <a href="http://google.com">link</a>.</p>
            <ul>
              <li>Item 1</li>
              <li>Item 2</li>
            </ul>
          </body>
        </html>
        """
        compressed = self.compressor.compress(html)
        self.assertEqual(
            compressed,
            "# Main Title\nThis is a **bold** paragraph with a [link](http://google.com) .\n* Item 1\n* Item 2"
        )

    def test_git_status_compression(self):
        git_status = """On branch main
Your branch is up to date with 'origin/main'.

Changes not staged for commit:
  (use "git add <file>..." to update what will be committed)
  (use "git restore <file>..." to discard changes in working directory)
	modified:   src/main.py
	deleted:    src/utils.py

Untracked files:
  (use "git add <file>..." to include in what will be committed)
	tests/test_main.py

nothing added to commit but untracked files present (use "git add" to track)"""
        
        compressed = self.compressor.compress(git_status, tool_name="git")
        expected_parts = [
            "Unstaged:",
            "M src/main.py",
            "D src/utils.py",
            "Untracked:",
            "tests/test_main.py"
        ]
        for part in expected_parts:
            self.assertIn(part, compressed)
        self.assertNotIn("On branch main", compressed)
        self.assertNotIn("use \"git restore", compressed)


class TestAutonomySecurity(unittest.TestCase):
    def setUp(self):
        # Use local workspace .tmp directory to avoid macOS temp /var path blocks
        self.test_dir = Path(__file__).parent.parent.parent / ".tmp" / "test_sandbox"
        self.action_path = self.test_dir / "sandbox"
        
        if self.test_dir.exists():
            shutil.rmtree(self.test_dir)
        self.action_path.mkdir(parents=True)
        
        self.security = AutonomySecurity(str(self.action_path))

    def tearDown(self):
        if self.test_dir.exists():
            shutil.rmtree(self.test_dir)

    def test_path_hardening_sandbox(self):
        # Paths inside sandbox should be allowed
        inside_file = self.action_path / "project.txt"
        self.assertTrue(self.security.is_path_allowed(inside_file))
        
        # Traversal attempts should be blocked
        traversal_file = self.action_path / "../outside.txt"
        self.assertFalse(self.security.is_path_allowed(traversal_file))
        
        # System forbidden paths should be blocked
        self.assertFalse(self.security.is_path_allowed("/etc/passwd"))
        self.assertFalse(self.security.is_path_allowed("~/.ssh/id_rsa"))

    def test_symlink_resolutions(self):
        # Create a file outside the sandbox
        outside_file = self.test_dir / "secret.key"
        outside_file.write_text("secret_value")
        
        # Create a symlink inside the sandbox pointing to the secret file outside
        link_path = self.action_path / "link.key"
        try:
            os.symlink(outside_file, link_path)
            # The path checker should canonicalize the symlink and block access to the resolved file
            self.assertFalse(self.security.is_path_allowed(link_path))
        except OSError:
            # Skip symlink test if OS lacks permissions (e.g. non-admin Windows)
            pass

    def test_command_classification(self):
        self.assertEqual(self.security.classify_command(["cat", "test.txt"]), CommandClass.READ)
        self.assertEqual(self.security.classify_command(["git", "status"]), CommandClass.READ)
        self.assertEqual(self.security.classify_command(["git", "checkout", "main"]), CommandClass.WRITE)
        self.assertEqual(self.security.classify_command(["curl", "http://api.com"]), CommandClass.NETWORK)
        self.assertEqual(self.security.classify_command(["npm", "install", "lodash"]), CommandClass.INSTALL)
        
        # Destructive checks
        self.assertEqual(self.security.classify_command(["rm", "-rf", "node_modules"]), CommandClass.DESTRUCTIVE)
        self.assertEqual(self.security.classify_command(["dd", "if=/dev/zero", "of=/dev/sda"]), CommandClass.DESTRUCTIVE)
        
        # Fallback checks (fail-closed to WRITE)
        self.assertEqual(self.security.classify_command(["unknown_command", "--arg"]), CommandClass.WRITE)

    def test_autonomy_tier_gating(self):
        # READONLY tier
        dec_read, _ = self.security.gate_decision(CommandClass.READ, AutonomyTier.READONLY)
        dec_write, _ = self.security.gate_decision(CommandClass.WRITE, AutonomyTier.READONLY)
        self.assertEqual(dec_read, Decision.ALLOW)
        self.assertEqual(dec_write, Decision.BLOCK)

        # SUPERVISED tier
        dec_read_sup, _ = self.security.gate_decision(CommandClass.READ, AutonomyTier.SUPERVISED)
        dec_write_sup, _ = self.security.gate_decision(CommandClass.WRITE, AutonomyTier.SUPERVISED)
        dec_dest_sup, _ = self.security.gate_decision(CommandClass.DESTRUCTIVE, AutonomyTier.SUPERVISED)
        self.assertEqual(dec_read_sup, Decision.ALLOW)
        self.assertEqual(dec_write_sup, Decision.PROMPT)
        self.assertEqual(dec_dest_sup, Decision.BLOCK)

        # FULL tier
        dec_write_full, _ = self.security.gate_decision(CommandClass.WRITE, AutonomyTier.FULL)
        dec_dest_full, _ = self.security.gate_decision(CommandClass.DESTRUCTIVE, AutonomyTier.FULL)
        self.assertEqual(dec_write_full, Decision.ALLOW)
        self.assertEqual(dec_dest_full, Decision.PROMPT)


class TestMemoryTreeManager(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.manager = MemoryTreeManager(self.temp_dir.name)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_save_and_parse_page(self):
        meta = {"title": "Test Page", "tags": ["test", "pedagogy"]}
        body = "This is a memory about [[Jazz Education]] and [[The Shed]]."
        self.manager.save_page("test_page", meta, body)

        parsed_meta, parsed_body = self.manager.parse_page("test_page")
        self.assertEqual(parsed_meta["title"], "Test Page")
        self.assertEqual(parsed_meta["tags"], ["test", "pedagogy"])
        self.assertIn("This is a memory about", parsed_body)

    def test_extract_links(self):
        body = "References to [[Miles Davis]] and [[Giant Steps|Coltrane's Steps]]."
        links = self.manager.extract_links(body)
        self.assertEqual(links, ["Miles Davis", "Giant Steps"])

    def test_link_graph(self):
        # Page A -> links to B and C
        self.manager.save_page("PageA", {"title": "Page A"}, "Links to [[PageB]] and [[PageC]].")
        # Page B -> links to C
        self.manager.save_page("PageB", {"title": "Page B"}, "Links to [[PageC]].")
        # Page C -> no outgoing
        self.manager.save_page("PageC", {"title": "Page C"}, "No links here.")

        outgoing, backlinks = self.manager.build_link_graph()
        self.assertEqual(outgoing["PageA"], {"PageB", "PageC"})
        self.assertEqual(outgoing["PageB"], {"PageC"})
        
        self.assertEqual(backlinks["PageB"], {"PageA"})
        self.assertEqual(backlinks["PageC"], {"PageA", "PageB"})

    def test_page_deletion(self):
        self.manager.save_page("PageToDel", {}, "Content")
        self.assertTrue((Path(self.temp_dir.name) / "PageToDel.md").exists())
        
        self.manager.delete_page("PageToDel", use_trash=True)
        self.assertFalse((Path(self.temp_dir.name) / "PageToDel.md").exists())
        self.assertTrue((Path(self.temp_dir.name) / ".trash" / "PageToDel.md").exists())

    def test_full_text_search(self):
        self.manager.save_page("JazzMod", {"title": "Jazz Improv", "tags": ["music"]}, "Learning tritone substitution on Green Dolphin Street.")
        self.manager.save_page("LogicMod", {"title": "Logic Puzzles"}, "Studying first-order logic and reasoning.")

        results = self.manager.search("tritone")
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0][0], "JazzMod")

        results_multi = self.manager.search("Logic")
        self.assertEqual(len(results_multi), 1)
        self.assertEqual(results_multi[0][0], "LogicMod")


if __name__ == "__main__":
    unittest.main()
