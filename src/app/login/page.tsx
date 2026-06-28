import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Maps the ?error reason set by the OAuth callback to a human message.
const ERRORS: Record<string, string> = {
  not_allowed: "This account's access has been disabled. Contact the owner.",
  google_denied: "Sign-in was cancelled.",
  bad_state: "Your sign-in session expired. Please try again.",
  missing_code: "Sign-in didn't complete. Please try again.",
  exchange_failed: "Couldn't verify your Google account. Please try again.",
  lookup_failed: "Couldn't check the guest list right now. Please try again.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await isAuthenticated()) redirect("/");

  const { error } = await searchParams;
  const message = error ? (ERRORS[error] ?? "Sign-in failed. Please try again.") : "";

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-5 rounded-xl border border-black/10 dark:border-white/15 p-6 shadow-sm">
        <div>
          <h1 className="text-xl font-semibold">Date Spot Planner</h1>
          <p className="text-sm opacity-70">Sign in with Google to continue.</p>
        </div>

        {message && <p className="text-sm text-red-600">{message}</p>}

        <a
          href="/api/auth/google/start"
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-black/15 dark:border-white/20 px-3 py-2 font-medium hover:bg-black/5 dark:hover:bg-white/10"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path
              fill="#4285F4"
              d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
            />
            <path
              fill="#34A853"
              d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
            />
            <path
              fill="#FBBC05"
              d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"
            />
            <path
              fill="#EA4335"
              d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 9 0 9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
            />
          </svg>
          Sign in with Google
        </a>
      </div>
    </main>
  );
}
