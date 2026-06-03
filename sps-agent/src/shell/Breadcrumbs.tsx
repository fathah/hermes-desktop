// Breadcrumbs.tsx — clickable page-path trail. Ported from app.jsx crumb block.
import { Fragment, useMemo } from "react";
import { Icon } from "../components/Icon";
import { useStore } from "../store";
import { computePathIds } from "../store/selectors";

export function Breadcrumbs() {
  const tree = useStore((s) => s.tree);
  const page = useStore((s) => s.page);
  const meta = useStore((s) => s.meta);
  const selectPage = useStore((s) => s.selectPage);
  const pathIds = useMemo(() => computePathIds(tree, page), [tree, page]);

  return (
    <div className="crumb">
      {pathIds.map((id, i) => {
        const m = meta[id] || { icon: "📄", title: "Untitled" };
        const last = i === pathIds.length - 1;
        return (
          <Fragment key={id}>
            {i > 0 && (
              <span className="sep">
                <Icon name="chevR" size={14} />
              </span>
            )}
            <span className="seg" onClick={() => selectPage(id)}>
              {last ? (
                <b>
                  {m.icon} {m.title}
                </b>
              ) : (
                <>
                  {m.icon} {m.title}
                </>
              )}
            </span>
          </Fragment>
        );
      })}
    </div>
  );
}
