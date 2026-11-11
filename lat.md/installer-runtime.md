# Installer and runtime compatibility

Desktop launches the selected Agent installation through its own runtime contract, preserving legacy installs while allowing Agent's package manager to own Python and dependencies.

## Installation-bound runtime discovery

Managed installations publish a canonical launcher that resolves their current interpreter and bootstrap without relying on shell PATH or a fixed virtual environment.

[[src/main/hermes-runtime.ts#resolveHermesRuntime]] queries `hermes-agent/.hermes/bin/hermes` (`hermes.exe` on Windows) with `--print-runtime-command --module hermes_cli.main`. The subprocess has bounded output and a timeout, receives the selected `HERMES_HOME`, and never uses a shell. Its JSON argv must name an existing absolute interpreter and a complete Agent source tree.

Desktop reuses that exact bootstrap prefix for CLI calls. It does not cache a dependency-generation directory or reconstruct PM's store rules. A broken managed launcher fails closed instead of falling back to an old in-tree venv. Installations without a managed launcher retain the existing supported venv layout. On Windows, an existing sibling `pythonw.exe` avoids console flashing; otherwise the selected `python.exe` remains usable with hidden subprocess options.

A Windows managed installation that only publishes `hermes.cmd` requires Agent repair to restore the native `hermes.exe` launcher. Desktop reports this boundary rather than introducing a command-shell fallback or using an unrelated old venv.

[[src/main/installer.ts#refreshHermesRuntime]] refreshes the live interpreter/script bindings and clears version/verification caches after installation or a successful update command. A zero exit status only becomes success when the refreshed runtime is usable; an unresolved managed installation returns repair guidance. Existing-install adoption uses the same resolver.

[[src/main/installer.ts#getEnhancedPath]] includes the canonical launcher and selected home's `bin`; it adds the old venv directory only for legacy runtimes. CLI profile arguments are built before the runtime prefix is added, so variable-length managed prefixes cannot displace `-p`. [[src/main/skills.ts#installSkill]] and [[src/main/skills.ts#uninstallSkill]] preserve this ordering for named-profile mutations.

## Managed Python helpers

Raw Python helpers import Agent's bootstrap before loading Agent modules, so speech and model discovery use the same dependencies as chat.

[[src/main/hermes-runtime.ts#buildHermesPythonArgs]] starts managed Python in isolated mode, clears inherited Python environment overrides, inserts the selected Agent source root and imports `hermes_bootstrap`. Agent then selects and leases its committed environment. The helper preserves `sys.argv` for `-c`, `-m` and script invocations. Legacy Python arguments pass through unchanged.

[[src/main/installer.ts#hermesPythonArgs]] exposes this path alongside [[src/main/installer.ts#hermesCliArgs]]. Profile-specific homes remain supplied by each subprocess caller; runtime discovery itself is installation-scoped. Speech retains its selected-profile environment, while provider model discovery retains the installation home used by that helper.

## Reviewed installation baseline

The desktop verifies the exact POSIX and Windows installer bytes for Agent v0.23.1 before requesting that release's commit as the fresh-install baseline.

[[src/main/installer-download.ts#PINNED_INSTALL_COMMIT]] names `3b421578588243f920886e6fe79a6faa87ea026e`. The SHA-256 values come from `scripts/install.sh` and `scripts/install.ps1` at that Git object. Verification precedes execution and temporary installers are always removed. Existing newer installs retain upstream's anti-rollback behavior. The POSIX subprocess explicitly receives the desktop-selected `HERMES_HOME`.

## SSH managed launcher discovery

SSH commands prefer the installed PM launcher over a retained legacy venv, while explicit deployment hooks keep authority over custom installations.

[[src/main/ssh-remote.ts#buildRemoteHermesCmd]] checks the two explicit per-user deployment hooks before guarded `HERMES_HOME` and known checkout roots for `.hermes/bin/hermes`, then legacy venv commands and PATH. Expanded executable paths remain quoted and command arguments retain their existing per-argument quoting. An unset custom home never probes a root-relative installation.

[[src/main/ssh-docker.ts#buildInspectSshHermesTargetCommand]] reuses the host CLI candidate list and skips an unset custom-home entry. Host detection checks file executability without running the launcher, so it does not certify bootstrap health. Docker's provisioned deployment hook keeps precedence over a host install; container CLI inspection retains its existing policy.

## Test specifications

Isolated filesystem and subprocess fixtures verify runtime ownership, legacy fallback, managed bootstrap execution and malformed-launcher refusals without reading user configuration or running installers.

### Managed discovery without a legacy venv

A complete canonical launcher resolves its installation-bound interpreter and exact bootstrap argv even when the old `venv` tree does not exist.

### Broken managed runtime refuses stale fallback

Malformed output, relative or missing interpreters and launcher failures leave the managed installation unavailable even when a legacy venv exists.

### Windows interpreter selection

Windows managed discovery uses the selected store interpreter and prefers only its existing GUI sibling, never a pre-PM venv interpreter.

### Command-file-only runtime requires repair

A managed Windows installation with only a command-file launcher returns repair guidance without executing a shell or falling back to a stale virtual environment.

### Raw helper bootstraps dependencies

A real Python subprocess loads an isolated bootstrap fixture and preserves arguments containing spaces and quotes while ignoring inherited Python import paths.

### Legacy runtime remains usable

Legacy POSIX and Windows installations retain their invocation layout, and raw helper arguments remain unchanged.

### Runtime refresh after installation change

A successful update resolves the newly published interpreter before later commands run, while an unusable refreshed managed runtime remains a failed update instead of a false success.

The update fixture also verifies installation-home discovery, adoption through the same resolver and preservation of named-profile CLI arguments behind a variable-length managed prefix.

### SSH managed precedence and quoting

Real POSIX subprocess fixtures prefer managed launchers to stale venvs, respect a custom Agent home and preserve spaces, quotes and shell metacharacters as path and argument data.

### Explicit SSH launcher ownership

A configured deployment hook remains preferred over the default managed installation and receives the original command arguments.
