import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import HomeView from "@/components/HomeView";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (!(await isAuthenticated())) redirect("/login");
  const feedToken = process.env.FEED_TOKEN ?? "";
  return <HomeView feedToken={feedToken} />;
}
