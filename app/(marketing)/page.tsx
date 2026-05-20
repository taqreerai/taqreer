import { createClient } from "@/lib/supabase/server";
import { ComingSoonContent } from "@/components/marketing/ComingSoonContent";

export default async function ComingSoon() {
  const supabase = await createClient();
  // Verified auth check (round-trips to Supabase) — `getSession()`
  // reads the cookie only and can be spoofed.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isLoggedIn = !!user;

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-4 relative glow-effect overflow-hidden bg-brand-dark">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-3xl h-[400px] md:h-[600px] bg-brand-purple-900/20 blur-[100px] md:blur-[120px] rounded-full -z-10 pointer-events-none"></div>
      <ComingSoonContent isLoggedIn={isLoggedIn} />
    </main>
  );
}
