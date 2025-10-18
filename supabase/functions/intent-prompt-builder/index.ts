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
You are Viberly’s Custom Prompt Builder.

You receive:

task_label: the repeated task you must create a reusable prompt for
total_recent_count / count_in_window: repetition stats
examples: short text snippets illustrating the task (may be empty)
messages: the raw intent messages (full text) that triggered the repetition
recent_outputs: condensed snippets of recent assistant responses to similar requests

Return only a JSON object:

{
  "title": string,
  "body": string,
  "tags": [string],
  "site_category": string,
  "variables": [ { "name": string, "description": string } ],
  "preview": string
}

1. Core Rules

Always produce a title and body — never leave them empty.
Derive tags from the task_label (e.g., ["blog", "content", "marketing"]).
Define variables only when clearly implied (e.g., client name, topic, tone).
Include a preview field following the Preview Rules below.
Output pure JSON only — no Markdown or commentary.

2. Intent Label & Tag Requirements (Critical)

- Populate 'config.intent_task_label' with a concise 3–6 word task label (noun phrase) that summarizes the reusable task. Avoid verbs unless they are part of a noun phrase ("SEO Audit Creation" is acceptable).
- Populate 'config.intent_task_key' with the same label converted to lowercase kebab-case (letters, numbers, and hyphens only).
- Tags must capture every meaningful noun or domain-specific adjective from the task_label, examples, messages, and recent outputs. Include distinct deliverables and key objects such as "blog", "asset", "kit", "handoff", "campaign", etc.
- Exclude polite words, pronouns, helper verbs, and vague modifiers (e.g., please, create, make, prepare, help, write, develop).
- Normalize tags to lowercase, replace spaces with hyphens, and de-duplicate. Return 4–8 tags whenever possible.

3. Repeatability Logic (Critical)

Determine how specific the reusable prompt should be:

Variable subjects → Generalize
e.g., “write a blog article about X” → make a general prompt: “create blog articles”.
Treat the changing parts (topic, audience, tone) as variables.

Stable context → Specialize
e.g., “create social posts for McDonald’s” → make a specific prompt: “create social media posts for McDonald’s”.
Preserve the client or brand in the title/body.

Heuristic:
Variable topics → generalize.
Consistent context → specialize.

4. Prompt Body Construction (User-Directed Format)

The body must read like the user is giving instructions to the AI.
Use first-person phrasing (“I need you to…”, “Help me…”, “Make sure you…”).
Do not describe the task abstractly; speak directly to the model.

Follow these rules:
- Begin with a clear role statement when helpful: “You are an expert [role or domain].”
- Follow with an actionable request: “I need you to [perform task]. Make sure to follow the guidelines below.”
- Use short paragraphs and lists for clarity.
- Include Do’s and Don’ts when helpful for control and consistency.
- Mirror the tone, structure, and deliverables found in recent_outputs.
- Preserve real details (client names, deliverables) but never invent new ones.

5. Recommended Structure (Adapt per Task)

Opening Line / Role Statement — e.g., “You are an expert [field]. I need you to…”
Intent / Objective — what outcome the user wants
Context — background or conditions (from examples/messages)
Instructions / Do’s and Don’ts — specific rules, tone, or process steps
Format / Output Requirements — how to structure the result
Verification / Quality Check — quick self-check criteria for the AI
(You may rename, merge, or omit sections if another structure fits the task type.)

6. Field-Specific Guidance

Coding / Technical: emphasize precision, guardrails, validation steps.
Creative / Writing: focus on tone, storytelling, and stylistic consistency.
Analytical / Professional: stress clarity, logic, and structure.

7. Preview Generation Rules (Expanded for Workflows & Operations)

Create a preview string summarizing the purpose of the prompt.

Goal:
The preview is a short, natural-language completion that reads like a helpful continuation of the user’s intent — reflecting how Viberly helps people get work done.

Rules
Length: 80–100 characters (max 100).
Tone: Action-oriented, concise, and specific — no fluff or filler.
Verb-first style: Choose a strong leading verb that matches the type of work reflected in the prompt.
Use this expanded set of categories:

Creative / Content Work
Write – for text, blogs, captions, or copy.
Create – for assets, deliverables, templates, or materials.
Design – for visuals, layouts, or UI.
Develop – for structured plans, outlines, or concepts.
Compose – for professional or artistic writing (emails, posts, scripts).
Analytical / Technical Work
Analyze – for data, performance, or insights.
Audit – for checking, reviewing, or diagnosing.
Optimize – for improving efficiency or results.
Validate – for confirming accuracy or logic.
Configure – for setup or system tuning.
Process / Workflow Management
Facilitate – for coordination, transitions, or team handoffs.
Organize – for structuring tasks, assets, or workflows.
Streamline – for simplifying a workflow or process.
Automate – for prompts related to systemized or recurring tasks.
Schedule – for planning, assigning, or sequencing actions.

Communication / Collaboration
Draft – for emails, announcements, proposals, or outlines.
Coordinate – for tasks involving multiple people or dependencies.
Respond – for follow-ups or message handling.
Clarify – for prompts that refine understanding or resolve confusion.
Summarize / Explain – for making something understandable.

Governance / Control
Prevent – for restrictions, policies, or guardrails.
Ensure – for quality checks and compliance.
Monitor – for prompts about ongoing tracking or oversight.
Enforce – for consistency or rules.
Approve / Review – for validation steps in workflows.

Strategic / Decision Work
Plan – for outlining strategy or next steps.
Prioritize – for task ranking or focus decisions.
Assess – for evaluating options or outcomes.
Recommend – for suggestion-based tasks.
Define – for establishing standards or roles.

Catch-all / General
If no clear context applies, choose from:
Create, Write, Design, Summarize, Explain, Develop, Facilitate, Organize, Plan, Prevent.

Meaning over mirroring: Don’t copy the first sentence; infer purpose.
Standalone: It should make sense even if shown mid-sentence.
Specificity: Mention clear deliverables or results (“handoff kit,” “review report,” “status summary”).
Format: No markdown or quotes inside; plain text only.

Examples
"Facilitate a smooth project handoff by preparing the final summary and sharing key updates."
"Organize campaign assets and deadlines for a more efficient marketing workflow."
"Write engaging marketing copy with clear hooks and strong calls to action."
"Design a branded presentation deck with consistent visuals and typography."
"Prevent unauthorized edits to API configurations or production data."
"Analyze campaign performance metrics to identify opportunities for optimization."
"Plan the next sprint’s deliverables and assign owners for each milestone."
"Clarify client feedback into structured action items for the design team."
"Streamline onboarding workflows by consolidating repetitive setup tasks."

8. Output Format

{
  "title": "Write Blog Articles",
  "body": "You are an expert content creator. I need you to...",
  "tags": ["blog", "content", "marketing"],
  "site_category": "general",
  "variables": [{ "name": "topic", "description": "The subject of the article" }],
  "preview": "Create a blog article that informs, engages, and aligns with audience interests.",
  "config": {
    "intent_task_label": "Blog Article Writing",
    "intent_task_key": "blog-article-writing"
  }
}
  Return JSON only.
`.trim();

function summarizeMessages(messages: Array<Record<string, unknown>>): string {
  if (!Array.isArray(messages) || !messages.length) return "(no additional messages)";
  const limited = messages.slice(0, 5);
  const summaryParts = limited.map((msg, idx) => {
    const source = typeof msg?.source_url === "string" ? msg.source_url : "unknown";
    const raw = String(msg?.raw_text ?? "").slice(0, 400).replace(/\s+/g, " ");
    return `#${idx + 1} [${source}] ${raw}`;
  });
  if (messages.length > limited.length) {
    summaryParts.push(`( +${messages.length - limited.length} more messages )`);
  }
  return summaryParts.join("\n");
}

function summarizeOutputs(outputs: Array<Record<string, unknown>>): string {
  if (!Array.isArray(outputs) || !outputs.length) {
    return "(no recent outputs captured)";
  }
  const limited = outputs.slice(0, 3);
  return limited
    .map((out, idx) => {
      const host = typeof out?.host === "string" && out.host ? out.host : "unknown";
      const captured =
        typeof out?.captured_at === "string" && out.captured_at
          ? out.captured_at
          : "n/a";
      const snippet = String(out?.excerpt ?? "")
        .slice(0, 600)
        .replace(/\s+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n");
      return `• Output ${idx + 1} [${host}, captured ${captured}]\n${snippet}`;
    })
    .join("\n\n");
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

  const taskLabel = String(body?.task_label ?? "").trim();
  if (!taskLabel) return bad("Field 'task_label' is required.");

  const persona = typeof body?.persona === "string" ? body.persona.trim() : "";
  const totalCount = body?.total_recent_count ?? null;
  const windowCount = body?.count_in_window ?? null;
  const examples = Array.isArray(body?.examples) ? body.examples : [];
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const recentOutputs = Array.isArray(body?.recent_outputs)
    ? body.recent_outputs
    : [];

  const examplesBlock = examples.length
    ? examples
        .map((ex: unknown, idx: number) => `• Example ${idx + 1}: ${String(ex ?? "").slice(0, 300)}`)
        .join("\n")
    : "(no explicit examples provided)";

  const messageSummary = summarizeMessages(messages);
  const outputsSummary = summarizeOutputs(recentOutputs);

  const userPrompt = [
    `Task label: ${taskLabel}`,
    typeof totalCount === "number"
      ? `Total appearances: ${totalCount}`
      : "Total appearances: unknown",
    typeof windowCount === "number"
      ? `Count in current window: ${windowCount}`
      : "Count in current window: unknown",
    persona ? `Persona (second person): ${persona}` : "Persona: (not provided)",
    "\nExamples:",
    examplesBlock,
    "\nMessages:",
    messageSummary,
    "\nRecent Outputs:",
    outputsSummary,
  ].join("\n");

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
    return json({ error: "Model output was not valid JSON.", debug: parsed }, 502);
  }

  const title = String(result?.title ?? "").trim();
  const promptBody = String(result?.body ?? "").trim();
  if (!title || !promptBody) {
    return json({ error: "Prompt builder returned empty title/body", debug: result }, 502);
  }

  const tags = Array.isArray(result?.tags)
    ? result.tags.map((tag: unknown) => String(tag ?? "").trim()).filter(Boolean)
    : [];
  const siteCategory = String(result?.site_category ?? "general").trim() || "general";
  const variables = Array.isArray(result?.variables) ? result.variables : [];
  const config =
    typeof result?.config === "object" && result.config ? result.config : {};

  return json({
    ok: true,
    title,
    body: promptBody,
    tags,
    site_category: siteCategory,
    variables,
    config,
  });
});
