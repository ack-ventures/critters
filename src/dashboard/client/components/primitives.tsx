import type { CSSProperties, ReactNode } from "react";

interface DotProps {
  color?: string;
  size?: number;
  pulse?: boolean;
  style?: CSSProperties;
}

export function Dot({ color = "currentColor", size = 6, pulse = false, style }: DotProps) {
  return (
    <span
      className={pulse ? "dot dot-pulse" : "dot"}
      style={{ color, width: size, height: size, ...style }}
    />
  );
}

interface PillProps {
  children: ReactNode;
  color?: string;
  borderColor?: string;
  style?: CSSProperties;
}

export function Pill({ children, color, borderColor, style }: PillProps) {
  return (
    <span
      className="pill"
      style={{
        color: color ?? undefined,
        borderColor: borderColor ?? undefined,
        ...style,
      }}
    >
      {children}
    </span>
  );
}

interface ProgressProps {
  value: number;
  color?: string;
  height?: number;
}

export function Progress({ value, color = "var(--accent)", height = 2 }: ProgressProps) {
  const pct = Math.max(0, Math.min(1, value));
  return (
    <div className="progress" style={{ height }}>
      <div className="bar" style={{ width: `${pct * 100}%`, background: color }} />
    </div>
  );
}

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
}

export function Sparkline({ data, width = 80, height = 24, color = "var(--accent)" }: SparklineProps) {
  if (data.length === 0) return null;
  const max = Math.max(1, ...data);
  const min = Math.min(0, ...data);
  const range = max - min || 1;
  const step = data.length > 1 ? width / (data.length - 1) : 0;
  const pts = data.map((d, i) => {
    const x = i * step;
    const y = height - ((d - min) / range) * (height - 2) - 1;
    return [x, y] as const;
  });
  const line = pts
    .map((p, i) => (i === 0 ? `M${p[0].toFixed(1)},${p[1].toFixed(1)}` : `L${p[0].toFixed(1)},${p[1].toFixed(1)}`))
    .join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  return (
    <svg width={width} height={height} style={{ display: "block" }} aria-hidden="true">
      <path d={area} fill={color} opacity="0.12" />
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
