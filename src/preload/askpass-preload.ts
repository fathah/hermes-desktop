// Askpass preload script — secure bridge between the password dialog and main process.
// Exposes a minimal API via contextBridge instead of granting full Node.js access.
import { contextBridge, ipcRenderer } from "electron";

// Read the channel from the URL query string (safe because the URL is constructed
// by the main process and loaded via data:text/html;base64, with the channel
// embedded as a fragment that the renderer cannot tamper with).
// We use location.hash to avoid it being sent to any server.
// Format: data:text/html;charset=UTF-8;base64,...#askpass-channel-XXXX
const hash = location.hash;
const channelMatch = hash.match(/^#askpass-channel-(.+)$/);
const channel = channelMatch ? channelMatch[1] : null;

if (!channel) {
  console.error("[askpass-preload] No channel provided via URL hash");
}

contextBridge.exposeInMainWorld("askpassAPI", {
  submit: (value: string | null): void => {
    if (channel) {
      ipcRenderer.send(channel, value);
    }
  },
});
