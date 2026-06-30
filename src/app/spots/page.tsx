import { redirect } from "next/navigation";
import { getSession, encodeFeedToken } from "@/lib/auth";
import SpotsView from "@/components/SpotsView";

export const dynamic = "force-dynamic";

export default async function SpotsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  // Per-user calendar token = base64(email). See lib/auth encodeFeedToken.
  const feedToken = encodeFeedToken(session.email);
  return <SpotsView feedToken={feedToken} userEmail={session.email} />;
}
