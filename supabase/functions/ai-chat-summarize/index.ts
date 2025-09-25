import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const CORS = { "access-control-allow-origin":"*", "access-control-allow-methods":"POST, OPTIONS", "access-control-allow-headers":"authorization, content-type" };
const json = (b:any,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{"content-type":"application/json",...CORS}});
const bad  = (m:string,s=400)=>json({error:m},s);

const PROMPT = (site?:string)=>`
You are VibeGuardian. Summarize the last 10 messages in this conversation${site ? " for "+site : ""}.
Format:
Issue: <one sentence>
Evidence:
- <2–4 short bullets>
Suspects: <files/functions or "None mentioned">
Next step: <single best action>
`.trim();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok",{headers:CORS});
  if (req.method !== "POST") return bad("Use POST.",405);
  if (!OPENAI_API_KEY || !SUPABASE_URL || !SUPABASE_ANON_KEY) return bad("Missing env.",500);

  const auth = req.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
  const supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: token ? { Authorization: `Bearer ${token}` } : {} }
  });

  let body:any; try { body = await req.json(); } catch { return bad("Invalid JSON."); }
  const { session_id } = body || {};
  if (!session_id) return bad("Field 'session_id' required.");

  const { data: sess, error: e0 } = await supa.from("ai_chat_sessions").select("site").eq("id", session_id).single();
  if (e0) return bad(e0.message, 404);

  const { data: msgs, error } = await supa
    .from("ai_chat_messages")
    .select("role,content,created_at")
    .eq("session_id", session_id)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) return bad(error.message,500);

  const list = msgs?.slice().reverse() ?? [];
  const payload = {
    model: "gpt-4o-mini",
    temperature: 0.2,
    messages: [
      { role:"system", content: PROMPT(sess?.site || undefined) },
      { role:"user",   content: JSON.stringify(list) }
    ]
  };

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method:"POST", headers:{ "content-type":"application/json", authorization:`Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify(payload)
  });
  const raw = await resp.text(); let data:any={}; try{ data=JSON.parse(raw); }catch{}
  if (!resp.ok) return json({ error: data?.error?.message || `OpenAI ${resp.status}`, debug: raw }, 502);

  const summary = (data?.choices?.[0]?.message?.content || "").trim();
  if (!summary) return bad("Empty summary.", 502);

  await supa.from("ai_chat_sessions")
    .update({ last_summary: summary, last_summary_at: new Date().toISOString() })
    .eq("id", session_id);

  return json({ ok:true, summary });
});
