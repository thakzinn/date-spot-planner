// Kicks off a durable per-task reminder. Unlike the daily Vercel Cron
// (src/app/api/cron/reminders/route.ts), which polls once at 01:00 Bangkok, this
// schedules ONE workflow run per task that sleeps until the exact due timestamp
// and then pushes. Backed by Upstash Workflow (QStash): the sleep survives
// serverless cold starts and function timeouts — Upstash re-invokes our route
// when the timer fires, so nothing runs (or is billed) while we wait.
//
// Server-only. Call this from wherever a task/milestone with a due date is
// created or its due date changes (e.g. the plans API).
import { Client } from "@upstash/workflow";
import type { PushPayload } from "./push";
import type { Milestone, Plan } from "./plans";

// The request body our workflow route (src/app/api/schedule-push/route.ts)
// receives and hands to context.requestPayload.
export interface SchedulePushBody {
  /** Who to notify — matched against the push_subscriptions store. */
  email: string;
  /** The notification content (same shape the service worker renders). */
  payload: PushPayload;
  /** When to fire, as epoch milliseconds (Date.now()-style). */
  dueTimestamp: number;
  /** Stable id (e.g. milestone id) so we can dedupe / cancel later. */
  taskId: string;
}

// The public URL Upstash calls back into. On Vercel this is provided
// automatically; locally you must expose your dev server (see README/env notes)
// and set UPSTASH_WORKFLOW_URL to the tunnel origin.
function baseUrl(): string {
  const explicit = process.env.UPSTASH_WORKFLOW_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}

let client: Client | null = null;
function qstash(): Client {
  if (client) return client;
  const token = process.env.QSTASH_TOKEN;
  if (!token) throw new Error("QSTASH_TOKEN is not set");
  client = new Client({ token });
  return client;
}

export interface ScheduleResult {
  scheduled: boolean;
  workflowRunId?: string;
  reason?: string;
}

// Schedule a single reminder. No-ops (without throwing) when the due time is
// already in the past, so callers can fire-and-forget on every task save.
export async function scheduleReminder(
  body: SchedulePushBody,
): Promise<ScheduleResult> {
  if (!Number.isFinite(body.dueTimestamp)) {
    return { scheduled: false, reason: "invalid dueTimestamp" };
  }
  // We can't read the wall clock deterministically inside the workflow, but here
  // (at schedule time) it's fine to skip already-due tasks.
  if (body.dueTimestamp <= Date.now()) {
    return { scheduled: false, reason: "due time is in the past" };
  }

  const { workflowRunId } = await qstash().trigger({
    url: `${baseUrl()}/api/schedule-push`,
    body,
    // A deterministic id lets a re-save of the same task replace the pending run
    // instead of stacking duplicates. Upstash treats a repeated id as the same
    // workflow when `failureUrl`/retries kick in.
    workflowRunId: `reminder-${body.taskId}`,
    retries: 3,
  });

  return { scheduled: true, workflowRunId };
}

// Who to remind about a milestone: its explicit assignees if any, otherwise
// everyone on the plan (creator + invitees). Lowercased + de-duped.
function recipientsFor(plan: Plan, milestone: Milestone): string[] {
  const base = milestone.assignees.length
    ? milestone.assignees
    : [plan.created_by, ...plan.invitees];
  return [...new Set(base.map((e) => e.trim().toLowerCase()).filter(Boolean))];
}

// Best-effort: schedule an exact-time reminder for a milestone to each recipient.
// NEVER throws — a missing QSTASH_TOKEN (e.g. local dev) or a QStash hiccup must
// not fail the milestone write that called us. Returns how many runs were
// scheduled (0 when there's no due date, it's already past, or QStash is
// unconfigured/unreachable). Fire-and-forget from the milestones route.
export async function scheduleMilestoneReminders(
  plan: Plan,
  milestone: Milestone,
): Promise<number> {
  const due = Date.parse(milestone.due_date);
  if (Number.isNaN(due) || due <= Date.now()) return 0;

  const payload: PushPayload = {
    title: `⏰ ${plan.title}`,
    body: `${milestone.title} ถึงกำหนดแล้ว`,
    url: "/plans",
    tag: `milestone-${milestone.id}`,
  };

  const results = await Promise.all(
    recipientsFor(plan, milestone).map(async (email) => {
      try {
        const r = await scheduleReminder({
          email,
          payload,
          dueTimestamp: due,
          // Unique per (milestone, recipient) so re-saving replaces this exact
          // run rather than colliding across recipients.
          taskId: `${milestone.id}:${email}`,
        });
        return r.scheduled ? 1 : 0;
      } catch (err) {
        console.error("[scheduleMilestoneReminders] failed for", email, err);
        return 0;
      }
    }),
  );
  return results.reduce<number>((n, x) => n + x, 0);
}
