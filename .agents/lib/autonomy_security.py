#!/usr/bin/env python3
import os
from enum import Enum
from pathlib import Path
from typing import List, Tuple, Optional

class CommandClass(Enum):
    READ = "READ"
    WRITE = "WRITE"
    NETWORK = "NETWORK"
    INSTALL = "INSTALL"
    DESTRUCTIVE = "DESTRUCTIVE"

class AutonomyTier(Enum):
    READONLY = "readonly"
    SUPERVISED = "supervised"
    FULL = "full"

class Decision(Enum):
    ALLOW = "ALLOW"
    PROMPT = "PROMPT"
    BLOCK = "BLOCK"

class AutonomySecurity:
    """
    Deterministic security gateway that validates file paths and classifies/gates shell commands.
    Does not rely on LLM prompts; executes deterministic checks in Python.
    """

    def __init__(self, action_dir: str, forbidden_roots: Optional[List[str]] = None):
        self.action_dir = Path(action_dir).resolve()
        
        # Default forbidden system directories to prevent traversal or critical access
        self.forbidden_roots = [
            Path("/etc").resolve(),
            Path("/bin").resolve(),
            Path("/sbin").resolve(),
            Path("/usr/bin").resolve(),
            Path("/usr/sbin").resolve(),
            Path("/var").resolve(),
            Path("/System").resolve(),
            Path("/Library").resolve(),
        ]
        if forbidden_roots:
            for r in forbidden_roots:
                try:
                    self.forbidden_roots.append(Path(r).resolve())
                except Exception:
                    pass

        # Add user-sensitive folders to forbidden roots if on unix
        home = Path.home().resolve()
        self.forbidden_roots.extend([
            home / ".ssh",
            home / ".aws",
            home / ".config",
            home / ".hermes",
            home / ".gemini"
        ])

    def is_path_allowed(self, target_path: Union[str, Path]) -> bool:
        """
        Validates target path against action_dir scope and forbidden system roots.
        Canonicalizes paths first to resolve symlinks and prevent traversal attacks.
        """
        try:
            target = Path(target_path)
            
            # Resolve target path. If it doesn't exist, resolve its parent.
            if target.exists() or target.is_symlink():
                resolved_target = target.resolve()
            else:
                # For non-existent files (e.g. creating a new file), resolve the parent directory
                resolved_target = target.parent.resolve() / target.name

            # Check if target falls under any forbidden root directories
            for forbidden in self.forbidden_roots:
                if forbidden == resolved_target or forbidden in resolved_target.parents:
                    return False

            # Check if resolved path is inside the action_dir sandbox
            # resolved_target must have action_dir as a parent, or be equal to action_dir
            if resolved_target == self.action_dir or self.action_dir in resolved_target.parents:
                return True

            return False
        except Exception:
            # Fail closed on any resolution or validation error
            return False

    def classify_command(self, cmd_args: List[str]) -> CommandClass:
        """
        Classifies a list of command arguments into a CommandClass.
        Fails closed by defaulting unrecognized commands to CommandClass.WRITE.
        """
        if not cmd_args:
            return CommandClass.WRITE

        cmd = cmd_args[0].strip().lower()
        
        # Basic read-only utilities
        read_commands = {
            "cat", "ls", "grep", "find", "pwd", "echo", "diff", 
            "git status", "git log", "git diff", "git show", "git branch",
            "du", "df", "file", "head", "tail", "wc"
        }
        
        # If calling git, look at the subcommands
        if cmd == "git" and len(cmd_args) > 1:
            git_sub = cmd_args[1].strip().lower()
            if git_sub in {"status", "log", "diff", "show", "branch", "config"}:
                # Check for write operations within config or branch
                if git_sub == "config" and any(arg.startswith("--") and "add" in arg or "unset" in arg for arg in cmd_args):
                    return CommandClass.WRITE
                return CommandClass.READ
            elif git_sub in {"clone", "fetch", "pull"}:
                return CommandClass.NETWORK
            elif git_sub in {"push"}:
                return CommandClass.NETWORK # push is network but also has write implications. Let's make it NETWORK.
            elif git_sub in {"add", "commit", "checkout", "reset", "revert", "merge", "rebase", "rm"}:
                return CommandClass.WRITE

        if cmd in read_commands:
            # If cat or ls is called on a forbidden file, path checks will block it, 
            # but command type itself is classified as READ.
            return CommandClass.READ

        # Installers / package managers
        install_commands = {"npm", "yarn", "pnpm", "pip", "pip3", "cargo", "brew", "apt", "apt-get", "gem"}
        if cmd in install_commands:
            # Check if it's installing
            args_str = " ".join(cmd_args[1:]).lower()
            if any(term in args_str for term in ["install", "ci", "add", "update", "upgrade"]):
                return CommandClass.INSTALL
            return CommandClass.WRITE # default package manager actions to WRITE

        # Network requests
        network_commands = {"curl", "wget", "ping", "ssh", "scp", "ftp", "telnet", "nc", "netstat"}
        if cmd in network_commands:
            return CommandClass.NETWORK

        # Destructive tools
        destructive_terms = ["rm -rf", "mkfs", "dd", "format", "reboot", "shutdown", "nuke"]
        full_cmd_str = " ".join(cmd_args).lower()
        if any(term in full_cmd_str for term in destructive_terms):
            return CommandClass.DESTRUCTIVE
        if cmd == "rm" and any(arg == "-rf" or arg == "-fr" or "-f" in arg and "r" in arg for arg in cmd_args[1:]):
            return CommandClass.DESTRUCTIVE

        # Common file write/manipulation commands
        write_commands = {"mkdir", "touch", "cp", "mv", "rm", "tee", "chmod", "chown", "tar", "zip", "unzip"}
        if cmd in write_commands:
            return CommandClass.WRITE

        # Default fallback (fail-closed to WRITE, never READ)
        return CommandClass.WRITE

    def gate_decision(self, cmd_class: CommandClass, tier: AutonomyTier) -> Tuple[Decision, str]:
        """
        Determines the gating action (ALLOW, PROMPT, BLOCK) for a given CommandClass under a selected AutonomyTier.
        """
        if tier == AutonomyTier.READONLY:
            if cmd_class == CommandClass.READ:
                return Decision.ALLOW, "Read-only command allowed under READONLY tier."
            return Decision.BLOCK, f"Command classified as {cmd_class.value} is blocked under READONLY tier."

        elif tier == AutonomyTier.SUPERVISED:
            if cmd_class == CommandClass.READ:
                return Decision.ALLOW, "Read-only command allowed under SUPERVISED tier."
            elif cmd_class == CommandClass.DESTRUCTIVE:
                return Decision.BLOCK, "Destructive commands are strictly blocked under SUPERVISED tier."
            else:
                return Decision.PROMPT, f"Command classified as {cmd_class.value} requires explicit user approval under SUPERVISED tier."

        elif tier == AutonomyTier.FULL:
            if cmd_class == CommandClass.DESTRUCTIVE:
                return Decision.PROMPT, "Destructive command requires confirmation even under FULL tier."
            return Decision.ALLOW, f"Command allowed under FULL tier."

        return Decision.BLOCK, "Unknown autonomy tier. Defaulting to BLOCK."

    def evaluate_command_execution(self, cmd_args: List[str], tier: AutonomyTier, paths_to_check: Optional[List[str]] = None) -> Tuple[Decision, str]:
        """
        Evaluates command classification, checks paths, and yields a unified security decision.
        """
        # Step 1: Check path bounds first if paths were supplied
        if paths_to_check:
            for p in paths_to_check:
                if not self.is_path_allowed(p):
                    return Decision.BLOCK, f"Access blocked: Path '{p}' is outside the action sandbox or in a forbidden system directory."

        # Step 2: Classify the CLI command
        cmd_class = self.classify_command(cmd_args)

        # Step 3: Check decision against the tier
        return self.gate_decision(cmd_class, tier)
