# Migration Report: Electron to Wails/Tauri

This document outlines the investigation into migrating Hermes Desktop from an Electron-based architecture to a more lightweight alternative, specifically Wails or Tauri.

## Overview and Goals
The primary motivation for this migration is to reduce the application's footprint, resource usage, and overall bloat associated with Electron apps. The goal is to perform a *partial* migration initially, moving the core application frame and runtime to Wails/Tauri while preserving the existing TypeScript/Node.js backend logic to minimize the rewrite effort.

## Recommended Architecture: The "Sidecar" Approach
Since rewriting the entire `src/main` backend (which consists of ~90 files, SQLite interactions, SSH tunneling, and system integrations) into Go (for Wails) or Rust (for Tauri) is currently out of scope, the recommended approach is the **Sidecar Architecture**.

In this architecture:
1.  **The Wrapper:** Wails or Tauri serves as the lightweight native wrapper, creating the window, providing OS integration (tray, menus), and hosting the WebView.
2.  **The Sidecar:** The existing Node.js backend logic is bundled alongside a Node runtime (or an alternative like Bun or Deno) and executed as a hidden child process by the wrapper on startup.
3.  **Communication:** The `ipcMain` and `ipcRenderer` Electron systems are replaced by local HTTP and WebSocket servers.

## Framework Comparison for this Project

### Wails (Go)
*   **Pros:** Go is extremely easy to read, write, and maintain. Compiles very fast. Excellent for spawning and managing subprocesses.
*   **Cons:** Wails lacks a built-in auto-updater (unlike Electron or Tauri). We would need to implement a custom updater or use a third-party solution. Wails also lacks formal "sidecar" bundling in its config, though it's trivial to achieve manually with Go's `os/exec` and `//go:embed`.
*   **Verdict:** Highly recommended for its simplicity, but requires solving the auto-update problem manually.

### Tauri (Rust)
*   **Pros:** First-class sidecar support built directly into the configuration. Built-in auto-updater that is highly robust. Extremely secure by default.
*   **Cons:** Rust has a much steeper learning curve than Go. Compile times are significantly longer.
*   **Verdict:** A very strong candidate, especially because it solves the auto-update problem out-of-the-box.

**Overall Recommendation:** Wails is preferable if the team is more comfortable with Go or doesn't mind implementing a custom updater. However, Tauri's built-in sidecar and updater features make it technically superior for this specific hybrid-architecture migration path. Given the preference for Wails, we will focus the migration steps on Wails, acknowledging the updater limitation.

## Required Changes and Step-by-Step Migration Plan

### Phase 1: Backend IPC Refactor (Node.js Sidecar)
The most significant change is removing Electron dependencies from the backend logic.

1.  **Remove `electron` imports:** Scrape all files in `src/main/` and remove references to `app`, `BrowserWindow`, `ipcMain`, `dialog`, `shell`, etc.
2.  **Implement Local API Server:**
    *   Introduce a lightweight web framework (e.g., Express, Fastify, or even raw Node `http`).
    *   Convert all `ipcMain.handle` registrations (found in `src/main/ipc/register.ts`) into HTTP POST/GET endpoints.
    *   Bind the server to `127.0.0.1:0` (random port) to ensure security and avoid port conflicts.
3.  **Implement WebSocket Server:**
    *   Use the `ws` package to spin up a WebSocket server alongside the HTTP server.
    *   Replace all `mainWindow.webContents.send(...)` calls with broadcasting over the WebSocket.
4.  **Startup Handshake:**
    *   When the Node backend starts, it must print its dynamically assigned port to `stdout` (e.g., `PORT=54321`).

### Phase 2: Frontend Refactor
1.  **Remove Preload Scripts:** Delete `src/preload/index.ts`.
2.  **Rebuild `window.hermesAPI`:**
    *   Recreate the `hermesAPI` object directly in the React codebase (`src/renderer/src/utils/api.ts`).
    *   Rewrite all functions (e.g., `checkInstall`, `getHermesVersion`) to use `fetch()` calls against `http://127.0.0.1:<PORT>`.
    *   Implement a WebSocket client to listen for events (e.g., `install-progress`, `model-library-changed`) and dispatch them to the React components.

### Phase 3: The Wails/Tauri Wrapper
1.  **Initialize Project:** Create a new Wails (or Tauri) project inside a new directory.
2.  **Point to Frontend:** Configure Wails to use the output of `src/renderer` (`dist` or `out/renderer`) as its frontend assets.
3.  **Sidecar Orchestration (Wails Example):**
    *   In `main.go`, hook into the `startup` event.
    *   Use `exec.Command` to launch the Node backend.
    *   Read the stdout of the Node process to capture the port number.
    *   Use `wails.Runtime.WindowExecJS` to inject the port into the WebView: `window.BACKEND_PORT = 54321;`.
    *   Hook into the `shutdown` event to forcefully kill the Node process.
4.  **Native API Bridges:**
    *   For native file dialogs (e.g., `select-folder`), implement a Wails-native Go binding that calls Wails' built-in `runtime.OpenDirectoryDialog`, instead of routing it through the Node backend.
    *   Expose this Go function to the frontend.

## Complexity and Risks

*   **Native Node Modules:** The project heavily relies on `better-sqlite3`. Native modules must be compiled for the target architecture. When bundling the Node sidecar, we must ensure the correct `.node` binaries are packaged for Windows, Mac, and Linux. This complicates the build pipeline.
*   **Orphaned Processes:** If the Wails app crashes unexpectedly without triggering the graceful shutdown hook, the Node sidecar might remain running in the background, consuming resources and keeping ports bound. A heartbeat mechanism between the Node process and Wails app may be required to auto-terminate the sidecar.
*   **Auto-Updates:** As mentioned, migrating away from `electron-updater` is non-trivial. If Wails is chosen, a bespoke update checker (downloading binaries from GitHub releases and replacing them) must be written in Go.
*   **Security:** By opening local HTTP/WS ports, there is a theoretical risk of other local processes interacting with the backend. The port must strictly bind to `127.0.0.1`, and a simple authentication token (generated on startup and passed to the frontend) should be included in requests to guarantee security.

## Conclusion
A partial migration to Wails or Tauri using a Sidecar architecture is completely feasible and bypasses the need to rewrite the extensive `src/main` backend codebase immediately. The primary engineering effort will be spent untangling the Electron IPC bindings, replacing them with a local REST/WebSocket API, and solving the sidecar packaging/lifecycle problems.

## Addendum: Resource Usage & The "Why Electron?" Question

### Sidecar vs. Electron Resource Usage
Even though the Sidecar architecture relies on a Node.js background process, it will still result in a **drastically lighter and less resource-hungry application**.
The vast majority of Electron's disk bloat and heavy RAM usage comes from bundling and executing an entire isolated instance of **Chromium**. An Electron app spawns multiple heavy processes (main process, GPU processes, renderer processes, etc.) just to render the UI.

Wails and Tauri, conversely, use the native webview of the operating system (WebView2 on Windows, WKWebView on macOS, and WebKitGTK on Linux). Because these native webviews share resources directly with the OS, they are exceptionally lightweight.

The Node.js runtime itself is relatively small (a ~40MB binary) and consumes very little memory when executing backend logic without rendering a UI. By migrating to Wails/Tauri with a Node sidecar, we eliminate the Chromium engine while keeping the backend logic identical.

### Why Do People Still Use Electron?
If Tauri and Wails are so much lighter, why does Electron remain the industry standard? There are three main trade-offs:

1. **Consistent Rendering (The "Chromium" Factor):**
   Electron guarantees that your UI looks and behaves exactly the same on Windows, macOS, and Linux because it ships the same Chromium browser to every user. With Wails and Tauri, you rely on the host OS's webview. This introduces the risk of cross-browser compatibility issues—CSS bugs might appear on Linux but not Windows, or specific JavaScript APIs might be missing on older macOS versions.
2. **One Unified Language Stack:**
   In Electron, the frontend, backend, and native OS integrations are entirely JavaScript/TypeScript. If you need deep OS integration, you simply use an npm package. With Tauri or Wails, complex OS integrations often require dropping down into Rust or Go. (Note: The Sidecar architecture mitigates this heavily for our specific use case).
3. **Maturity and Ecosystem:**
   Electron has been battle-tested for a decade. Features like auto-updating (`electron-updater`), crash reporting, and debugging tools are incredibly robust and have massive community support. Wails and Tauri are much newer, meaning you occasionally have to build custom solutions for features that Electron provides out-of-the-box.
