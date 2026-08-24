import type { ReactNode } from "react";

type PageHeaderProps = {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
};

export function PageHeader({ eyebrow, title, description, actions }: PageHeaderProps) {
  return (
    <header className="os-page-header">
      <div>
        <p className="os-eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="os-page-description">{description}</p>
      </div>
      {actions ? <div className="os-page-actions">{actions}</div> : null}
    </header>
  );
}
