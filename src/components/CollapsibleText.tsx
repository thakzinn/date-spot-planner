"use client";

import { useLayoutEffect, useRef, useState } from "react";

export default function CollapsibleText({
  text,
  className = "",
  lines = 4,
}: {
  text: string;
  className?: string;
  lines?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);

  useLayoutEffect(() => {
    // When expanded, keep the previous measurement so the toggle stays visible.
    if (expanded) return;
    const el = ref.current;
    if (!el) return;
    const check = () => setOverflowing(el.scrollHeight > el.clientHeight + 1);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [text, expanded, lines]);

  const clampStyle = expanded
    ? undefined
    : ({
        display: "-webkit-box",
        WebkitLineClamp: lines,
        WebkitBoxOrient: "vertical",
        overflow: "hidden",
      } as const);

  return (
    <div>
      <p ref={ref} className={`whitespace-pre-line ${className}`} style={clampStyle}>
        {text}
      </p>
      {(overflowing || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-0.5 text-xs font-medium underline opacity-70 hover:opacity-100"
        >
          {expanded ? "แสดงน้อยลง" : "ดูเพิ่มเติม"}
        </button>
      )}
    </div>
  );
}
