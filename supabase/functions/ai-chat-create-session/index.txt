import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
};
const json = (b:any,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{"content-type":"application/json; charset=utf-8",...CORS}});
const bad  = (m:string,s=400)=>json({error:m},s);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok",{headers:CORS});
  if (req.method !== "POST")   return bad("Use POST.",405);
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return bad("Missing env.",500);

  const auth = req.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
  const supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: token ? { Authorization: `Bearer ${token}` } : {} }
  });

  let body:any; try { body = await req.json(); } catch { return bad("Invalid JSON."); }
  const site = (body?.site ?? "").toString() || null;
  const summary_text = (body?.summary_text ?? "").toString().trim();
  const title = (body?.title ?? (site ? `Chat – ${site}` : "Chat")).toString();

  if (!summary_text) return bad("Field 'summary_text' required.");

  // 1) Create session; user_id defaults via RLS (auth.uid())
  const { data: srow, error: e0 } = await supa
    .from("ai_chat_sessions")
    .insert({ site, title, last_summary: summary_text, last_summary_at: new Date().toISOString() })
    .select("id")
    .single();
  if (e0) return bad(e0.message, 500);

  // 2) Insert initial assistant message (the summary)
  const { error: e1 } = await supa
    .from("ai_chat_messages")
    .insert({ session_id: srow.id, role: "assistant", content: summary_text });
  if (e1) return bad(e1.message, 500);

  return json({ ok:true, session_id: srow.id });
});
