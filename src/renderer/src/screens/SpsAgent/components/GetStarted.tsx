// GetStarted.tsx — the "Get started with" launcher row shown on an empty page
// (Notion's empty-state on-ramp). Each chip routes to an existing affordance;
// nothing here is a new engine. Rendered by DocHeader only when the page is empty.
import { Icon } from "./Icon";
import type { IconName } from "./iconPaths";
import { useStore } from "../store";
import { blk } from "../lib/ids";

interface Chip {
  icon: IconName;
  label: string;
  run: () => void;
}

export function GetStarted() {
  const setSurface = useStore((s) => s.setSurface);
  const startNewChat = useStore((s) => s.startNewChat);
  const setBlocks = useStore((s) => s.setBlocks);
  const setTemplatesOpen = useStore((s) => s.setTemplatesOpen);
  const setPaletteOpen = useStore((s) => s.setPaletteOpen);
  const flash = useStore((s) => s.flash);

  const addDatabase = (): void => {
    setBlocks((bs) => [...bs, blk("database", "", { view: "board" })]);
    flash("Database added");
  };

  const chips: Chip[] = [
    { icon: "sparkle", label: "Ask AI", run: () => setSurface("ask") },
    {
      icon: "calendar",
      label: "AI Meeting Notes",
      run: () =>
        startNewChat(
          "Start an AI meeting note: capture the agenda, take notes during the meeting, and summarise decisions and action items afterwards.",
        ),
    },
    { icon: "database", label: "Database", run: addDatabase },
    {
      icon: "list",
      label: "Form",
      run: () => {
        setTemplatesOpen({ parent: null });
        flash("Pick a form template");
      },
    },
    {
      icon: "doc",
      label: "Templates",
      run: () => setTemplatesOpen({ parent: null }),
    },
    { icon: "dots", label: "", run: () => setPaletteOpen(true) },
  ];

  return (
    <div className="gs-row">
      <div className="gs-label">Get started with</div>
      <div className="gs-chips">
        {chips.map((c, i) => (
          <button
            key={c.label || `more-${i}`}
            className={`gs-chip ${c.label ? "" : "gs-chip-more"}`}
            onClick={c.run}
            title={c.label || "More"}
          >
            <Icon name={c.icon} size={15} />
            {c.label && <span>{c.label}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
