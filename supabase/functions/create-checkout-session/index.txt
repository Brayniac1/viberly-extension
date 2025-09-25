// supabase/functions/create-checkout-session/index.ts
// Create a Stripe Checkout session for the signed-in user.
// Deno Edge Function

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import Stripe from "https://esm.sh/stripe@14.23.0?target=deno";

// ---- ENV ----
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const stripe = new Stripe(STRIPE_SECRET_KEY, {
  httpClient: Stripe.createFetchHttpClient(),
  apiVersion: "2024-06-20",
});

// optional fallbacks if you don’t pass a price id from the client
const PRICE_BASIC = Deno.env.get("STRIPE_PRICE_BASIC") ?? "";
const PRICE_PRO   = Deno.env.get("STRIPE_PRICE_PRO") ?? "";

// ---- CORS helpers (for extension calls) ----
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Body = {
  price_id?: string;                      // pass a Stripe price id
  tier?: "basic" | "pro";                 // or pass a simple tier
  mode?: "subscription" | "payment";      // default: subscription
  success_url?: string;
  cancel_url?: string;
};

Deno.serve(async (req) => {
  // Preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: corsHeaders });
    }

    // ---- 1) Verify the caller is signed in (bearer from popup/extension) ----
    const authHeader = req.headers.get("authorization") || "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return new Response("Missing bearer token", { status: 401, headers: corsHeaders });
    }

    // user-scoped client (uses caller's JWT)
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();

    if (userErr || !user) {
      return new Response("Unauthorized", { status: 401, headers: corsHeaders });
    }

    // ---- 2) Parse body & resolve price ----
    const body = (await req.json().catch(() => ({}))) as Body;

    const priceFromTier =
      body.tier === "pro"  ? PRICE_PRO   :
      body.tier === "basic"? PRICE_BASIC : "";

    const price_id = body.price_id || priceFromTier || PRICE_BASIC;
    if (!price_id) {
      return new Response("Missing price_id", { status: 400, headers: corsHeaders });
    }

    const mode = body.mode ?? "subscription";
    const success_url = body.success_url ?? "https://vibeguardian.app/checkout/success";
    const cancel_url  = body.cancel_url  ?? "https://vibeguardian.app/checkout/cancel";

    // ---- 3) Lookup or create a Stripe customer for this user ----
    // first, check profile for an existing stripe_customer_id
    const { data: profile, error: profErr } = await supabase
      .from("vg_profiles")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .single();

    let customerId = profile?.stripe_customer_id ?? null;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;

      // Use service-role to update profile (bypass RLS cleanly)
      const srv = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } },
      });

      await srv
        .from("vg_profiles")
        .update({ stripe_customer_id: customerId })
        .eq("user_id", user.id);
    }

    // ---- 4) Create Checkout Session ----
    const session = await stripe.checkout.sessions.create({
      mode,
      customer: customerId!,
      line_items: [{ price: price_id, quantity: 1 }],
      success_url,
      cancel_url,
      allow_promotion_codes: true,
      subscription_data: {
        metadata: { supabase_user_id: user.id },
      },
      metadata: { supabase_user_id: user.id },
    });

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: { "content-type": "application/json", ...corsHeaders },
    });
  } catch (e) {
    console.error("[create-checkout-session]", e);
    return new Response("Server error", { status: 500, headers: corsHeaders });
  }
});
