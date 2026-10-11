import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../useI18n";
import {
  openPetGateway,
  petRequest,
  type PetGallery,
  type PetGalleryEntry,
} from "./petGateway";
import type { DashboardGatewayClient } from "../../screens/Chat/dashboardGatewayClient";
import { useConnectionTargetRevision } from "../../hooks/useConnectionTargetRevision";

interface PetSettingsProps {
  profile: string;
  connectionId: string;
}

interface PetMeta {
  enabled: boolean;
  slug?: string;
  scale?: number;
}

/** Backend-owned pets: selecting here changes the same profile's config and
 * installed gallery that CLI, TUI, and the official desktop use. */
export default function PetSettings({
  profile,
  connectionId,
}: PetSettingsProps): React.JSX.Element {
  const { t } = useI18n();
  const connectionRevision = useConnectionTargetRevision();
  const [client, setClient] = useState<DashboardGatewayClient | null>(null);
  const [gallery, setGallery] = useState<PetGallery | null>(null);
  const [meta, setMeta] = useState<PetMeta | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [scale, setScale] = useState(0.33);
  const [rename, setRename] = useState<{ slug: string; name: string } | null>(
    null,
  );
  const galleryRevision = useRef(0);
  const scopeGeneration = useRef(0);
  const thumbScope = useRef<{
    attempted: Map<string, number>;
    disposed: boolean;
  } | null>(null);

  useEffect(() => {
    if (!connectionId) return;
    ++scopeGeneration.current;
    let disposed = false;
    let socket: DashboardGatewayClient | null = null;
    let connecting = false;
    let localReadRevision = 0;
    galleryRevision.current++;
    setClient(null);
    setGallery(null);
    setMeta(null);
    setThumbs({});
    setBusy(false);
    setError("");
    setRename(null);
    const refresh = async (force = false): Promise<void> => {
      if (!socket?.connected || disposed) return;
      // Polls must not repeatedly supersede a request that is still within
      // the gateway's timeout. A pet.changed event may supersede it immediately.
      if (localReadRevision && !force) return;
      const currentSocket = socket;
      const currentRevision = ++galleryRevision.current;
      localReadRevision = currentRevision;
      try {
        let installed: PetGallery;
        let current: PetMeta;
        try {
          [installed, current] = await Promise.all([
            petRequest<PetGallery>(currentSocket, profile, "pet.gallery", {
              localOnly: true,
            }),
            petRequest<PetMeta>(currentSocket, profile, "pet.info.meta"),
          ]);
        } catch (cause) {
          if (!disposed && galleryRevision.current === currentRevision)
            setError(cause instanceof Error ? cause.message : String(cause));
          return;
        }
        if (disposed || galleryRevision.current !== currentRevision) return;
        setError("");
        setGallery(installed);
        setMeta(current);
        setScale(current.scale ?? 0.33);
        try {
          const full = await petRequest<PetGallery>(
            currentSocket,
            profile,
            "pet.gallery",
          );
          if (!disposed && galleryRevision.current === currentRevision)
            setGallery(full);
        } catch {
          // The online manifest is optional; installed pets remain usable offline.
        }
      } finally {
        if (localReadRevision === currentRevision) localReadRevision = 0;
      }
    };
    const ensureSocket = async (): Promise<void> => {
      if (disposed || connecting) return;
      if (socket?.connected) {
        void refresh();
        return;
      }
      connecting = true;
      socket?.close();
      socket = null;
      try {
        const connected = await openPetGateway(
          profile,
          connectionId,
          (event) => {
            if (event.type === "pet.changed") void refresh(true);
          },
        );
        if (disposed) {
          connected.close();
          return;
        }
        socket = connected;
        setClient(connected);
        setError("");
        void refresh();
      } catch (cause) {
        if (!disposed) {
          setClient(null);
          setGallery(null);
          setMeta(null);
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      } finally {
        connecting = false;
      }
    };
    void ensureSocket();
    const focus = (): void => {
      void ensureSocket();
    };
    window.addEventListener("focus", focus);
    const poll = window.setInterval(() => void ensureSocket(), 12000);
    return () => {
      disposed = true;
      // Invalidate writes that started in the previous connection/profile.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      scopeGeneration.current++;
      window.clearInterval(poll);
      window.removeEventListener("focus", focus);
      socket?.close();
    };
  }, [profile, connectionId, connectionRevision]);

  const visible = useMemo(
    () =>
      (gallery?.pets ?? [])
        .filter((entry) =>
          `${entry.displayName} ${entry.slug}`
            .toLowerCase()
            .includes(query.toLowerCase()),
        )
        .slice(0, 48),
    [gallery, query],
  );

  useEffect(() => {
    if (!client) return;
    const scope = { attempted: new Map<string, number>(), disposed: false };
    thumbScope.current = scope;
    return () => {
      scope.disposed = true;
    };
  }, [client, profile]);

  useEffect(() => {
    if (!client) return;
    const scope = thumbScope.current;
    if (!scope || scope.disposed) return;
    for (const pet of visible) {
      const retryAt = scope.attempted.get(pet.slug);
      if (thumbs[pet.slug] || (retryAt !== undefined && Date.now() < retryAt))
        continue;
      // Infinity marks a request in flight or a successful result.
      scope.attempted.set(pet.slug, Infinity);
      void petRequest<{ dataUri?: string }>(client, profile, "pet.thumb", {
        slug: pet.slug,
        ...(pet.spritesheetUrl ? { url: pet.spritesheetUrl } : {}),
      })
        .then((thumb) => {
          if (scope.disposed) return;
          if (thumb.dataUri)
            setThumbs((old) => ({ ...old, [pet.slug]: thumb.dataUri! }));
          else scope.attempted.set(pet.slug, Date.now() + 10000);
        })
        .catch(() => {
          if (!scope.disposed)
            scope.attempted.set(pet.slug, Date.now() + 10000);
        });
    }
  }, [client, profile, visible, thumbs]);

  const reload = async (
    socket: DashboardGatewayClient,
    scope: number,
  ): Promise<void> => {
    if (scopeGeneration.current !== scope) return;
    const revision = ++galleryRevision.current;
    const [next, current] = await Promise.all([
      petRequest<PetGallery>(socket, profile, "pet.gallery", {
        localOnly: true,
      }),
      petRequest<PetMeta>(socket, profile, "pet.info.meta"),
    ]);
    if (
      scopeGeneration.current !== scope ||
      galleryRevision.current !== revision
    )
      return;
    setGallery(next);
    setMeta(current);
    setScale(current.scale ?? 0.33);
    window.dispatchEvent(
      new CustomEvent("hermes-pet-changed", {
        detail: { profile, connectionId },
      }),
    );
    // Gallery availability can change while adopting a remote pet.
    try {
      const full = await petRequest<PetGallery>(socket, profile, "pet.gallery");
      if (
        scopeGeneration.current === scope &&
        galleryRevision.current === revision
      )
        setGallery(full);
    } catch {
      /* offline */
    }
  };

  const mutate = async (
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<boolean> => {
    if (!client || busy) return false;
    const scope = scopeGeneration.current;
    // A pre-adoption gallery response is no longer authoritative.
    galleryRevision.current++;
    setBusy(true);
    setError("");
    try {
      await petRequest(client, profile, method, params);
      if (scopeGeneration.current !== scope) return false;
      await reload(client, scope);
      return scopeGeneration.current === scope;
    } catch (cause) {
      if (scopeGeneration.current === scope)
        setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      if (scopeGeneration.current === scope) setBusy(false);
    }
  };

  const download = async (pet: PetGalleryEntry): Promise<void> => {
    if (!client || busy) return;
    const scope = scopeGeneration.current;
    setBusy(true);
    try {
      const exported = await petRequest<{
        filename: string;
        zipBase64: string;
      }>(client, profile, "pet.export", { slug: pet.slug });
      if (scopeGeneration.current !== scope) return;
      const bytes = Uint8Array.from(atob(exported.zipBase64), (char) =>
        char.charCodeAt(0),
      );
      const url = URL.createObjectURL(
        new Blob([bytes], { type: "application/zip" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = exported.filename;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      if (scopeGeneration.current === scope)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (scopeGeneration.current === scope) setBusy(false);
    }
  };

  return (
    <section className="settings-field pet-settings">
      <label className="settings-field-label">{t("settings.pet.label")}</label>
      <p className="settings-field-hint">{t("settings.pet.hint")}</p>
      {error && (
        <p role="alert" className="pet-settings-error">
          {error}
        </p>
      )}
      {!gallery && !error && (
        <p className="settings-field-hint">{t("settings.pet.loading")}</p>
      )}
      {gallery && (
        <>
          <div className="settings-row pet-settings-controls">
            <div className="settings-row-text">
              <div className="settings-row-label">
                {t("settings.pet.enabled")}
              </div>
            </div>
            <input
              type="checkbox"
              aria-label={t("settings.pet.enabled")}
              checked={Boolean(meta?.enabled)}
              disabled={busy || !gallery.active}
              onChange={(event) =>
                void mutate(
                  event.target.checked ? "pet.select" : "pet.disable",
                  event.target.checked ? { slug: gallery.active } : {},
                )
              }
            />
          </div>
          <div className="settings-row pet-settings-controls">
            <div className="settings-row-text">
              <div className="settings-row-label">
                {t("settings.pet.scale")}: {scale.toFixed(2)}
              </div>
            </div>
            <input
              aria-label={t("settings.pet.scale")}
              type="range"
              min="0.1"
              max="3"
              step="0.05"
              value={scale}
              disabled={busy}
              onChange={(event) => setScale(Number(event.target.value))}
              onPointerUp={() => void mutate("pet.scale", { scale })}
              onKeyUp={() => void mutate("pet.scale", { scale })}
            />
          </div>
          <input
            type="search"
            className="settings-input"
            aria-label={t("settings.pet.search")}
            placeholder={t("settings.pet.search")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="pet-settings-gallery">
            {visible.map((pet) => (
              <div className="pet-settings-card" key={pet.slug}>
                <button
                  type="button"
                  className={`pet-settings-adopt ${meta?.enabled && meta.slug === pet.slug ? "active" : ""}`}
                  disabled={busy}
                  onClick={() => void mutate("pet.select", { slug: pet.slug })}
                >
                  {thumbs[pet.slug] && <img src={thumbs[pet.slug]} alt="" />}
                  <span>{pet.displayName}</span>
                  <small>
                    {meta?.enabled && meta.slug === pet.slug
                      ? t("settings.pet.active")
                      : pet.installed
                        ? t("settings.pet.installed")
                        : t("settings.pet.adopt")}
                  </small>
                </button>
                {pet.installed && (
                  <div className="pet-settings-actions">
                    {pet.generated && (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            setRename({ slug: pet.slug, name: pet.displayName })
                          }
                        >
                          {t("settings.pet.rename")}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void download(pet)}
                        >
                          {t("settings.pet.export")}
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            t("settings.pet.confirmRemove", {
                              name: pet.displayName,
                            }),
                          )
                        )
                          void mutate("pet.remove", { slug: pet.slug });
                      }}
                    >
                      {t("settings.pet.remove")}
                    </button>
                  </div>
                )}
                {rename?.slug === pet.slug && (
                  <form
                    className="pet-settings-rename"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const name = rename.name.trim();
                      if (name)
                        void mutate("pet.rename", {
                          slug: pet.slug,
                          name,
                        }).then((saved) => {
                          if (saved) setRename(null);
                        });
                    }}
                  >
                    <input
                      className="settings-input"
                      aria-label={t("settings.pet.rename")}
                      value={rename.name}
                      disabled={busy}
                      autoFocus
                      onChange={(event) =>
                        setRename({ slug: pet.slug, name: event.target.value })
                      }
                    />
                    <div className="pet-settings-actions">
                      <button
                        type="submit"
                        disabled={busy || !rename.name.trim()}
                      >
                        {t("common.save")}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setRename(null)}
                      >
                        {t("common.cancel")}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
