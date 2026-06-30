// Resolve whether a user may see an attachment's host entity (spot / plan /
// milestone), reusing the same visibility rule each feature already applies:
// you can see something you created OR were invited to. A milestone inherits
// the visibility of its parent plan. Server-only.
import { getPlaceById } from "./sheets";
import { getMilestoneById, getPlanById } from "./plansStore";
import type { AttachmentEntity } from "./attachments";

export interface EntityAccess {
  // The signed-in user can see (and attach to) the entity.
  canSee: boolean;
  // Email of the entity's creator — allowed to delete others' attachments on it.
  ownerEmail: string;
}

function member(email: string, createdBy: string, invitees: string[]): boolean {
  const me = email.trim().toLowerCase();
  return createdBy.trim().toLowerCase() === me || invitees.includes(me);
}

// Returns access info, or null if the entity doesn't exist (or was deleted).
export async function resolveEntityAccess(
  email: string,
  entityType: AttachmentEntity,
  entityId: string,
): Promise<EntityAccess | null> {
  if (entityType === "spot") {
    const place = await getPlaceById(entityId);
    if (!place) return null;
    return { canSee: member(email, place.created_by, place.invitees), ownerEmail: place.created_by };
  }
  if (entityType === "plan") {
    const plan = await getPlanById(entityId);
    if (!plan) return null;
    return { canSee: member(email, plan.created_by, plan.invitees), ownerEmail: plan.created_by };
  }
  // milestone → inherit its plan's visibility
  const milestone = await getMilestoneById(entityId);
  if (!milestone) return null;
  const plan = await getPlanById(milestone.plan_id);
  if (!plan) return null;
  return { canSee: member(email, plan.created_by, plan.invitees), ownerEmail: plan.created_by };
}
