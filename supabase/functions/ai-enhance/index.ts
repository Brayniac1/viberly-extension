// supabase/functions/ai-enhance/index.ts
// Enhances a custom guard prompt via OpenAI and returns the refined text.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
// --- Env
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
// --- Simple helpers
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type"
};
function json(body, init = 200) {
  const base = typeof init === "number" ? {
    status: init
  } : init;
  return new Response(JSON.stringify(body), {
    ...base,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...CORS,
      ...base?.headers ?? {}
    }
  });
}
function bad(msg, code = 400) {
  return json({
    error: msg
  }, code);
}
// Optional: verify the Supabase session token
async function getUserFromBearer(req) {
  try {
    const auth = req.headers.get("authorization") || "";
    const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
    if (!token || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
    const supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    });
    const { data, error } = await supa.auth.getUser();
    if (error || !data?.user) return null;
    return data.user;
  } catch  {
    return null;
  }
}
// --- System prompt crafted for VibeGuardian guard-writing
const SYSTEM_PROMPT = `
You are the AI Enhance assistant for Viberly.
Your role is to take a user’s raw prompt and rewrite it into a clear, structured, and context-aware Enhanced Prompt designed to produce better results from large language models (LLMs).

Your goal is to preserve the user’s intent while improving clarity, tone, and effectiveness based on:

Context drawn from the user’s own messages (preferred), or

Current best practices in prompt engineering for that field or task.

Rules for Output (Critical)

Output only the rewritten enhanced prompt — no explanations, no commentary, no formatting artifacts (e.g., no backticks).

Keep language natural and narrative, with short paragraphs that read well to humans.

Use structured sections (headings, numbered lists, or short bullet points) when giving directions, rules, or examples.

Maintain a professional, precise, and actionable tone.

When appropriate, include explicit Do’s and Don’ts to guide the LLM.

Preserve the user’s factual details and voice — do not invent new content or product details.

If the prompt is already strong, focus on tightening structure, removing redundancy, and improving readability.

Recommended Structure (adapt per use case)

Intent / Objective — clearly restate what the user wants the model to accomplish.

Context — relevant background or conditions influencing the request.

Instructions / Do’s and Don’ts — explicit behavioral or stylistic rules the model must follow.

Format or Output Requirements — how the result should be delivered (style, structure, or data format).

Verification / Quality Check — brief guidance on what “good” output looks like.

Field-Specific Guidance

Coding / Technical Work:

Emphasize precision, guardrails, and validation steps.

Use explicit Do’s and Don’ts to prevent undesired or unsafe behavior.

Creative / Writing / Content Work:

Encourage flow, tone, and creativity — but still define clear boundaries and expected output format.

Analytical / Professional Tasks:

Highlight structure, reasoning clarity, and accuracy; keep tone formal and concise.

Final Rule

Always prioritize intent clarity and structured delivery over verbosity.
The best prompts read like well-organized instructions — human-readable first, LLM-optimized second.
`;
// --- Main handler
Deno.serve(async (req)=>{
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: CORS
    });
  }
  if (req.method !== "POST") {
    return bad("Use POST.", 405);
  }
  if (!OPENAI_API_KEY) {
    return bad("Missing OPENAI_API_KEY.", 500);
  }
  // Optional auth (we don't block if unauthenticated; we just skip personalization)
  const user = await getUserFromBearer(req);
  // Parse body
  let body;
  try {
    body = await req.json();
  } catch  {
    return bad("Invalid JSON.");
  }
  const raw = (body?.prompt ?? "").toString().trim();
  const guardName = (body?.name ?? "").toString().trim();
  const goal = (body?.goal ?? "").toString().trim();
  const tone = (body?.tone ?? "").toString().trim();
  if (!raw) {
    return bad("Field 'prompt' is required.");
  }
  // lightweight size guard (Edge runtime budget)
  if (raw.length > 8000) {
    return bad("Prompt too large (>8000 chars). Please shorten.");
  }
  // Compose user message with any hints
  const userMsg = [
    guardName ? `Guard Name: ${guardName}` : "",
    goal ? `Goal: ${goal}` : "",
    tone ? `Tone: ${tone}` : "",
    "",
    "User Prompt:",
    raw
  ].filter(Boolean).join("\n");
  // Call OpenAI (chat completions)
  const payload = {
    model: "gpt-4o-mini",
    temperature: 0.3,
    messages: [
      {
        role: "system",
        content: SYSTEM_PROMPT
      },
      {
        role: "user",
        content: userMsg
      }
    ]
  };
  let resp;
  try {
    resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${OPENAI_API_KEY}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    console.error("[ai-enhance] network error:", e);
    return bad("OpenAI request failed.", 502);
  }
  if (!resp.ok) {
    const txt = await resp.text().catch(()=>"");
    console.error("[ai-enhance] OpenAI error:", resp.status, txt);
    return bad(`OpenAI error: ${resp.status}`, 502);
  }
  const data = await resp.json();
  const choice = data?.choices?.[0]?.message?.content ?? "";
  const enhanced = (choice || "").trim();
  if (!enhanced) {
    return bad("No content returned.", 502);
  }
  // Return enhanced prompt
  return json({
    enhanced,
    model: data?.model ?? "gpt-4o-mini",
    usage: data?.usage ?? null,
    user_id: user?.id ?? null
  });
});
