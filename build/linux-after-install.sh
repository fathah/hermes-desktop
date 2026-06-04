#!/bin/bash
# After-install hook for the .deb and .rpm packages.
#
# Sets the SUID root bit on chrome-sandbox so Electron's sandbox helper
# can elevate as required. Without this, Electron crashes on close (and
# on first sandboxed renderer launch on some configs) — issue #395.
#
# Why it's needed: Electron's setuid sandbox is the supported sandboxing
# path on Linux when unprivileged user namespaces aren't available. Newer
# Ubuntu (24.04+, definitely 26.04 LTS) ships AppArmor + kernel hardening
# that disable unprivileged user namespaces by default, so the SUID path
# becomes mandatory.
#
# This matches the postinst behaviour of other Electron apps (VS Code,
# Slack, Discord, Signal, etc.). electron-builder doesn't ship this by
# default — it has to be wired up via {deb,rpm}.afterInstall.

set -e

SANDBOX="/opt/Hermes Agent/chrome-sandbox"

if [ -f "$SANDBOX" ]; then
  # 4755 = SUID + rwxr-xr-x. Root-owned by package install; SUID is what
  # lets the sandbox briefly elevate for the chroot/setresuid step before
  # dropping back to the calling user.
  chmod 4755 "$SANDBOX"
fi

exit 0
