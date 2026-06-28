// Connectivity probe: reads row 1 of the `places` tab and returns it.
// Use this to confirm the service account + Sheet share are wired up BEFORE
// building anything else. GET /api/health
import { NextResponse } from "next/server";
import { getHeaderRow } from "@/lib/sheets";

// crypto/Sheets need the Node.js runtime, not Edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXPECTED_HEADER = [
  "id",
  "place_name",
  "lat",
  "lng",
  "maps_url",
  "planned_date",
  "status",
  "visited_at",
  "category",
  "notes",
  "created_at",
  "updated_at",
  "created_by",
  "updated_by",
  "invitees",
];

export async function GET() {
  try {
    const header = await getHeaderRow();
    const headerOk =
      header.length >= EXPECTED_HEADER.length &&
      EXPECTED_HEADER.every((h, i) => header[i] === h);

    return NextResponse.json(
      {
        ok: true,
        headerOk,
        header,
        ...(headerOk
          ? {}
          : {
              hint:
                "Connected to the sheet, but the header row does not match the " +
                "expected columns. Paste the exact header row from SETUP.md into row 1.",
              expected: EXPECTED_HEADER,
            }),
      },
      { status: 200 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        ok: false,
        error: message,
        hint:
          "Check GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY (single-line with " +
          '\\n escapes), GOOGLE_SHEET_ID, that the sheet is shared with the service ' +
          'account as Editor, and that a tab named "places" exists.',
      },
      { status: 500 },
    );
  }
}
