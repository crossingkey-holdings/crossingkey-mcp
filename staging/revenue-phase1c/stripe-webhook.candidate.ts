// PHASE 1D CANDIDATE ONLY. Not deployed. Review against current webhook before production release.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
import { verifyStripe, classifyStripeEvent } from "./stripe-event-policy.mjs";

async function sha256(value: string) {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405 });
  const raw = await req.text();
  const candidates = [
    { secret: Deno.env.get("STRIPE_WEBHOOK_SECRET"), livemode: true },
    { secret: Deno.env.get("STRIPE_TEST_WEBHOOK_SECRET"), livemode: false },
  ].filter((item): item is { secret: string; livemode: boolean } => Boolean(item.secret));
  if (!candidates.length) return new Response("webhook_not_configured", { status: 503 });
  const signature = req.headers.get("stripe-signature") ?? "";
  let matchedLiveMode: boolean | null = null;
  for (const candidate of candidates) {
    if (await verifyStripe(raw, signature, candidate.secret)) {
      matchedLiveMode = candidate.livemode;
      break;
    }
  }
  if (matchedLiveMode === null) {
    return new Response("invalid_signature", { status: 400 });
  }

  let event: any;
  try { event = JSON.parse(raw); } catch { return new Response("invalid_json", { status: 400 }); }
  if (Boolean(event.livemode) !== matchedLiveMode) return new Response("mode_mismatch", { status: 400 });
  const admission = classifyStripeEvent(event);
  if (!admission.accepted) {
    return Response.json({ received: true, ignored: true, reason: admission.reason });
  }
  const object = event.data.object;
  const paymentLink = object.payment_link ?? object.metadata?.payment_link_id ?? null;
  const checkoutSessionId = object.object === "checkout.session" ? object.id : null;
  const paymentIntentId = object.payment_intent ?? (object.object === "payment_intent" ? object.id : null);
  const customerEmail = object.customer_details?.email ?? object.receipt_email ?? object.charges?.data?.[0]?.billing_details?.email ?? null;
  const clientReferenceId = object.client_reference_id ?? object.metadata?.build_id ?? null;
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data, error } = await supabase.rpc("dock_fulfill_stripe_event", {
    p_event_id: event.id,
    p_event_type: event.type,
    p_livemode: Boolean(event.livemode),
    p_payment_link_id: paymentLink,
    p_checkout_session_id: checkoutSessionId,
    p_payment_intent_id: paymentIntentId,
    p_customer_email: customerEmail,
    p_amount_cents: object.amount_total ?? object.amount_received ?? object.amount ?? null,
    p_currency: object.currency ?? "usd",
    p_payload_hash: await sha256(raw),
    p_client_reference_id: clientReferenceId,
  });
  if (error) {
    console.error("fulfillment_failed", error.message);
    return new Response("fulfillment_failed", { status: 500 });
  }
  return Response.json({ received: true, result: data });
});
