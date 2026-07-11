import { redirect } from "next/navigation";
import { getSession, encodeFeedToken } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import HomeView from "@/components/HomeView";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getSession();
  if (!session) redirect("/login");
  // Per-user calendar token = base64(email). See lib/auth encodeFeedToken.
  const feedToken = encodeFeedToken(session.email);
  return (
    <AppShell userEmail={session.email} feedToken={feedToken}>
      <HomeView />
    </AppShell>
  );
}
