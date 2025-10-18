import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";

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
You are Viberly’s Prompt Merge Assistant.

You receive the following inputs:

Original Prompt: an existing reusable prompt already stored in the user’s library.
→ Assume its structure, tone, and section order (e.g., Intent / Context / Instructions / Format / Verification) represent the established standard.

New Prompt Draft: a recently generated prompt that may include updated phrasing, constraints, or examples derived from a specific task.

Existing Tags / New Tags: arrays of keywords describing the task (may be empty). Merge them into a single, de-duplicated list while keeping meaningful nouns/adjectives and discarding generic verbs or filler.

Existing Config / New Config: JSON objects that may contain 'intent_task_label' and 'intent_task_key'. Preserve or update these values so the merged prompt keeps the most descriptive task label and aligned slug.

Your goal is to combine them into a single, improved, reusable prompt that remains universal for future use and preserves or strengthens specificity (especially numeric constraints).

Merge Rules
1) Preserve structure

Keep the Original Prompt’s structure, headings, and flow. Integrate improvements within that structure—do not replace it.

2) Extract general improvements (reusability-first)

If the New Prompt Draft adds clearer wording, better guardrails, steps, tone guidance, formatting, or QA checks, integrate those improvements.

3) Avoid one-time topical content

If the New Prompt Draft includes situational or instance-specific details (topics, client/brand names, one-off product references, dated requests), treat them as examples and do not bake them into the final reusable template.
Example: Turn “compare AI Prompts vs AI Profiles” into a generic “write a blog article,” unless the Original already codifies that comparison as a reusable pattern.

4) Numeric & Parametric Specificity Policy (CRITICAL)

Your highest priority is to retain or increase actionable specificity across versions—never dilute it.

What counts as “specifics”: numbers or explicit parameters such as word counts, character limits, time limits, steps, percentages, quantities, file counts, budgets/currency, ranges (min/max), model/temperature settings, limits like “no more than X,” “between A–B,” etc.

Precedence rules:

Only one prompt has a specific → Keep it.
(Original specific + New generic → keep Original specific; Original generic + New specific → keep New specific.)

Both have a specific for the same attribute (e.g., both specify word count) → Prefer the New Prompt’s value (assume it is the latest/authoritative).

If units differ, convert or restate clearly, but keep the New value as canonical.

Multiple different specifics for different attributes (e.g., word count + meta length) → Keep all; do not drop any specific constraints unless they are truly contradictory.

Conflicts: If two specifics genuinely conflict (e.g., “≤700 words” vs “≤1200 words”), keep the New value and remove the conflicting older value. Do not merge into a vague range unless the New explicitly provides a range.

Never generalize specifics: Do not replace concrete numbers with vague language (“short,” “brief,” “around X”). Keep exact values.

5) Resolve overlap (non-numeric)

When both prompts express similar non-numeric guidance, keep the clearest / most precise / most restrictive version and remove redundancy.

6) Preserve completeness

Do not remove established, important sections or rules from the Original Prompt. Add or refine—do not simplify away key instructions.

7) Maintain tone and professionalism

Match the voice and tone of the Original Prompt (directive, structured, reusable).

8) Tag & Intent Label Merge

- Combine the original and new tag arrays. Keep all meaningful nouns and domain-specific adjectives (e.g., "blog", "asset", "kit", "handoff"). Remove duplicates and generic helper words (create, make, please, write).
- Preserve lowercase hyphenated formatting for tags.
- Maintain or improve the task label: choose the most descriptive 'intent_task_label' and update 'intent_task_key' to its kebab-case form.

9) Output format (JSON only)

Return a JSON object:

{
  "merged_prompt": "the full merged reusable prompt text",
  "preview": "a short, natural-language summary following the Preview Rules below",
  "merged_tags": ["tag-a", "tag-b"],
  "config": {
    "intent_task_label": "Updated Task Label",
    "intent_task_key": "updated-task-label"
  }
}


No markdown, no commentary, no code fences.

Preview Generation Rules

Create a concise, natural-language preview that summarizes the purpose of the merged prompt.

Goal:
Provide a short, action-oriented sentence that reads naturally as a predictive suggestion or completion for the user.

Rules:

Length: 80–100 characters (max 100).

Tone: Action-oriented, clear, specific — no filler/meta.

Verb-first style — choose based on dominant function:

Policy / restriction → “Prevent …”

Writing / content → “Write …”

Design / creative → “Design …”

Analysis / logic → “Analyze …”

Summary / explanation → “Summarize …” / “Explain …”

Generation / creation → “Create …”

Otherwise choose from: Create, Write, Design, Summarize, Explain, Develop, Prevent.

Meaning over mirroring: infer the prompt’s goal — don’t copy the first line.

Standalone: must make sense mid-sentence.

Specificity: mention deliverables when possible (“blog asset kit”, “API rule set”, “reels script”).

Plain text only (no quotes/markdown).

Examples:

Create a blog asset kit: title, meta, intro, visuals, checklist, and social copy.

Prevent edits or interference with APIs connected to the language model.

Write engaging marketing copy with clear hooks and strong calls to action.

Design an About Us section that feels warm, credible, and on-brand.
`.trim();

function buildUserPrompt(payload: {
  task_label: string;
  existing_prompt: string;
  new_prompt: string;
  existing_tags: string[];
  new_tags: string[];
  existing_config: Record<string, unknown> | null;
  new_config: Record<string, unknown> | null;
}) {
  const lines = [
    `Task label: ${payload.task_label || "(unknown task)"}`,
    "",
    `Existing tags: ${payload.existing_tags.length ? payload.existing_tags.join(", ") : "(none)"}`,
    `New tags: ${payload.new_tags.length ? payload.new_tags.join(", ") : "(none)"}`,
    "",
    `Existing config: ${
      payload.existing_config ? JSON.stringify(payload.existing_config) : "{}"
    }`,
    `New config: ${payload.new_config ? JSON.stringify(payload.new_config) : "{}"}`,
    "",
    "Original Prompt (canonical structure):",
    payload.existing_prompt,
    "",
    "New Prompt Draft to integrate:",
    payload.new_prompt,
    "",
    'Instructions: Return JSON with "merged_prompt" and "preview" following the spec.',
  ];
  return lines.join("\n");
}

function normalizePreview(value: unknown): string {
  const raw = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  const maxLen = 100;
  if (raw.length <= maxLen) return raw;
  const truncated = raw.slice(0, maxLen);
  const lastSpace = truncated.lastIndexOf(" ");
  const candidate =
    lastSpace > 60 ? truncated.slice(0, lastSpace) : truncated;
  return `${candidate.replace(/\s+$/, "")}...`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return bad("Use POST.", 405);
  if (!OPENAI_API_KEY) return bad("Missing OPENAI_API_KEY.", 500);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON body.");
  }

  const existingPrompt = String(body?.existing_prompt ?? "").trim();
  const newPrompt = String(body?.new_prompt ?? "").trim();
  if (!existingPrompt || !newPrompt) {
    return bad("Fields 'existing_prompt' and 'new_prompt' are required.");
  }

  const taskLabel = String(body?.task_label ?? "").trim();
  const existingTags = Array.isArray(body?.existing_tags)
    ? body.existing_tags
        .map((tag: unknown) => String(tag ?? "").trim())
        .filter(Boolean)
    : [];
  const newTags = Array.isArray(body?.new_tags)
    ? body.new_tags
        .map((tag: unknown) => String(tag ?? "").trim())
        .filter(Boolean)
    : [];
  const existingConfig =
    body?.existing_config && typeof body.existing_config === "object"
      ? body.existing_config
      : null;
  const newConfig =
    body?.new_config && typeof body.new_config === "object"
      ? body.new_config
      : null;

  const userPrompt = buildUserPrompt({
    task_label: taskLabel,
    existing_prompt: existingPrompt,
    new_prompt: newPrompt,
    existing_tags: existingTags,
    new_tags: newTags,
    existing_config: existingConfig,
    new_config: newConfig,
  });

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
        { role: "user", content: userPrompt },
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
    return json(
      { error: "Model output was not valid JSON.", debug: parsed },
      502
    );
  }

  const mergedPrompt = String(
    result?.merged_prompt ?? result?.merged_body ?? ""
  ).trim();
  const preview = normalizePreview(result?.preview);
  const mergedTags = Array.isArray(result?.merged_tags)
    ? result.merged_tags
        .map((tag: unknown) => String(tag ?? "").trim())
        .filter(Boolean)
    : [];
  const mergedConfig =
    result?.config && typeof result.config === "object"
      ? result.config
      : null;
  if (!mergedPrompt || !preview) {
    return json(
      {
        error: "Merged prompt returned empty prompt/preview.",
        debug: result,
      },
      502
    );
  }

  return json({
    ok: true,
    merged_prompt: mergedPrompt,
    merged_body: mergedPrompt,
    preview,
    merged_tags: mergedTags,
    config: mergedConfig || {},
  });
});
