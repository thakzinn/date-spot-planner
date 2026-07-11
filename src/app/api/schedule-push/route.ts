// POST /api/schedule-push — Upstash Workflow endpoint (NOT called by the browser
// directly; it's invoked by QStash after scheduleReminder() triggers it, and
// re-invoked each time a durable step resumes).
//
// Flow:
//   1. Upstash delivers the SchedulePushBody as context.requestPayload.
//   2. context.sleepUntil() suspends the run until the due timestamp. No compute
//      is used (or billed) while sleeping — Upstash calls us back when it fires.
//   3. context.run() sends the push exactly once (steps are checkpointed, so a
//      retry after the send won't double-send).
//
// web-push + our Sheets store both need Node APIs, so this MUST be the Node.js
// runtime. Signature verification is handled by `serve` using the QSTASH signing
// keys in env — an unsigned/forged request is rejected before our code runs.
import { serve } from "@upstash/workflow/nextjs";
import { sendPushToUser, type PushResult } from "@/lib/push";
import type { SchedulePushBody } from "@/lib/scheduleReminder";

export const runtime = "nodejs";
// The route itself returns fast between steps; only the final send does real
// work. Keep the cap low so a hung push service fails fast rather than tying up
// the function for the full platform limit.
export const maxDuration = 30;

export const { POST } = serve<SchedulePushBody>(
  async (context) => {
    const { email, payload, dueTimestamp, taskId } = context.requestPayload;

    // Durable sleep until the exact due moment. sleepUntil takes a Date/epoch and
    // is preferable to computing a delay + context.sleep(seconds): the target time
    // is absolute, so it stays correct no matter when Upstash resumes the run.
    await context.sleepUntil("wait-for-due-date", new Date(dueTimestamp));

    // Send exactly once. sendPushToUser fans out to every device the user has
    // enabled and prunes dead endpoints; it never throws, so we surface its
    // tally as the step result (visible in the Upstash run log for debugging).
    const result = await context.run<PushResult>("send-push", async () => {
      return sendPushToUser(email, payload);
    });

    // Optional: a follow-up nudge if nothing was delivered (e.g. user had no
    // active subscription at fire time). Left as a no-op branch for clarity.
    if (result.sent === 0) {
      console.warn(`[schedule-push] no device received reminder for ${taskId}`, result);
    }
  },
  {
    // Surface unexpected failures (after retries) in your logs/monitoring instead
    // of failing silently inside QStash.
    failureFunction: async ({ context, failStatus, failResponse }) => {
      console.error(
        `[schedule-push] workflow failed for ${context.requestPayload?.taskId}`,
        failStatus,
        failResponse,
      );
    },
  },
);
