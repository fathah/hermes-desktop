# Discover catalog

Discover browses community skills, MCP servers, workflows, and agent templates, with installed markers from the selected target and profile.

[[src/renderer/src/screens/Discover/Discover.tsx#Discover]] renders the public catalog. Local and SSH modes retain setup controls; direct Remote mode is browse-only so catalog installs never unpack into a local profile and MCP removal controls cannot mutate the connected host.

## Remote installed markers

Installed skill and MCP markers come from the connected server and requested profile; desktop profile names do not mark remote agents as already created.

[[src/main/remote-discover.ts#remoteListInstalledRegistry]] combines remote skill names and MCP server names while allowing either source to fail independently. The IPC registry-install handler rejects direct Remote installs. [[src/main/remote-discover.test.ts]] verifies profile routing, independent failures, and install refusal.

## Target lifetime

The screen resets installed markers, details, and actions when its connection, profile, or resolved mode changes, preventing old replies from updating the new target.

The Layout keys Discover by connection id. Its content also uses the selected profile and [[src/renderer/src/hooks/useConnectionTargetRevision.ts#useConnectionTargetRevision]], so editing the current URL or mode without changing its id discards the old screen lifetime.

### Profile changes

A delayed installed-skill reply from the old profile cannot replace markers for the new profile; browse-only install controls remain absent.

### Connection edits

A same-id connection edit clears the detail dialog, rejects the previous target's late markers, and releases the configuration listener on unmount.

### Resolved mode changes

When the resolved mode changes to browse-only, pending local profile replies cannot mark catalog agents as created or restore mutation controls.
