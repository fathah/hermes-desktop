# Runtime security

Desktop runtime values and downloaded bootstrap code cross explicit trust boundaries before rendering or execution.

## Verified Unix bootstrap

Unix installation downloads a commit-pinned Agent bootstrap script, verifies its SHA-256, then executes it with `--skip-setup`. Download and verification failures always fail installation, including when older binaries already exist.

[[src/main/installer-download.ts#verifiedInstallerCommand]] stages the file under a unique temporary path and removes it on success, download failure, checksum mismatch, or installer failure. [[src/main/installer.ts#runInstall]] preserves verification failures instead of applying its legacy installed-binary warning fallback.

The reviewed Agent v0.23.1 commit and matching POSIX/Windows bootstrap digests follow [[installer-runtime#Reviewed installation baseline]]. Each verified bootstrap receives that same Agent commit for fresh installation; existing newer checkouts retain upstream's rollback guard. Bump the commit and both digests together after review. Explicit Agent and dependency updates remain upstream-owned.

[[tests/installer-download.test.ts]] executes the shell pipeline with real checksum tools and a harmless downloaded fixture. [[tests/installer-verification-result.test.ts]] checks that verification failure cannot become a successful install result merely because binaries already exist.

## Memory provider HTML boundary

The active memory provider is escaped once before interpolation into translated HTML. Translation markup stays intact while provider names remain literal text.

[[src/renderer/src/screens/Memory/MemoryProviders.test.tsx]] renders actual translations in every supported locale and verifies normal names, markup, and literal HTML entities inside the provider label.

## Verified Windows bootstrap

Windows downloads immutable bootstrap bytes and checks SHA-256 before converting UTF-8 for PowerShell 5.1 or executing the script. Verification failure cannot become install success.

[[src/main/installer-windows-download.ts#verifiedWindowsInstallerScript]] downloads to a unique temporary file, checks the build-pinned digest, converts verified text to a BOM-bearing script, and passes the matching Agent commit. Its finally block removes the staged file on download, verification and installer failures. Explicit Agent updates remain an upstream-managed operation.

[[tests/installer-windows-download.test.ts]] verifies the wrapper's order, digest and argument boundary. [[tests/installer-windows-verification-result.test.ts]] invokes the real Windows install result handler with a refused download and existing binaries. Native Windows installation remains a platform integration check; fixture tests never run an actual Agent installer.

## Reviewed registry snapshot

Catalogs, manifests and selected payloads come from one immutable registry commit. The complete Git tree and each blob are verified before any entry files are written.

[[src/main/registry-integrity.ts#VerifiedRegistrySnapshot]] reconstructs Git tree objects and compares the root with the build-pinned tree hash. Missing, truncated, malformed and altered trees fail closed. The verified immutable tree stays cached for the snapshot lifetime, so later API outages do not discard trusted metadata. Blob downloads must match the verified object's hash; all folder bytes are checked before destination writes. Symlinks and unsafe path components are rejected.

[[src/main/utils.ts#safeWriteFile]] preserves verified binary bytes through its atomic replacement. [[tests/safe-write-file.test.ts]] covers non-UTF-8 payloads. [[src/main/registry.ts#installAgent]] verifies its persona before creating a profile. [[tests/registry-integrity.test.ts]] covers altered metadata, byte corruption, unsafe paths and complete-folder verification. [SECURITY.md](../SECURITY.md) documents reviewed pins and the separate Agent dependency/update trust boundary.
