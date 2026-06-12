// /[lang]/checkout/return?session_id=cs_...
//
// Where Stripe's embedded checkout sends the user after they pay (still
// on taqreer.ai). The CREDIT GRANT lands via the webhook - this page is
// purely the post-payment UX: confirm the session completed, then point
// the user back to billing (credits appear via the live balance nudge).

import { ReturnClient } from "./ReturnClient";

export default async function CheckoutReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string; ctx?: string }>;
}) {
  const { session_id, ctx } = await searchParams;
  return (
    <ReturnClient
      sessionId={session_id ?? null}
      ctx={ctx === "tab" ? "tab" : null}
    />
  );
}
