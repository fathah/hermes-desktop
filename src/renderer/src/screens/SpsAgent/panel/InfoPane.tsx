// InfoPane.tsx — page stats, metadata, contributors. Ported from panel.jsx InfoPane.
import { Icon } from "../components/Icon";
import { PEOPLE } from "../data/seed";
import { Avatar } from "../tasks/chips";
import type { Block, Comment } from "../types";

interface Props {
  blocks: Block[];
  comments: Comment[];
}

export function InfoPane({ blocks, comments }: Props) {
  const words = blocks.reduce(
    (n, b) =>
      n + (b.text ? b.text.trim().split(/\s+/).filter(Boolean).length : 0),
    0,
  );
  const heads = blocks.filter((b) =>
    ["h1", "h2", "h3"].includes(b.type),
  ).length;
  const todos = blocks.filter((b) => b.type === "todo");
  const doneT = todos.filter((b) => b.done).length;
  return (
    <div className="rp-body scroll">
      <div className="info-pane">
        <div className="info-stat">
          <div>
            <div className="n">{words}</div>
            <div className="l">Words</div>
          </div>
          <div>
            <div className="n">{blocks.length}</div>
            <div className="l">Blocks</div>
          </div>
          <div>
            <div className="n">{heads}</div>
            <div className="l">Headings</div>
          </div>
        </div>
        <div className="field-grid">
          <div className="fk">
            <Icon name="clock" size={15} /> Created
          </div>
          <div className="fv">May 21, 2026</div>
          <div className="fk">
            <Icon name="clock" size={15} /> Edited
          </div>
          <div className="fv">2m ago</div>
          <div className="fk">
            <Icon name="home" size={15} /> Owner
          </div>
          <div className="fv">
            <span className="person">
              <Avatar who="maya" />
              Maya Rao
            </span>
          </div>
          <div className="fk">
            <Icon name="checkbox" size={15} /> Tasks
          </div>
          <div className="fv num">
            {doneT}/{todos.length} done
          </div>
          <div className="fk">
            <Icon name="comment" size={15} /> Comments
          </div>
          <div className="fv num">{comments.length}</div>
        </div>
        <hr className="b-divider" style={{ margin: "16px 0" }} />
        <div className="type-section-label" style={{ marginBottom: 10 }}>
          Contributors
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {(["maya", "theo", "priya", "sam"] as const).map((w) => (
            <div key={w} className="person" style={{ fontSize: 13.5 }}>
              <Avatar who={w} size={22} />
              {PEOPLE[w].name}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
