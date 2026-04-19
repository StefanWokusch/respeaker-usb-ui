import type { PropsWithChildren, ReactNode } from "react";

interface ControlCardProps extends PropsWithChildren {
  title: string;
  eyebrow?: string;
  actions?: ReactNode;
  className?: string;
}

export default function ControlCard({
  title,
  eyebrow,
  actions,
  className,
  children
}: ControlCardProps) {
  return (
    <section className={`control-card ${className ?? ""}`.trim()}>
      <header className="control-card__header">
        <div>
          {eyebrow ? <p className="control-card__eyebrow">{eyebrow}</p> : null}
          <h2 className="control-card__title">{title}</h2>
        </div>
        {actions ? <div className="control-card__actions">{actions}</div> : null}
      </header>
      <div className="control-card__content">{children}</div>
    </section>
  );
}
