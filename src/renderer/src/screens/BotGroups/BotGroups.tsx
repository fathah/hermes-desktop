import { useEffect, useRef, useState, type FormEvent } from "react";
import { useI18n } from "../../components/useI18n";
import {
  mergeBotGroupLog,
  type BotGroupAction,
  type BotGroupEvent,
  type BotGroupOperation,
  type BotGroupResults,
  type BotGroupRoom,
  type BotGroupState,
} from "../../../../shared/bot-groups";
import "./bot-groups.css";

type Draft = { text: string; eventId?: string };
interface Props {
  connectionId: string;
  visible: boolean;
}

/** UI-only state. Hermes is the sole owner of rooms, turns, context and approvals. */
export default function BotGroups({
  connectionId,
  visible,
}: Props): React.JSX.Element {
  const { t } = useI18n();
  const tr = (key: string): string => t("botGroups." + key);
  const [cap, setCap] = useState<BotGroupResults["capabilities"] | null>(null);
  const [rooms, setRooms] = useState<BotGroupRoom[]>([]);
  const [profiles, setProfiles] = useState<
    BotGroupResults["profiles"]["profiles"]
  >([]);
  const [offset, setOffset] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<BotGroupState | null>(null);
  const [events, setEvents] = useState<BotGroupEvent[]>([]);
  const [fresh, setFresh] = useState(false);
  const [readError, setReadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [retry, setRetry] = useState<BotGroupAction | null>(null);
  const [reload, setReload] = useState(0);
  const drafts = useRef(new Map<string, Draft>());
  const createAttempt = useRef<{ signature: string; roomId: string } | null>(
    null,
  );
  const busyRef = useRef(false);
  const current = useRef({ selected, visible });
  current.current = { selected, visible };
  const pollNow = useRef<() => void>(() => {});
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const following = useRef(true);
  const can = (op: BotGroupOperation): boolean =>
    cap?.capabilities?.driver === true &&
    cap.capabilities.methods.includes("groups." + op);
  const message = (error: unknown): string =>
    error instanceof Error ? error.message : tr("requestFailed");
  const request = <K extends BotGroupOperation>(
    op: K,
    params: Record<string, unknown> = {},
  ): Promise<BotGroupResults[K]> =>
    window.hermesAPI.botGroups(connectionId, op, params);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    setCap(null);
    setFresh(false);
    setReadError("");
    void (async () => {
      try {
        const status = await window.hermesAPI.botGroups(
          connectionId,
          "capabilities",
        );
        if (!alive) return;
        setCap(status);
        if (
          !status.available ||
          !["groups.list", "groups.state", "groups.log"].every((m) =>
            status.capabilities?.methods.includes(m),
          )
        ) {
          setReadError(status.error || t("botGroups.unavailable"));
          return;
        }
        const [list, roster] = await Promise.all([
          window.hermesAPI.botGroups(connectionId, "list", {
            limit: 100,
            offset: 0,
          }),
          window.hermesAPI.botGroups(connectionId, "profiles"),
        ]);
        if (!alive) return;
        setRooms(list.rooms);
        setOffset(list.next_offset);
        setProfiles(roster.profiles);
        setSelected((previous) =>
          list.rooms.some((r) => r.room_id === previous)
            ? previous
            : (list.rooms[0]?.room_id ?? null),
        );
      } catch (error) {
        if (alive)
          setReadError(
            error instanceof Error
              ? error.message
              : t("botGroups.requestFailed"),
          );
      }
    })();
    return () => {
      alive = false;
    };
  }, [connectionId, visible, reload, t]);

  useEffect(() => {
    setText(selected ? drafts.current.get(selected)?.text || "" : "");
    setActionError("");
    setRetry(null);
    setSnapshot(null);
    setEvents([]);
    setFresh(false);
    if (!visible || !selected || !cap?.available) return;
    let alive = true,
      reading = false,
      cursor = 0,
      authority = "";
    let history: BotGroupEvent[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async (): Promise<void> => {
      if (!alive || reading || document.hidden) return;
      reading = true;
      let more = false;
      try {
        const state = await window.hermesAPI.botGroups(connectionId, "state", {
          room_id: selected,
        });
        if (!alive) return;
        const identity =
          state.room.authority_gateway_id + ":" + state.room.authority_epoch;
        if (authority && identity !== authority) {
          cursor = 0;
          history = [];
        }
        authority = identity;
        const page = await window.hermesAPI.botGroups(connectionId, "log", {
          room_id: selected,
          since_seq: cursor,
          limit: 100,
        });
        if (!alive) return;
        try {
          history = mergeBotGroupLog(history, page, state.room);
        } catch (error) {
          cursor = 0;
          history = [];
          authority = "";
          throw error;
        }
        cursor = page.cursor;
        more = page.has_more;
        setSnapshot(state);
        setEvents(history);
        setFresh(true);
        setReadError("");
      } catch (error) {
        if (alive) {
          setFresh(false);
          setReadError(
            error instanceof Error
              ? error.message
              : t("botGroups.requestFailed"),
          );
        }
      } finally {
        reading = false;
        if (alive) {
          clearTimeout(timer);
          timer = setTimeout(() => void poll(), more ? 100 : 1800);
        }
      }
    };
    pollNow.current = () => void poll();
    const wake = (): void => {
      if (!document.hidden) void poll();
    };
    document.addEventListener("visibilitychange", wake);
    void poll();
    return () => {
      alive = false;
      clearTimeout(timer);
      pollNow.current = () => {};
      document.removeEventListener("visibilitychange", wake);
    };
  }, [connectionId, visible, selected, cap, t]);

  useEffect(() => {
    if (following.current && logRef.current)
      logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [events]);

  function updateText(value: string): void {
    setText(value);
    if (!selected) return;
    const previous = drafts.current.get(selected);
    drafts.current.set(
      selected,
      previous?.text === value ? previous : { text: value },
    );
  }

  async function mutate(
    op: "approve" | "retry" | "stop",
    params: Record<string, unknown>,
  ): Promise<void> {
    if (busyRef.current || !fresh || !can(op)) return;
    const roomId = selected;
    busyRef.current = true;
    setBusy(true);
    setActionError("");
    try {
      await request(op, params);
    } catch (error) {
      if (current.current.selected === roomId) setActionError(message(error));
    } finally {
      busyRef.current = false;
      setBusy(false);
      pollNow.current();
    }
  }

  async function send(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (
      busyRef.current ||
      !fresh ||
      !selected ||
      !can("send") ||
      !snapshot?.driver_status?.running
    )
      return;
    const roomId = selected;
    const draft = drafts.current.get(roomId);
    if (!draft?.text.trim()) return;
    draft.eventId ||= crypto.randomUUID();
    busyRef.current = true;
    setBusy(true);
    setActionError("");
    try {
      const result = await request("send", {
        room_id: roomId,
        event_id: draft.eventId,
        payload: { text: draft.text, thread_id: "main" },
      });
      if (!result.accepted) throw new Error(tr("sendUnknown"));
      if (drafts.current.get(roomId) === draft) {
        drafts.current.delete(roomId);
        if (current.current.selected === roomId) setText("");
      }
    } catch (error) {
      if (current.current.selected === roomId)
        setActionError(message(error) + " " + tr("sendUnknown"));
    } finally {
      busyRef.current = false;
      setBusy(false);
      pollNow.current();
    }
  }

  async function create(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (busyRef.current || !can("create")) return;
    if (chosen.length < 2 || chosen.length > 6) {
      setActionError(tr("selectMembers"));
      return;
    }
    const params = {
      name: name.trim(),
      members: chosen.map((profile, i) => ({
        member_id: "member-" + (i + 1),
        profile,
        handle: "bot-" + (i + 1),
        display_name:
          profiles.find((p) => p.name === profile)?.display_name || profile,
      })),
    };
    const signature = JSON.stringify(params);
    if (createAttempt.current?.signature !== signature)
      createAttempt.current = {
        signature,
        roomId: "group-" + crypto.randomUUID(),
      };
    busyRef.current = true;
    setBusy(true);
    setActionError("");
    try {
      const result = await request("create", {
        ...params,
        room_id: createAttempt.current.roomId,
      });
      createAttempt.current = null;
      if (!current.current.visible) return;
      setRooms((previous) => [
        result.room,
        ...previous.filter((r) => r.room_id !== result.room.room_id),
      ]);
      setCreating(false);
      setName("");
      setChosen([]);
      setSelected(result.room.room_id);
    } catch (error) {
      setActionError(message(error));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function loadMore(): Promise<void> {
    if (offset === null || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const page = await request("list", { limit: 100, offset });
      setRooms((previous) => [
        ...previous,
        ...page.rooms.filter(
          (r) => !previous.some((p) => p.room_id === r.room_id),
        ),
      ]);
      setOffset(page.next_offset);
    } catch (error) {
      setActionError(message(error));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const room = snapshot?.room;
  const status = snapshot?.driver_status;
  const canSend = fresh && can("send") && status?.running && !busy;
  const pending = status?.pending_actions || [];
  return (
    <section className="bot-groups" aria-label={tr("title")}>
      <aside className="bot-groups-sidebar" aria-label={tr("title")}>
        <h2>{tr("title")}</h2>
        <p className="bot-groups-muted">{tr("experimental")}</p>
        <div className="bot-groups-toolbar">
          <button
            disabled={!can("create") || busy}
            onClick={() => setCreating(true)}
          >
            {tr("create")}
          </button>
          <button disabled={busy} onClick={() => setReload((n) => n + 1)}>
            {tr("refresh")}
          </button>
        </div>
        <nav className="bot-groups-list">
          {!rooms.length && <p className="bot-groups-muted">{tr("empty")}</p>}
          {rooms.map((r) => (
            <button
              key={r.room_id}
              aria-pressed={r.room_id === selected}
              onClick={() => {
                setCreating(false);
                setSelected(r.room_id);
                following.current = true;
              }}
            >
              {r.name}
            </button>
          ))}
          {offset !== null && (
            <button disabled={busy} onClick={() => void loadMore()}>
              {tr("more")}
            </button>
          )}
        </nav>
      </aside>
      <div className="bot-groups-main">
        <header className="bot-groups-header">
          <div>
            <h2>{room?.name || tr("title")}</h2>
            <p className="bot-groups-muted" role="status">
              {!selected
                ? tr("intro")
                : !fresh
                  ? tr("connecting")
                  : !status?.running
                    ? tr("noDriver")
                    : status.blocked
                      ? tr("blocked")
                      : status.working
                        ? tr("working")
                        : tr("ready")}
            </p>
          </div>
          <button
            disabled={
              busy ||
              !fresh ||
              !can("stop") ||
              !(status?.working || status?.blocked)
            }
            onClick={() =>
              void mutate("stop", {
                room_id: selected,
                cancel_id: crypto.randomUUID(),
              })
            }
          >
            {tr("stop")}
          </button>
        </header>
        {(actionError || readError) && (
          <p className="bot-groups-error" role="alert">
            {actionError || readError}
          </p>
        )}
        {creating && (
          <form className="bot-groups-create" onSubmit={create}>
            <label>
              {tr("name")}
              <input
                autoFocus
                value={name}
                maxLength={120}
                required
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <fieldset>
              <legend>{tr("selectMembers")}</legend>
              {profiles.map((p) => (
                <label key={p.name}>
                  <input
                    type="checkbox"
                    checked={chosen.includes(p.name)}
                    onChange={(e) =>
                      setChosen((previous) =>
                        e.target.checked
                          ? [...previous, p.name]
                          : previous.filter((v) => v !== p.name),
                      )
                    }
                  />
                  {p.display_name}
                </label>
              ))}
            </fieldset>
            <div className="bot-groups-toolbar">
              <button type="submit" disabled={busy}>
                {tr("create")}
              </button>
              <button type="button" onClick={() => setCreating(false)}>
                {tr("cancel")}
              </button>
            </div>
          </form>
        )}
        <div className="bot-groups-toolbar">
          {room?.members.map((member) => (
            <button
              key={member.member_id}
              onClick={() => {
                updateText(
                  text +
                    (text && !text.endsWith(" ") ? " " : "") +
                    "@" +
                    member.handle +
                    " ",
                );
                inputRef.current?.focus();
              }}
              title={member.display_name}
            >
              @{member.handle}
            </button>
          ))}
        </div>
        <div
          className="bot-groups-log"
          ref={logRef}
          aria-label={tr("messages")}
          onScroll={(e) => {
            const el = e.currentTarget;
            following.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
        >
          {events.length === 500 && (
            <p className="bot-groups-muted">{tr("recent")}</p>
          )}
          {events
            .filter((e) =>
              [
                "message.user",
                "message.member",
                "turn.failed",
                "turn.cancelled",
                "turn.deferred",
              ].includes(e.kind),
            )
            .map((e) => {
              const member = room?.members.find(
                (m) =>
                  m.member_id === e.payload.member_id ||
                  m.member_id === e.actor?.id,
              );
              return (
                <article
                  key={e.event_id}
                  className={
                    e.kind.startsWith("message.")
                      ? "bot-groups-message"
                      : "bot-groups-notice"
                  }
                >
                  <strong>
                    {e.kind === "message.user"
                      ? tr("you")
                      : member?.display_name || member?.handle || tr("title")}
                  </strong>
                  <div>
                    {e.kind.startsWith("message.")
                      ? e.payload.text
                      : e.payload.error ||
                        e.payload.reason ||
                        tr(e.kind.replace(".", "_"))}
                  </div>
                </article>
              );
            })}
        </div>
        <div className="bot-groups-actions">
          {pending.map((action) => (
            <div
              className="bot-groups-action"
              key={action.kind + action.task_id}
            >
              {action.kind === "approval" ? (
                <>
                  <strong>{tr("approval")}</strong>
                  <pre>
                    {action.approval.command ||
                      action.approval.description ||
                      action.task_id}
                  </pre>
                  {["once", "deny"]
                    .filter((c) => action.approval.choices?.includes(c))
                    .map((choice) => (
                      <button
                        key={choice}
                        disabled={busy || !fresh || !can("approve")}
                        onClick={() =>
                          void mutate("approve", {
                            room_id: selected,
                            member_id: action.member_id,
                            task_id: action.task_id,
                            execution_generation: action.execution_generation,
                            request_id: action.request_id,
                            choice,
                          })
                        }
                      >
                        {tr(choice)}
                      </button>
                    ))}
                </>
              ) : (
                <>
                  <p>{tr("retryWarning")}</p>
                  <button
                    disabled={busy || !fresh || !can("retry")}
                    onClick={() => setRetry(action)}
                  >
                    {tr("retry")}
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
        {retry && (
          <div
            className="bot-groups-action"
            role="alertdialog"
            aria-label={tr("retry")}
          >
            <p>{tr("retryWarning")}</p>
            <button autoFocus onClick={() => setRetry(null)}>
              {tr("cancel")}
            </button>
            <button
              disabled={!fresh || busy}
              onClick={() => {
                void mutate("retry", {
                  room_id: selected,
                  task_id: retry.task_id,
                });
                setRetry(null);
              }}
            >
              {tr("confirmRetry")}
            </button>
          </div>
        )}
        {room && (
          <form className="bot-groups-composer" onSubmit={send}>
            <label htmlFor="bot-group-message">{tr("composeHint")}</label>
            <textarea
              id="bot-group-message"
              ref={inputRef}
              value={text}
              rows={3}
              maxLength={32000}
              onChange={(e) => updateText(e.target.value)}
              placeholder={tr("placeholder")}
            />
            <button type="submit" disabled={!canSend || !text.trim()}>
              {tr("send")}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
