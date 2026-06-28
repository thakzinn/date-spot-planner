// /visit/:id
// The "confirm visit" check-in page linked from today's calendar events. Short,
// token-free URL: it gates on the signed-in session. Not logged in -> bounce to
// login and come back here. Logged in but unrelated to the spot -> kicked out.
// Creator/invitee -> map + current location + check-in.
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getPlaceById } from "@/lib/sheets";
import ConfirmVisit from "@/components/ConfirmVisit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-3 rounded-xl border border-black/10 dark:border-white/15 p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="text-sm opacity-70">{body}</p>
        <Link href="/" className="inline-block text-sm text-blue-600 underline">
          Go to your spots
        </Link>
      </div>
    </main>
  );
}

export default async function VisitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Require login; bounce back here afterwards.
  const session = await getSession();
  if (!session) {
    redirect(`/login?next=${encodeURIComponent(`/visit/${id}`)}`);
  }

  const place = await getPlaceById(id);
  if (!place) {
    return <Notice title="Spot not found" body="This spot may have been removed." />;
  }

  // Only the creator or an invitee may check in — everyone else is kicked out.
  const email = session.email.trim().toLowerCase();
  const authorized = place.created_by.trim().toLowerCase() === email || place.invitees.includes(email);
  if (!authorized) {
    return <Notice title="Not your spot" body="This date plan isn't shared with you." />;
  }

  return (
    <ConfirmVisit
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
