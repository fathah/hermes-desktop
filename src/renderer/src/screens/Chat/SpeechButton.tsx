import { useEffect, useId, useSyncExternalStore } from "react";
import { LoaderCircle, Square, Volume2 } from "lucide-react";
import { useI18n } from "../../components/useI18n";
import {
  speechPlaybackSnapshot,
  startSpeechPlayback,
  stopSpeechPlayback,
  subscribeSpeechPlayback,
} from "./speech-playback";

export function SpeechButton({
  text,
  profile,
  connectionId,
}: {
  text: string;
  profile: string;
  connectionId: string;
}): React.JSX.Element {
  const { t } = useI18n();
  const instance = useId();
  const owner = `${instance}:${connectionId}:${profile}`;
  const state = useSyncExternalStore(
    subscribeSpeechPlayback,
    speechPlaybackSnapshot,
  );
  const active = state.owner === owner && state.stage !== "idle";
  const loading = active && state.stage === "loading";
  const error = state.owner === owner ? state.error : null;
  useEffect(() => () => stopSpeechPlayback(owner), [owner]);
  return (
    <>
      <button
        type="button"
        className={`chat-bubble-speech${loading ? " is-loading" : active ? " is-playing" : ""}`}
        onClick={() => {
          if (active) stopSpeechPlayback(owner);
          else void startSpeechPlayback(owner, text, profile, connectionId);
        }}
        title={
          loading
            ? t("chat.listenLoading")
            : active
              ? t("chat.listenStop")
              : t("chat.listen")
        }
        aria-label={active ? t("chat.listenStop") : t("chat.listen")}
      >
        {loading ? (
          <LoaderCircle size={14} />
        ) : active ? (
          <Square size={13} />
        ) : (
          <Volume2 size={14} />
        )}
      </button>
      {error && (
        <span className="chat-speech-error" role="alert">
          {t("chat.listenFailed")} {error}
        </span>
      )}
    </>
  );
}
