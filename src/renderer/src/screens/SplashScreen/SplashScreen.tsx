import { useEffect, useRef, useState } from "react";
import startVid from "../../assets/startvid.mp4";
import splashLogo from "../../assets/hermes-one.svg";

interface SplashScreenProps {
  onFinished: () => void;
  status?: string;
  // When provided, a "Switch to local mode" escape hatch appears after a delay
  // so a stuck remote/SSH connect (e.g. an unresponsive "Starting SSH tunnel…")
  // never traps the user on the splash. Omitted in local mode.
  onSwitchToLocal?: () => void;
}

// How long the splash may sit on a remote/SSH step before we offer the escape
// hatch. Long enough that a normal first-connect (gateway provisioning, dist
// build, health waits) isn't interrupted, short enough to rescue a hang.
const ESCAPE_HATCH_DELAY_MS = 12000;

function SplashScreen({
  onFinished,
  status,
  onSwitchToLocal,
}: SplashScreenProps): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [showEscape, setShowEscape] = useState(false);
  // Stable boolean so the timer below isn't reset every time the parent
  // re-renders and passes a fresh onSwitchToLocal function identity.
  const canSwitch = Boolean(onSwitchToLocal);

  useEffect(() => {
    onFinished();
  }, [onFinished]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = 1;
    video.play().catch(() => {
      // autoplay blocked or video error — silently fall back to black bg
    });
  }, []);

  useEffect(() => {
    if (!canSwitch) return;
    const timer = setTimeout(() => setShowEscape(true), ESCAPE_HATCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [canSwitch]);

  return (
    <div className="splash-screen">
      <video
        ref={videoRef}
        className="splash-bg"
        src={startVid}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        style={{ display: "block", objectFit: "cover" }}
      />
      <img className="splash-logo" src={splashLogo} alt="Hermes One" />
      {onSwitchToLocal && showEscape && (
        <div className="splash-escape">
          <span className="splash-escape-hint">Taking longer than usual?</span>
          <button type="button" onClick={onSwitchToLocal}>
            Switch to local mode
          </button>
        </div>
      )}
      {status && <div className="splash-status">{status}</div>}
    </div>
  );
}

export default SplashScreen;
