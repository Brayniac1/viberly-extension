// supabase/functions/stripe-webhook/index.ts
// Verifies Stripe signature and updates vg_profiles on checkout + subscription changes

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import Stripe from "https://esm.sh/stripe@14.23.0?target=deno";

// --- Env ---
const STRIPE_SECRET_KEY      = Deno.env.get("STRIPE_SECRET_KEY")!;
const STRIPE_WEBHOOK_SECRET  = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;

const SUPABASE_URL           = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY       = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Optional convenience: price -> tier map (falls back to metadata if you add it)
const PRICE_BASIC = Deno.env.get("STRIPE_PRICE_BASIC") ?? "price_1RyYJuCKsHaxtGkUiLlRAAd3";
const PRICE_PRO   = Deno.env.get("STRIPE_PRICE_PRO")   ?? "price_1RyYMaCKsHaxtGkUMaScJLZS";

// --- Clients ---
const stripe = new Stripe(STRIPE_SECRET_KEY, {
  httpClient: Stripe.createFetchHttpClient(),
  apiVersion: "2024-06-20",
});
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// --- helpers ---
function tierFromPrice(priceId?: string | null): "free" | "basic" | "pro" {
  if (!priceId) return "free";
  if (priceId === PRICE_BASIC) return "basic";
  if (priceId === PRICE_PRO)   return "pro";
  return "free";
}

async function setProfileFields(user_id: string, fields: Record<string, unknown>) {
  await admin.from("vg_profiles")
    .update(fields)
    .eq("user_id", user_id);
}

function subStatusToText(s: string | null | undefined): string {
  // Stripe statuses to your profile column (use as-is)
  return (s ?? "inactive");
}

Deno.serve(async (req) => {
  // 1) Verify signature
  let event: Stripe.Event;
  try {
    const raw = await req.text();
    const sig = req.headers.get("stripe-signature") ?? "";
    event = stripe.webhooks.constructEvent(raw, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("[webhook] signature verification failed:", err?.message || err);
    return new Response("Bad signature", { status: 400 });
  }

  try {
    // 2) Handle events that can change entitlement
    switch (event.type) {
      case "checkout.session.completed": {
        // metadata.supabase_user_id was set in your create-checkout-session function
        const session = event.data.object as Stripe.Checkout.Session;

        const userId = (session.metadata?.supabase_user_id || session.subscription_details?.metadata?.supabase_user_id) as string | undefined;
        // Fallback via expanded subscription if not present
        let priceId: string | null = null;
        let subId: string | null = null;

        // Prefer session.subscription (string) → retrieve to read items[0].price.id
        if (typeof session.subscription === "string") {
          const sub = await stripe.subscriptions.retrieve(session.subscription);
          subId = sub.id;
          priceId = (sub.items?.data?.[0]?.price?.id) ?? null;
        } else if (session.subscription && typeof session.subscription === "object") {
          const sub = session.subscription as Stripe.Subscription;
          subId = sub.id;
          priceId = (sub.items?.data?.[0]?.price?.id) ?? null;
        }

        const customerId = (session.customer as string) || null;
        const tier = tierFromPrice(priceId);

        if (userId) {
          await setProfileFields(userId, {
            stripe_customer_id: customerId,
            stripe_subscription_id: subId,
            stripe_price_id: priceId,
            tier, // 'basic' or 'pro'
            subscription_status: "active",
            current_period_end: subId
              ? new Date((await stripe.subscriptions.retrieve(subId)).current_period_end * 1000).toISOString()
              : null
          });
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const userId = (sub.metadata?.supabase_user_id as string | undefined) ?? null;

        const priceId = sub.items?.data?.[0]?.price?.id ?? null;
        const tier = tierFromPrice(priceId);
        const status = subStatusToText(sub.status);
        const cpe = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;

        if (userId) {
          await setProfileFields(userId, {
            stripe_subscription_id: sub.id,
            stripe_price_id: priceId,
            tier,                      // set to 'basic' or 'pro'
            subscription_status: status,
            current_period_end: cpe
          });
        }
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const userId = (sub.metadata?.supabase_user_id as string | undefined) ?? null;

        if (userId) {
          await setProfileFields(userId, {
            stripe_subscription_id: sub.id,
            subscription_status: "canceled",
            // DO NOT forcibly reset tier here if you want to leave benefits until period_end.
            // If you DO want immediate downgrade:
            // tier: 'free'
          });
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        // Optional: mark past_due to let UI warn the user.
        let userId: string | undefined = undefined;

        // Try get subscription to find user id
        if (typeof invoice.subscription === "string") {
          const sub = await stripe.subscriptions.retrieve(invoice.subscription);
          userId = sub.metadata?.supabase_user_id as string | undefined;
        }

        if (userId) {
          await setProfileFields(userId, { subscription_status: "past_due" });
        }
        break;
      }

      default:
        // ignore other events
        break;
    }

    return new Response("OK", { status: 200 });
  } catch (e) {
    console.error("[webhook] handler error:", e);
    return new Response("Server error", { status: 500 });
  }
});
