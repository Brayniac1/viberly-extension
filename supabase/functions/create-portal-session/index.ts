// supabase/functions/create-portal-session/index.ts
// Creates a Stripe Billing Portal session for the signed‑in user.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import Stripe from "https://esm.sh/stripe@14.23.0?target=deno";

/* Env */
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  httpClient: Stripe.createFetchHttpClient(),
  apiVersion: "2024-06-20",
});

/* Simple CORS */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Body = {
  return_url?: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization") || "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return new Response("Missing bearer token", { status: 401, headers: corsHeaders });
    }

    // Act as the user
    const supabaseAsUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: userErr } = await supabaseAsUser.auth.getUser();
    if (userErr || !user) {
      return new Response("Unauthorized", { status: 401, headers: corsHeaders });
    }

    const body = (await req.json().catch(() => ({}))) as Body;
    const return_url = body.return_url ?? "https://vibeguardian.app/account";

    // Read / update profile with a service client (bypass RLS)
    const srv = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: profile } = await srv
      .from("vg_profiles")
      .select("stripe_customer_id, user_id, email")
      .eq("user_id", user.id)
      .single();

    let customerId = profile?.stripe_customer_id ?? null;

    // If for some reason we never created a customer (e.g. user hasn’t checked out yet),
    // create one now so they can still reach the portal.
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;

      await srv.from("vg_profiles")
        .update({ stripe_customer_id: customerId })
        .eq("user_id", user.id);
    }

    // Create portal session
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: { "content-type": "application/json", ...corsHeaders },
    });
  } catch (e) {
    console.error("[portal] error", e);
    return new Response("Server error", { status: 500, headers: corsHeaders });
  }
});
