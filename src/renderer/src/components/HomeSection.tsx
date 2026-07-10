import type { ReactNode } from "react";

interface HomeSectionProps {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}

export default function HomeSection({ title, actions, children }: HomeSectionProps): React.JSX.Element {
  return (
    <section className="content-home-section">
      <div className="content-home-section-header">
        <h2 className="content-home-section-title">{title}</h2>
        {actions ? <div className="content-home-section-actions">{actions}</div> : null}
      </div>
      <div className="content-home-section-body">{children}</div>
    </section>
  );
}
