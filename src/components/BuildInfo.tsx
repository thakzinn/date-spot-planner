// Tiny build stamp (commit SHA + deploy time) shown under the page title.
// Reads NEXT_PUBLIC_* env baked in at build; renders nothing locally where unset.
export default function BuildInfo() {
  const sha = process.env.NEXT_PUBLIC_COMMIT_SHA;
  const builtAt = process.env.NEXT_PUBLIC_BUILD_TIME;
  if (!sha && !builtAt) return null;

  const deployed = builtAt
    ? new Date(builtAt).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : null;

  return (
    <p className="text-[11px] leading-tight opacity-50">
      {sha && <span className="font-mono">{sha}</span>}
      {sha && deployed && " · "}
      {deployed && <span suppressHydrationWarning>deployed {deployed}</span>}
    </p>
  );
}
