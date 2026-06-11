/**
 * IPC for federated search — one query merged across vault notes, external
 * transcripts, and Hermes sessions (see ../federated-search). Read-only.
 */
import { safeHandle } from "./safe-handle";
import { federatedSearch } from "../federated-search";
import type { FederatedSearchOpts } from "../../shared/federated-search";

export function registerFederatedSearchIpc(): void {
  safeHandle(
    "federated-search",
    (_event, query: string, opts?: FederatedSearchOpts, profile?: string) =>
      federatedSearch(query, opts ?? {}, profile),
  );
}
