// Server-only helpers for milestone mutations. Kept separate from ./plans so the
// node:crypto import never reaches a client bundle (client components only import
// types/constants from ./plans).
import { randomUUID } from "node:crypto";
import type { Checkpoint } from "./plans";

// Give every checkpoint a stable id (assign one to new client-supplied items
// that arrive without one) and keep `done`/`done_at` consistent.
export function stampCheckpoints(input: Checkpoint[], now: string): Checkpoint[] {
  return input.map((c) => {
    const id = c.id?.trim() ? c.id.trim() : `cp_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const done = c.done === true;
    return {
      id,
      title: c.title.trim(),
      due_date: c.due_date ?? "",
      done,
      done_at: done ? c.done_at || now : "",
    };
  });
}
