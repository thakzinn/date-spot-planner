// /visit/:id?token=<feedToken>
// The "confirm visit" check-in page linked from today's calendar events. It
// authorizes with the per-user feed token (no login needed), loads the spot,
// then hands off to a client component that compares the device's current
// location to the pinned spot before confirming.
import { decodeFeedToken } from "@/lib/auth";
import { getPlaceById, isActiveUser } from "@/lib/sheets";
import ConfirmVisit from "@/components/ConfirmVisit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-2 rounded-xl border border-black/10 dark:border-white/15 p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="text-sm opacity-70">{body}</p>
      </div>
    </main>
  );
}

export default async function VisitPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { id } = await params;
  const { token = "" } = await searchParams;
  const email = decodeFeedToken(token);

  if (!email || !(await isActiveUser(email))) {
    return <Notice title="Link not valid" body="This confirm-visit link is missing or expired." />;
  }

  const place = await getPlaceById(id);
  if (!place) {
    return <Notice title="Spot not found" body="This spot may have been removed." />;
  }

  const authorized =
    place.created_by.trim().toLowerCase() === email || place.invitees.includes(email);
  if (!authorized) {
    return <Notice title="No access" body="This spot isn't on your plan." />;
  }

  return (
    <ConfirmVisit
      token={token}
      place={{
        id: place.id,
        place_name: place.place_name,
        lat: place.lat,
        lng: place.lng,
        maps_url: place.maps_url,
        planned_date: place.planned_date,
        status: place.status,
      }}
    />
  );
}
