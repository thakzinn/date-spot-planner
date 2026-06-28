import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import PlansView from "@/components/PlansView";

export const dynamic = "force-dynamic";

export default async function PlansPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/plans");
  return <PlansView userEmail={session.email} userName={session.name} />;
}
