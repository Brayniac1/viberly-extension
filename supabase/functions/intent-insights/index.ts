import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
};

function json(body: unknown, init: number | ResponseInit = 200) {
  const base = typeof init === "number" ? { status: init } : init;
  return new Response(JSON.stringify(body), {
    ...base,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...CORS,
      ...(base?.headers ?? {}),
    },
  });
}

function bad(message: string, status = 400) {
  return json({ error: message }, status);
}

const SYSTEM_PROMPT = `
You are Viberly's Intent Analyst. You receive a recent batch of the user's intent messages, the sites involved, and optionally their previous intent profile snapshot.ok, 

Your job is to summarize how the user works, highlight repeated tasks, and return the data as JSON.

Return **only** a valid JSON object with this structure:

{
  "profile": {
    "persona": string,            // describe the user in SECOND PERSON ("You ...")
    "confidence": number,         // 0-1 confidence
    "domains": [{ "label": string, "score": number }],
    "per_site_intents": [{
      "host": string,
      "summary": string,         // SECOND PERSON summary of what the user does on this site
      "tasks": [{ "label": string, "count": number, "examples": [string] }]
    }],
    "workflows": [{
      "label": string,
      "sequence": [string],
      "description": string      // SECOND PERSON description of how you move across tools
    }],
    "notes": string              // SECOND PERSON observations or recommendations
  },
  "intent_repetition": [{
    "task_label": string,
    "count_in_window": number,
    "total_recent_count": number,
    "threshold_met": boolean
  }],
  "telemetry": {
    "model": string,
    "warnings": [string]
  }
}

Guidelines:
- Speak directly to the user (second person) in every profile field (persona, site summaries, workflows, notes).
- Base all claims on the supplied messages; treat previous_profile as context to refine rather than overwrite evidence.
- Highlight repeated tasks in intent_repetition with accurate counts and representative examples. Do not attempt to draft custom prompts—another system will handle that.
- Output JSON **only** (no Markdown, no comments).
`.trim();

interface IntentMessage {
  intent_message_id: string;
  captured_at: string;
  source_url: string | null;
  raw_text: string;
  intent_segments: Array<{ text: string }>;
  token_count: number | null;
  is_rich_text: boolean | null;
}

interface WindowPayload {
  window: {
    window_id: string | null;
    user_id: string;
    source_hosts: string[] | null;
    started_at: string;
    ended_at: string;
    message_ids: string[];
  };
  messages: IntentMessage[];
  profile_snapshot?: any;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }
  if (req.method !== "POST") {
    return bad("Use POST.", 405);
  }
  if (!OPENAI_API_KEY || !SUPABASE_URL || !SERVICE_KEY) {
    return bad("Missing environment configuration.", 500);
  }

  let payload: WindowPayload;
  try {
    payload = await req.json();
  } catch {
    return bad("Invalid JSON body.");
  }

  const { window, messages } = payload || {};
  if (!window?.user_id || !Array.isArray(messages)) {
    return bad("Missing window or messages.");
  }

  const supa = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: currentProfile } = await supa
    .from("intent_profiles")
    .select("profile_version,profile,persona,confidence")
    .eq("user_id", window.user_id)
    .maybeSingle();

  const modelInput = {
    window,
    messages,
    previous_profile: payload.profile_snapshot ?? currentProfile?.profile ?? null,
  };

  const completion = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(modelInput, null, 2) },
      ],
    }),
  });

  const raw = await completion.text();
  let parsed: any = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json({ error: "Non-JSON response from OpenAI", debug: raw }, 502);
  }
  if (!completion.ok) {
    return json(
      {
        error: parsed?.error?.message || `OpenAI ${completion.status}`,
        debug: raw,
      },
      502
    );
  }

  let result: any = {};
  try {
    result = JSON.parse(parsed?.choices?.[0]?.message?.content ?? "{}");
  } catch {
    return json({ error: "Model output was not valid JSON.", debug: parsed }, 502);
  }

  const profile = result?.profile;
  if (!profile) {
    return json({ error: "Profile section missing in model output.", debug: result }, 502);
  }

  const nowIso = new Date().toISOString();
  let nextVersion = 1;

  if (currentProfile) {
    await supa.from("intent_profile_history").insert({
      user_id: window.user_id,
      profile_version: currentProfile.profile_version ?? 0,
      profile: currentProfile.profile ?? {},
      persona: currentProfile.persona ?? null,
      confidence: currentProfile.confidence ?? null,
    });

    const { data: oldHistory } = await supa
      .from("intent_profile_history")
      .select("history_id")
      .eq("user_id", window.user_id)
      .order("created_at", { ascending: false })
      .range(2, 49);

    if (Array.isArray(oldHistory) && oldHistory.length) {
      await supa
        .from("intent_profile_history")
        .delete()
        .in(
          "history_id",
          oldHistory.map((row: any) => row.history_id)
        );
    }

    nextVersion = (currentProfile.profile_version ?? 0) + 1;
  }

  await supa.from("intent_profiles").upsert({
    user_id: window.user_id,
    profile_version: nextVersion,
    profile,
    persona: profile?.persona ?? null,
    confidence:
      typeof profile?.confidence === "number" ? profile.confidence : null,
    updated_at: nowIso,
  });

  return json({
    ok: true,
    profile_version: nextVersion,
    profile,
    intent_repetition: result?.intent_repetition ?? [],
    telemetry: result?.telemetry ?? {},
  });
});
