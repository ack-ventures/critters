import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  right?: ReactNode;
}

export function PageHeader({ title, subtitle, right }: PageHeaderProps) {
  return (
    <div className="page-header">
      <div className="ph-text">
        <h1>{title}</h1>
        {subtitle && <div className="ph-subtitle">{subtitle}</div>}
      </div>
      {right && <div className="ph-right">{right}</div>}
    </div>
  );
}
