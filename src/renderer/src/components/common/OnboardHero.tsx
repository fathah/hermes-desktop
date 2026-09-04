import { useEffect, useRef, useState, type ReactNode } from "react";

// Deterministic twinkling starfield — golden-angle spread so dots never clump.
// Generated once at module load, not per render.
const PARTICLES = Array.from({ length: 22 }, (_, i) => ({
  x: (i * 137.508) % 100,
  y: (i * 61.803 + 13) % 100,
  delay: (i % 7) * 0.6,
  dur: 2.6 + (i % 5) * 0.9,
  size: i % 3 === 0 ? 2.5 : 1.5,
}));

// The winged-circle Hermes emblem. `draw` renders the stroke-draw variant used
// by the flying intro logo; otherwise the settled filled emblem. Same path data
// as the app icon.
function Emblem({ draw = false }: { draw?: boolean }): React.JSX.Element {
  const cls = (n: 1 | 2 | 3 | 4): string | undefined =>
    draw ? `onboard-fp${n}` : undefined;
  const pl = draw ? 100 : undefined;
  return (
    <svg
      viewBox="0 0 1031 840"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <g transform="matrix(1.055283,0,0,1.055283,-23.362357,13.31244)">
        <path
          className={cls(1)}
          pathLength={pl}
          d="M897.287,403.141C877.727,771.643 414.657,916.614 191.976,607.161C135.094,528.114 121.935,418.056 125.454,404.557C158.999,432.392 189.526,438.661 206.625,447.216C205.511,449.344 205.384,449.311 205.422,449.515C240.977,637.726 446.226,749.074 621.402,680.254C790.615,613.777 814.731,457.624 817.258,446.22C826.207,439.704 851.406,438.927 897.287,403.141Z"
        />
        <path
          className={cls(2)}
          pathLength={pl}
          d="M853.663,208.827C846.696,212.456 787.389,232.861 781.593,234.855C769.641,215.272 742.64,167.459 676.622,125.309C537.857,36.711 335.144,70.828 240.436,234.943C235.416,233.673 172.36,211.726 168.381,209.762C186.795,177.089 240.95,78.49 375.661,26.915C532.56,-33.156 744.154,15.724 849.09,201.734C851.192,205.46 851.349,205.239 853.663,208.827Z"
        />
      </g>
      <g transform="matrix(1.017285,0,0,1.017285,-1106.845834,-379.458979)">
        <g transform="matrix(1.26669,0,0,1.141704,950.929729,326.896164)">
          <path
            className={cls(3)}
            pathLength={pl}
            d="M478.851,428.455C480.546,445.893 480.039,445.908 480.347,647.447C480.36,656.392 470.24,620.055 430.388,599.72C379.075,573.537 328.727,564.501 308.889,496.445C307.568,491.912 311.783,496.141 388.318,525.977C444.758,547.978 449.51,555.454 447.701,549.463C435.179,507.985 391.337,498.549 345.666,480.106C247.901,440.625 204.916,434.806 182.124,372.631C178.782,363.515 172.419,335.859 178.28,339.887C216.424,366.101 369.298,416.645 427.415,443.689C435.44,447.424 430.725,440.45 430.027,438.67C416.836,405.023 402.676,403.591 303.672,365.05C233.057,337.561 170.796,322.932 133.95,253.26C117.725,222.581 110.447,183.882 114.343,186.811C190.959,244.396 197.033,239.867 393.531,316.418C468.755,345.724 475.908,410.871 478.851,428.455Z"
          />
        </g>
        <g transform="matrix(1.26669,0,0,1.141704,950.929729,326.896164)">
          <path
            className={cls(4)}
            pathLength={pl}
            d="M840.744,342.508C832.185,427.95 767.841,441.451 702.568,467.668C605.745,506.558 584.185,507.302 568.824,550.528C566.584,556.833 571.765,547.961 646.303,519.011C704.754,496.309 708.894,491.385 707.76,496.497C697.945,540.722 661.233,562.502 655.236,566.06C598.028,599.999 574.203,588.822 538.122,648.117C536.234,651.219 536.748,646.058 536.712,549.501C536.671,440.149 532.558,405.868 560.833,364.722C591.102,320.675 619.553,320.002 751.306,267.023C814.932,241.438 845.491,231.615 901.581,187.625C904.133,185.624 904.067,187.391 904.042,187.587C890.292,295.531 799.599,331.586 785.402,337.23C620.991,402.593 617.451,397.806 598.965,417.915C590.676,426.932 582.422,446.864 586.46,445.279C615.249,433.974 614.445,432.494 643.511,421.528C807.229,359.759 824.346,348.809 838.603,339.688C840.762,338.307 840.576,340 840.744,342.508Z"
          />
        </g>
      </g>
    </svg>
  );
}

type Phase = "draw" | "settle" | "done";

// Draw completes and the fill lands by ~2.2s; then the logo flies to its slot.
const DRAW_MS = 2200;
const SETTLE_MS = 950;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

interface OnboardHeroProps {
  eyebrow: string;
  title: ReactNode;
  children?: ReactNode;
  // Play the full big-centre → draw → fly-up intro. Off = emblem fades in place
  // and content cascades immediately (used on downstream onboarding screens).
  intro?: boolean;
  // Widen the content column (installing progress / terminal log).
  wide?: boolean;
}

/**
 * Shared cinematic chrome for the onboarding screens. Renders the aurora
 * backdrop, starfield, animated Hermes emblem, eyebrow, upright title, and the
 * page-specific `children` inside a reveal-on-settle body.
 */
function OnboardHero({
  eyebrow,
  title,
  children,
  intro = false,
  wide = false,
}: OnboardHeroProps): React.JSX.Element {
  const emblemRef = useRef<HTMLDivElement>(null);
  const reduced = useRef(prefersReducedMotion()).current;
  const runIntro = intro && !reduced;

  const [phase, setPhase] = useState<Phase>(runIntro ? "draw" : "done");
  // Transform applied to the flying logo once we know where its slot is.
  const [flyStyle, setFlyStyle] = useState<React.CSSProperties>({});

  useEffect(() => {
    if (!runIntro) return;
    const timers: ReturnType<typeof setTimeout>[] = [];

    timers.push(
      setTimeout(() => {
        // Measure the settled slot and fly the big centred logo into it.
        const el = emblemRef.current;
        if (el) {
          const r = el.getBoundingClientRect();
          const tx = r.left + r.width / 2 - window.innerWidth / 2;
          const ty = r.top + r.height / 2 - window.innerHeight / 2;
          const s = r.width / 180;
          setFlyStyle({
            transform: `translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px)) scale(${s})`,
          });
        }
        setPhase("settle");
      }, DRAW_MS),
    );

    timers.push(setTimeout(() => setPhase("done"), DRAW_MS + SETTLE_MS));

    return () => timers.forEach(clearTimeout);
  }, [runIntro]);

  return (
    <div className="screen onboard-screen" data-phase={phase}>
      <div className="onboard-fx" aria-hidden="true">
        <div className="onboard-aurora" />
        <div className="onboard-vignette" />
        {PARTICLES.map((p, i) => (
          <span
            key={i}
            className="onboard-particle"
            style={{
              left: `${p.x}%`,
              top: `${p.y}%`,
              width: p.size,
              height: p.size,
              animation: `onboardTwinkle ${p.dur}s ease ${p.delay}s infinite`,
            }}
          />
        ))}
      </div>

      <div className={`onboard-hero${wide ? " onboard-hero--wide" : ""}`}>
        <div className="onboard-emblem" ref={emblemRef}>
          <div className="onboard-emblem-glow" />
          <Emblem />
        </div>

        <div className="onboard-eyebrow">{eyebrow}</div>
        <h1 className="onboard-title">{title}</h1>
        <div className="onboard-body">{children}</div>
      </div>

      {runIntro && phase !== "done" && (
        <div className="onboard-fly" style={flyStyle} aria-hidden="true">
          <div className="onboard-fly-glow" />
          <Emblem draw />
        </div>
      )}
    </div>
  );
}

export default OnboardHero;
