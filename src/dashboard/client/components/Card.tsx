import type { ReactNode } from "react";

interface CardProps {
  title?: ReactNode;
  right?: ReactNode;
  pad?: boolean;
  children: ReactNode;
  className?: string;
}

export function Card({ title, right, pad = true, children, className }: CardProps) {
  return (
    <div className={`card${className ? ` ${className}` : ""}`}>
      {title && (
        <div className="card-head">
          <h3>{title}</h3>
          <span className="spacer" />
          {right}
        </div>
      )}
      <div className={pad ? "body" : undefined}>{children}</div>
    </div>
  );
}

interface KVProps {
  k: string;
  v: ReactNode;
}

export function KV({ k, v }: KVProps) {
  return (
    <div className="kv">
      <div className="kv-label">{k}</div>
      <div className="kv-value">{v}</div>
    </div>
  );
}
