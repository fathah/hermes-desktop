# MCP server management

Add, edit, remove, enable, and test Model Context Protocol (MCP) servers from the Capabilities → MCP tab. Each server is an `http` or `stdio` entry stored in the profile's `config.yaml`, or on the remote gateway in Remote/SSH mode.

## Operations

The MCP tab in [[src/renderer/src/screens/Tools/Tools.tsx]] lists servers as a table and drives every mutation through IPC into [[src/main/mcp-servers.ts]]; local mode edits `config.yaml` directly, Remote/SSH mode proxies to the gateway's `/api/mcp/servers` REST endpoints.

The columns are Server · Transport · Command/URL · Enabled.

- **Add** — [[src/main/mcp-servers.ts#addMcpServer]] validates the input and rejects a duplicate name.
- **Edit** — a per-row pencil opens the shared modal pre-filled with the server's values; saving calls [[src/main/mcp-servers.ts#updateMcpServer]], which upserts the entry **in place** (no delete-then-add gap so a mid-write failure can't lose the server) and only removes the old entry when the name changed — guarding first against colliding with another server. The modal has **Visual** and **JSON** modes (a toggle): Visual is the field form; JSON is a raw `Server JSON` editor (`command`/`args`/`env`/`url`/`auth`/`enabled`). The two stay in sync on toggle; on save the active mode is the source of truth (JSON is parsed + validated inline, and an `enabled` change there is applied via `setMcpServerEnabled` after the config write). Name stays a separate field in both modes.
- **Remove** — [[src/main/mcp-servers.ts#removeMcpServer]].
- **Enable/disable** and **Test** are separate IPC calls; the enable toggle is the row's trailing control (with the row dimming when off — the two together stand in for a status column, so there isn't one), and the edit/test/remove actions reveal on row hover. Test surfaces its result (`connected · <tool count>` or an error) as the transient banner above the table, since `listMcpServers` carries no live connection state or tool count.

The add and edit flows share one modal: `editingMcpName` in `Tools.tsx` (null while adding) selects `updateMcpServer` vs `addMcpServer` and swaps the title and save-button copy. Server rows are re-fetched after every successful mutation.

The `McpLogo` component shows a logo, source first: the community registry's icon (matched to a server by name → registry id; [[src/main/registry.ts#toItem]] resolves the entry's repo-relative `icon` to the registry service's icon URL, `https://registry.hermesone.org/registry-icon/<path>`), then the HTTP server's own-domain favicon, then a generic server glyph.

Registry icons are Iconify-style SVGs — many monochrome (`fill="currentColor"`). Rather than fetch + inline them to theme the colour, `McpLogo` follows the registry's own web UI (`EntryIcon`): render a plain `<img>` on a **white tile in both themes**, so black single-colour glyphs stay legible (they'd vanish on a dark tile) and colour logos keep their colours. This needs no main-process fetch — `<img>` loads directly under CSP `img-src https:`; the generic glyph fallback keeps the normal dark tile. Since the icons are immutable content-addressed assets, [[src/main/app/start.ts#startMainProcess]]'s `onHeadersReceived` rewrites their `Cache-Control` to `max-age=31536000, immutable`, so each is fetched at most once and served from the on-disk HTTP cache across restarts.
