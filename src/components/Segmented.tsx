"use client";

// A small segmented control: one row of buttons where exactly one is active.
// Generic over the value type so callers keep their own string-literal unions.
export default function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="inline-flex rounded-lg border border-black/15 p-0.5 dark:border-white/20">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
            value === o.value ? "bg-pink-600 text-white" : "opacity-70 hover:opacity-100"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
