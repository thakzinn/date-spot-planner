import { redirect } from "next/navigation";
import { getSession, encodeFeedToken } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import SpotsView from "@/components/SpotsView";

export const dynamic = "force-dynamic";

export default async function SpotsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  // Per-user calendar token = base64(email). See lib/auth encodeFeedToken.
  const feedToken = encodeFeedToken(session.email);
  return (
    <AppShell userEmail={session.email} feedToken={feedToken}>
      <SpotsView userEmail={session.email} />
    </AppShell>
  );
}
