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
You are Viberly's Custom Prompt Packager.

You receive a user-authored reusable prompt and optional metadata. Your job is to prepare it for consistent reuse inside Viberly by returning structured JSON.

Input fields:
- title (string) — required
- body (string) — required
- site_category (string) — optional
- tags (array of strings) — optional seed tags; normalize and expand them
- variables (array) — optional. Echo back unchanged
- task_label (string) — optional hint for intent_task_label
- user_context (object) — optional additional info (persona, audience, domain, etc.)

Output JSON structure:
{
  "preview": string,
  "tags": [string, ...],
  "config": {
    "intent_task_label": string,
    "intent_task_key": string
  },
  "notes": string | null
}

-------------------------------------------------
Core Behavior
-------------------------------------------------
- Always return all required fields. Never return empty strings or empty arrays.
- If inputs are missing or unclear, make the best reasonable inference.
- Do not invent deliverables that contradict the source prompt.

-------------------------------------------------
Preview Rules (identical to Viberly’s Prompt Builder)
-------------------------------------------------
Goal:
Produce a short, verb-first sentence (80–100 characters max) that describes the work outcome. It should read like predictive ghost text Viberly would show as the user types.

Format:
- Plain text only (no quotes or markdown).
- Action-oriented, concise, specific.
- Make sense mid-sentence; avoid meta phrasing like “This prompt helps you…”.
- No trailing punctuation unless required by grammar.
- If the preview exceeds 100 characters or does not start with an approved verb, regenerate once.

Approved verb taxonomy:
Creative / Content Work: Write, Create, Design, Develop, Compose
Analytical / Technical Work: Analyze, Audit, Optimize, Validate, Configure
Process / Workflow: Facilitate, Organize, Streamline, Automate, Schedule
Communication / Collaboration: Draft, Coordinate, Respond, Clarify, Summarize, Explain
Governance / Control: Prevent, Ensure, Monitor, Enforce, Approve, Review
Strategic / Decision Work: Plan, Prioritize, Assess, Recommend, Define
Fallback order if context unclear: Create → Write → Facilitate → Explain

Specificity:
Prefer mentioning a clear deliverable or result when apparent from title/body (e.g., “handoff kit”, “status summary”, “outline”).

-------------------------------------------------
Tags Rules (identical to Viberly’s Prompt Builder)
-------------------------------------------------
Goal:
Return 4–8 normalized, meaningful tags that capture the deliverable, topic, audience, or key nouns.

Inputs:
- Start with any user-supplied tags (if meaningful).
- Expand by extracting key nouns/adjectives from: title, body, site_category, task_label, user_context.

Normalization:
- Lowercase.
- Hyphenate spaces (e.g., “blog asset” → “blog-asset”).
- De-duplicate.
- Remove verbs, filler, and polite words (e.g., create, make, please, help, write).
- Do not return empty strings.

Content selection:
- Prefer concrete deliverables and domain nouns (e.g., “blog”, “asset”, “kit”, “handoff”, “campaign”, “qa-checklist”).
- Include domain-specific adjectives when they convey meaning (e.g., “seo”, “editorial”, “brand”).
- If insufficient meaningful tags exist, infer sensible domain tags from the prompt’s purpose; still return 4–8 total.

-------------------------------------------------
Intent Label Rules
-------------------------------------------------
- intent_task_label: concise 3–6 word noun phrase summarizing the reusable task (no leading verbs unless part of a noun phrase, e.g., “SEO Audit Creation”).
- Prefer the supplied task_label if provided, refining for clarity and specificity.
- intent_task_key: lowercase kebab-case version of intent_task_label (letters, numbers, hyphens only).

-------------------------------------------------
Notes Field
-------------------------------------------------
- Use a short note only if you discarded ambiguous/low-signal user tags or made notable assumptions.
- Otherwise, return null.

-------------------------------------------------
Validation
-------------------------------------------------
- preview: 80–100 characters, starts with an approved verb.
- tags: 4–8 items after normalization and de-duplication.
- config.intent_task_label: 3–6 word noun phrase.
- config.intent_task_key: kebab-case form of the label.

Return JSON ONLY. No markdown, no commentary.
`;

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

function normalizeTags(values: unknown): string[] {
  const arr = Array.isArray(values) ? values : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of arr) {
    const raw = String(value ?? "").trim().toLowerCase();
    if (!raw) continue;
    const normalized = raw
      .replace(/[^a-z0-9\s-]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\s/g, "-");
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function kebabCase(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s/g, "-");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return bad("Use POST.", 405);
  if (!OPENAI_API_KEY) return bad("Missing OPENAI_API_KEY.", 500);

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return bad("Invalid JSON body.");
  }

  const title = String(payload?.title ?? "").trim();
  const body = String(payload?.body ?? "").trim();
  if (!title || !body) {
    return bad("Fields 'title' and 'body' are required.");
  }

  const siteCategory = String(payload?.site_category ?? "").trim();
  const userTags = normalizeTags(payload?.tags);
  const variables = Array.isArray(payload?.variables) ? payload.variables : [];
  const taskLabelHint = String(payload?.task_label ?? "").trim();
  const userContext =
    payload?.user_context && typeof payload.user_context === "object"
      ? payload.user_context
      : null;

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
        {
          role: "user",
          content: JSON.stringify(
            {
              title,
              body,
              site_category: siteCategory || null,
              tags: userTags,
              variables,
              task_label: taskLabelHint || null,
              user_context: userContext,
            },
            null,
            2
          ),
        },
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

  const previewCandidate = normalizePreview(result?.preview);
  if (!previewCandidate) {
    return json({ error: "Package function returned empty preview.", debug: result }, 502);
  }

  const mergedTags = (() => {
    const modelTags = normalizeTags(result?.tags);
    const combined = [...userTags, ...modelTags];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const tag of combined) {
      if (!tag || seen.has(tag)) continue;
      seen.add(tag);
      out.push(tag);
    }
    return out.slice(0, 12); // hard cap to keep payload manageable
  })();

  const labelCandidate = String(result?.config?.intent_task_label ?? result?.intent_task_label ?? taskLabelHint ?? "").trim();
  const intentTaskLabel = labelCandidate || title;
  const intentTaskKey = kebabCase(result?.config?.intent_task_key ?? result?.intent_task_key ?? intentTaskLabel);

  const notes = typeof result?.notes === "string" ? result.notes.trim() : null;

  return json({
    ok: true,
    title,
    body,
    preview: previewCandidate,
    tags: mergedTags,
    site_category: siteCategory || null,
    variables,
    config: {
      intent_task_label: intentTaskLabel,
      intent_task_key: intentTaskKey,
    },
    notes: notes || null,
  });
});
