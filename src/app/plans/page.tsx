import { redirect } from "next/navigation";
import { getSession, encodeFeedToken } from "@/lib/auth";
import PlansView from "@/components/PlansView";

export const dynamic = "force-dynamic";

export default async function PlansPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/plans");
  // Per-user calendar token = base64(email). See lib/auth encodeFeedToken.
  const feedToken = encodeFeedToken(session.email);
  return (
    <PlansView userEmail={session.email} userName={session.name} feedToken={feedToken} />
  );
}
