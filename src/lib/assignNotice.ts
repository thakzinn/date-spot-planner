// Server-only: work out who was *newly* assigned to a milestone (or one of its
// checkpoints) between two states, and email each of them a best-effort notice.
// Mirrors the conventions of the confirm/extend notice in milestones/[id]/route:
// reuses sendPlanNotice (sent "as" the actor), never throws, skips when there's
// no Gmail grant.
import type { Milestone, Plan } from "./plans";
import { getUserGmailToken } from "./sheets";
import { sendPlanNotice } from "./gmail";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

// Build a map of email -> human labels they were *just* assigned to, by diffing
// the milestone's (and each checkpoint's) assignees against the previous state.
// Pass existing=null for a brand-new milestone (everything counts as new).
export function diffAssignees(existing: Milestone | null, updated: Milestone): Map<string, string[]> {
  const added = new Map<string, string[]>();
  const push = (email: string, label: string) => {
    if (!email) return;
    const list = added.get(email) ?? [];
    list.push(label);
    added.set(email, list);
  };

  const prevMilestone = new Set(existing?.assignees ?? []);
  for (const email of updated.assignees) {
    if (!prevMilestone.has(email)) push(email, `งาน “${updated.title}”`);
  }

  const prevByCheckpoint = new Map(
    (existing?.checkpoints ?? []).map((c) => [c.id, new Set(c.assignees)] as const),
  );
  for (const cp of updated.checkpoints) {
    const before = prevByCheckpoint.get(cp.id) ?? new Set<string>();
    for (const email of cp.assignees) {
      if (!before.has(email)) push(email, `เช็คพอยต์ “${cp.title}” (ใน “${updated.title}”)`);
    }
  }
  return added;
}

// Email each newly-assigned person (other than the actor) the list of items
// they were just put on. Best-effort — failures are swallowed.
export async function notifyAssignees(
  actor: { email: string; name: string },
  plan: Plan,
  added: Map<string, string[]>,
): Promise<void> {
  const me = actor.email.trim().toLowerCase();
  const recipients = [...added.keys()].filter((e) => e && e !== me);
  if (recipients.length === 0) return;

  let token = "";
  try {
    token = await getUserGmailToken(actor.email);
  } catch {
    return; // no Gmail grant — skip silently
  }

  for (const email of recipients) {
    const items = added.get(email) ?? [];
    const lis = items.map((t) => `<li>${esc(t)}</li>`).join("");
    const subject = `📌 ${plan.title}: คุณได้รับมอบหมายงาน`;
    const html =
      `<div style="font-family:system-ui,Arial,sans-serif;font-size:14px;line-height:1.5">` +
      `<p><b>${esc(actor.name)}</b> มอบหมายงานให้คุณในแผน <b>${esc(plan.title)}</b>:</p>` +
      `<ul>${lis}</ul></div>`;
    await sendPlanNotice(actor, token, subject, html, [email]);
  }
}
