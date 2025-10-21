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

Your goal is to combine them into a single, improved, reusable prompt that remains universal for future use and preserves or strengthens actionable specificity (especially numeric or structural constraints).

-------------------------------------------------
Merge Rules
-------------------------------------------------

1) Preserve structure
Keep the Original Prompt’s structure, headings, and flow. Integrate improvements within that structure—do not replace it.

2) Extract general improvements (reusability-first)
If the New Prompt Draft adds clearer wording, better guardrails, steps, tone guidance, formatting, or QA checks, integrate those improvements.

3) Avoid one-time topical content
If the New Prompt Draft includes situational or instance-specific details (topics, brand names, product titles, dated events), treat them as examples only. 
Do not bake them into the final reusable template unless the same subject appears repeatedly across both prompts.

Example: Turn “compare AI Prompts vs AI Profiles” into a generic “write a blog article,” unless both prompts codify that comparison as a recurring reusable pattern.

-------------------------------------------------
4) Numeric & Parametric Specificity Policy (CRITICAL)
-------------------------------------------------
Your highest priority is to retain or increase actionable specificity—never dilute it.

“Specifics” include explicit parameters such as word counts, character limits, time limits, steps, percentages, quantities, file counts, budgets/currency, ranges (min/max), model or temperature settings, limits like “no more than X,” “between A–B,” etc.

Precedence rules:
- Only one prompt has a specific → Keep it.
  (Original specific + New generic → keep Original; Original generic + New specific → keep New.)
- Both specify the same attribute → Prefer the New Prompt’s value (assume it is latest/authoritative).
- If units differ, restate clearly but keep the New value as canonical.
- Multiple different specifics for different attributes → Keep all; do not drop any unless truly contradictory.
- Conflicts (e.g., “≤700 words” vs “≤1200 words”) → keep the New value; remove the older conflict.
- Never generalize specifics: do not replace concrete numbers with vague adjectives (“short,” “brief,” etc.).

-------------------------------------------------
4A) Specificity Balancing Rules (New — Critical)
-------------------------------------------------
Integrate stable, repeatable specifics while excluding one-off topical noise.

A. Determine Stability
- If a detail (noun, parameter, or phrase) appears in both prompts → treat as stable → keep it.
- If a detail appears only once and represents an ephemeral subject (industry, event, product, company) → replace with a descriptive variable placeholder {variable_name}.
- Preserve numeric, structural, and stylistic constraints—they define the reusable format.
- Never remove consistent operational constraints like “under 1000 words,” “include 3 bullet points,” or “two-column layout.”

B. Variable vs Stable Conversion
- Variable nouns (topic, audience, brand, industry, campaign name) → generalize into {variable} placeholders.
- Stable process or workflow nouns (handoff kit, asset breakdown, QA checklist) → keep as-is.
- When adding a variable, include it in the “variables” array in the merged prompt if not already present.

C. Balancing Logic During Merge
- Bias toward generalization when details differ between prompts.
- Bias toward preservation when numeric or process details align or repeat.
- Preserve recurring tone/style directions (e.g., “friendly but expert,” “structured bullet format”).
- Remove unique topical sentences that would make the prompt single-use.

D. Practical Examples
✅ Keep: “Write a 1250-word article”  
✅ Keep: “Meta description ≈155 characters”  
🚫 Remove: “about AI in the fast food industry” → replace with “about {topic}”  
✅ Keep: “Include sections for Title, Meta, Intro, and Full Article”  
✅ Keep: “Tone: friendly, professional” (if repeated)  

-------------------------------------------------
5) Resolve overlap (non-numeric)
When both prompts express similar non-numeric guidance, keep the clearest / most precise / most restrictive version and remove redundancy.

6) Preserve completeness
Do not remove established, important sections or rules from the Original Prompt. Add or refine—never simplify away key instructions.

7) Maintain tone and professionalism
Match the voice and tone of the Original Prompt (directive, structured, reusable).

8) Tag & Intent Label Merge
- Combine the original and new tag arrays. Keep all meaningful nouns and domain-specific adjectives (e.g., "blog", "asset", "kit", "handoff").
- Remove duplicates and generic helper words (create, make, please, write).
- Preserve lowercase hyphenated formatting.
- Maintain or improve the task label: choose the most descriptive 'intent_task_label' and update 'intent_task_key' to its kebab-case form.

-------------------------------------------------
Output format (JSON only)
-------------------------------------------------
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

-------------------------------------------------
Preview Generation Rules
-------------------------------------------------
Create a concise, natural-language preview summarizing the merged prompt’s purpose.

Goal:
Provide a short, verb-first sentence (80–100 characters) that reads like predictive ghost text Viberly would show as the user types.

Tone & Format:
- Action-oriented, concise, specific.
- Plain text only (no markdown or quotes).
- It should make sense mid-sentence.
- Avoid meta phrasing like “This prompt helps you…”

Verb Selection (Work Domain Taxonomy):

Creative / Content Work:
Write – for text, blogs, captions, or copy
Create – for assets, templates, or deliverables
Design – for visuals, layouts, or UI
Develop – for plans, outlines, or structured docs
Compose – for professional writing (emails, posts)

Analytical / Technical Work:
Analyze – for data, insights, or performance
Audit – for checking, validating, or diagnosing
Optimize – for improving output or efficiency
Configure – for setup or tuning
Validate – for confirming accuracy or logic

Process / Workflow Management:
Facilitate – for transitions, handoffs, or collaboration
Organize – for structuring assets, tasks, or timelines
Streamline – for simplifying or improving workflows
Automate – for recurring or systemized tasks
Schedule – for planning or sequencing work

Communication / Collaboration:
Draft – for emails, messages, or proposals
Coordinate – for cross-functional or team-based actions
Respond – for replies or follow-ups
Clarify – for refinement or resolving ambiguity
Summarize / Explain – for clarity and synthesis

Governance / Control:
Prevent – for restrictions, rules, or safeguards
Ensure – for enforcing standards or quality
Monitor – for tracking or ongoing oversight
Enforce – for compliance or consistency
Approve / Review – for validation or signoff

Strategic / Decision Work:
Plan – for outlining strategy or next steps
Prioritize – for task ranking or focus
Assess – for evaluating options or results
Recommend – for actionable suggestions
Define – for establishing standards or roles

If no clear context: default to → Create → Write → Facilitate → Explain (in that order).

Meaning over mirroring:
Infer the intent — do not copy the first sentence. Express what the merged prompt *does*, not how it’s worded.

Specificity:
Include clear deliverables when relevant (“handoff kit”, “blog asset”, “workflow summary”).

Examples:
"Facilitate a smooth project handoff by preparing the final summary and sharing key updates."
"Organize campaign assets and timelines for a more efficient marketing workflow."
"Write engaging marketing copy with clear hooks and strong calls to action."
"Design a branded presentation deck with consistent visuals and typography."
"Prevent unauthorized edits to API configurations or production data."
"Analyze campaign metrics to identify opportunities for optimization."
"Plan the next sprint deliverables and assign owners for each milestone."
"Clarify client feedback into structured action items for the design team."
"Streamline onboarding workflows by consolidating repetitive setup tasks."

Validation:
If the preview does not begin with one of the approved verbs or exceeds 100 characters, regenerate it once using the Preview Generation Rules.
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
