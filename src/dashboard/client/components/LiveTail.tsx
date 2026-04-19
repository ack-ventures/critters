import { useEffect, useRef } from "react";
import type { ActiveCritterDetail } from "../../../types.js";
import { fmtDuration, phaseLabel, shortRepo, typeColor } from "../lib/format.js";
import { useSSE } from "../lib/useSSE.js";
import { useTick } from "../lib/useTick.js";

interface LiveTailProps {
  critter: ActiveCritterDetail | null;
}

export function LiveTail({ critter }: LiveTailProps) {
  useTick(1000);

  if (!critter) {
    return (
      <div className="tail-empty">nothing to tail — all quiet</div>
    );
  }

  return <ConnectedTail critter={critter} />;
}

function ConnectedTail({ critter }: { critter: ActiveCritterDetail }) {
  const url = `/api/logs/${encodeURIComponent(critter.identifier)}/stream`;
  const { lines, connected, done } = useSSE(url);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `lines` is the trigger — effect only touches the DOM ref.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [lines]);

  const elapsed = Date.now() - critter.startedAt;
  const type = critter.critterType ?? "create";
  const color = typeColor(type);

  return (
    <>
      <div className="tail-head">
        <span className="dim">tail —</span>
        <strong>{critter.identifier}</strong>
        <span className="dim">·</span>
        <span>{shortRepo(critter.repo)}</span>
        <span className="dim">·</span>
        <span style={{ color }}>{phaseLabel(critter.phase)}</span>
        <span style={{ flex: 1 }} />
        <span className="dim">{fmtDuration(elapsed)}</span>
        <span className="dim">·</span>
        <span className="dim">{done ? "stream closed" : connected ? "live" : "connecting\u2026"}</span>
      </div>
      <div ref={bodyRef} className="tail-body">
        {lines.length === 0 && (
          <div className="tail-empty">waiting for logs…</div>
        )}
        {lines.map((l, i) => {
          const kind = classifyLine(l);
          // Log lines can legitimately duplicate; index is stable enough for
          // a scrolling tail where identity doesn't need to survive reorders.
          const key = `${i}:${l.slice(0, 40)}`;
          return (
            <div key={key} className={`ln ${kind}`}>
              <span className="txt">{l}</span>
            </div>
          );
        })}
        {!done && <div className="ln"><span className="ts">now</span><span className="cursor">{"\u258A"}</span></div>}
      </div>
      <div className="tail-foot">
        <span>branch <span className="br">{critter.branch}</span></span>
        <span style={{ flex: 1 }} />
        {critter.prUrl && (
          <a href={critter.prUrl} target="_blank" rel="noreferrer">open PR ↗</a>
        )}
        <a href={`/dashboard/${encodeURIComponent(critter.identifier)}`}>full log ↗</a>
      </div>
    </>
  );
}

function classifyLine(line: string): "tool" | "assistant" | "stdout" {
  if (/^\s*→\s/.test(line)) return "tool";
  if (/^\s*\[/.test(line)) return "stdout";
  return "assistant";
}
