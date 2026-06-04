// RightPanel.tsx — tabbed right panel: Assistant · Outline · Comments · Info.
// Ported from panel.jsx RightPanel. The Assistant body is filled in Phase 8.
import { useMemo } from "react";
import { Icon } from "../components/Icon";
import type { IconName } from "../components/iconPaths";
import { useStore } from "../store";
import { selectCurrentBlocks } from "../store/selectors";
import { scrollToAnchor, scrollToBlock } from "../lib/scroll";
import type { RightTab } from "../store/storeTypes";
import { AgentBody } from "../assistant/AgentBody";
import { Outline } from "./Outline";
import { CommentsPane, type CommentApi } from "./CommentsPane";
import { InfoPane } from "./InfoPane";

export function RightPanel() {
  const tab = useStore((s) => s.rightTab);
  const setTab = useStore((s) => s.setRightTab);
  const setPanelOpen = useStore((s) => s.setPanelOpen);
  const blocks = useStore(selectCurrentBlocks);
  // select raw state, derive per-page comments via useMemo (a selector that
  // .filter()s would return a new array each call → infinite re-render loop)
  const allComments = useStore((s) => s.comments);
  const page = useStore((s) => s.page);
  const comments = useMemo(
    () => allComments.filter((c) => !c.page || c.page === page),
    [allComments, page],
  );
  const replyComment = useStore((s) => s.replyComment);
  const resolveComment = useStore((s) => s.resolveComment);
  const removeComment = useStore((s) => s.removeComment);

  const openCmts = comments.filter((c) => !c.resolved).length;
  const tabs: [RightTab, string, IconName, number | null][] = [
    ["assistant", "Assistant", "sparkle", null],
    ["outline", "Outline", "list", null],
    ["comments", "Comments", "comment", openCmts || null],
    ["info", "Info", "clock", null],
  ];

  const commentApi: CommentApi = {
    reply: replyComment,
    resolve: resolveComment,
    remove: removeComment,
    scrollToAnchor,
  };

  return (
    <aside className="rp">
      <div className="rp-tabs">
        {tabs.map(([id, label, icon, badge]) => (
          <button
            key={id}
            className={`rp-tab ${tab === id ? "active" : ""}`}
            onClick={() => setTab(id)}
          >
            <Icon name={icon} size={15} /> {label}
            {badge ? <span className="badge">{badge}</span> : null}
          </button>
        ))}
        <button
          className="rp-tab rp-close"
          title="Close"
          onClick={() => setPanelOpen(false)}
        >
          <Icon name="panelRight" size={16} />
        </button>
      </div>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {tab === "assistant" && <AgentBody />}
        {tab === "outline" && (
          <Outline blocks={blocks} onScrollToBlock={scrollToBlock} />
        )}
        {tab === "comments" && (
          <CommentsPane comments={comments} api={commentApi} />
        )}
        {tab === "info" && (
          <InfoPane blocks={blocks} comments={comments} pageId={page} />
        )}
      </div>
    </aside>
  );
}
