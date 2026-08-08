import { getCACertificates, setDefaultCACertificates } from "node:tls";

/**
 * Add operating-system trust decisions to Node's bundled CA roots.
 *
 * Electron's main-process HTTP, HTTPS, fetch, and WebSocket clients use Node's
 * TLS defaults. Configure them before startup so a locally trusted CA works
 * without weakening certificate or hostname verification.
 */
export function configureSystemCertificateTrust(): void {
  try {
    setDefaultCACertificates([
      ...getCACertificates("default"),
      ...getCACertificates("system"),
    ]);
  } catch (error) {
    // Certificate-store access must not make the desktop unbootable. Standard
    // bundled roots remain in effect when system roots cannot be loaded.
    console.warn(
      "[TLS] Could not load operating-system certificate authorities; using the existing trust store.",
      error,
    );
  }
}
