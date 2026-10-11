import {
  DashboardGatewayClient,
  type DashboardGatewayClientOptions,
} from "../../screens/Chat/dashboardGatewayClient";

/** Always talk to the selected machine. A local filesystem fallback would show
 * the wrong profile's pet for SSH/Remote connections. */
export async function openPetGateway(
  profile: string,
  connectionId: string,
  onEvent?: DashboardGatewayClientOptions["onEvent"],
): Promise<DashboardGatewayClient> {
  const client = new DashboardGatewayClient({ onEvent });
  let changed = false;
  const unsubscribe = window.hermesAPI.onConnectionConfigChanged(() => {
    changed = true;
    client.close();
  });
  const assertCurrent = (): void => {
    if (changed)
      throw new Error(
        "Pet connection changed; retry on the current connection",
      );
  };
  try {
    const status = await window.hermesAPI.startDashboard(profile, connectionId);
    assertCurrent();
    if (!status.running || !status.connection) {
      throw new Error(
        status.error || "Pet gateway is unavailable on this connection",
      );
    }
    // OAuth tickets are single-use; never share the URL with the chat socket.
    const url = window.hermesAPI.freshDashboardWsUrl
      ? await window.hermesAPI.freshDashboardWsUrl(profile, connectionId)
      : status.connection.wsUrl;
    assertCurrent();
    if (!url) throw new Error("Pet gateway WebSocket URL is unavailable");
    await client.connect(url);
    assertCurrent();
    return client;
  } catch (error) {
    client.close();
    throw error;
  } finally {
    unsubscribe();
  }
}

export function petRequest<T>(
  client: DashboardGatewayClient,
  profile: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  return client.request<T>(method, { ...params, profile });
}

export interface PetGalleryEntry {
  slug: string;
  displayName: string;
  installed: boolean;
  spritesheetUrl: string;
  generated?: boolean;
  curated?: boolean;
}

export interface PetGallery {
  enabled: boolean;
  active: string;
  pets: PetGalleryEntry[];
}

export interface PetInfoPayload {
  enabled: boolean;
  slug?: string;
  displayName?: string;
  mime?: string;
  spritesheetBase64?: string;
  spritesheetRevision?: string;
  spritesheetUnchanged?: boolean;
  frameW?: number;
  frameH?: number;
  framesPerState?: number;
  framesByState?: Record<string, number>;
  framesByRow?: Record<string, number>;
  loopMs?: number;
  scale?: number;
  stateRows?: string[];
}

export async function refreshPetInfo(
  client: DashboardGatewayClient,
  profile: string,
  previous?: PetInfoPayload,
): Promise<PetInfoPayload> {
  const next = await petRequest<PetInfoPayload>(client, profile, "pet.info", {
    ...(previous?.spritesheetRevision
      ? { knownRevision: previous.spritesheetRevision }
      : {}),
  });
  if (!next.enabled) return { enabled: false };
  if (
    next.spritesheetUnchanged &&
    previous &&
    previous.slug === next.slug &&
    previous.spritesheetRevision === next.spritesheetRevision &&
    previous.spritesheetBase64
  ) {
    const { spritesheetUnchanged: _unchanged, ...metadata } = next;
    return {
      ...previous,
      ...metadata,
      spritesheetBase64: previous.spritesheetBase64,
    };
  }
  // Never display the old species' sheet if a response omits its bytes.
  return next;
}
