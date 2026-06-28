import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import HomeView from "@/components/HomeView";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getSession();
  if (!session) redirect("/login");
  const feedToken = process.env.FEED_TOKEN ?? "";
  return <HomeView feedToken={feedToken} userEmail={session.email} />;
}
