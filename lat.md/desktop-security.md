# Runtime security

Desktop runtime values and downloaded bootstrap code cross explicit trust boundaries before rendering or execution.

## Verified Unix bootstrap

Unix installation downloads a commit-pinned Agent bootstrap script, verifies its SHA-256, then executes it with `--skip-setup`. Download and verification failures always fail installation, including when older binaries already exist.

[[src/main/installer-download.ts#verifiedInstallerCommand]] stages the file under a unique temporary path and removes it on success, download failure, checksum mismatch, or installer failure. [[src/main/installer.ts#runInstall]] preserves verification failures instead of applying its legacy installed-binary warning fallback.

The pin is upstream commit `503d863fcd2cbfc0be5a6d6c536fae2e98aa4204`, whose `scripts/install.sh` hash is `0582d9b1562efcb6e0ac62f4451021667830b830a72ce7d91eaea9fee8b6c09b`. Bump the commit and digest together after reviewing upstream bootstrap changes and compatibility with the Agent it installs. This pins the bootstrap only; its Agent/dependency updates and the Windows bootstrap retain their separate update behavior.

[[tests/installer-download.test.ts]] executes the shell pipeline with real checksum tools and a harmless downloaded fixture. [[tests/installer-verification-result.test.ts]] checks that verification failure cannot become a successful install result merely because binaries already exist.

## Memory provider HTML boundary

The active memory provider is escaped once before interpolation into translated HTML. Translation markup stays intact while provider names remain literal text.

[[src/renderer/src/screens/Memory/MemoryProviders.test.tsx]] renders actual translations in every supported locale and verifies normal names, markup, and literal HTML entities inside the provider label.
