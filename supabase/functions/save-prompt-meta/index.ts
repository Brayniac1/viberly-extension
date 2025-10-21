// supabase/functions/save-prompt-meta/index.ts
// POST { text, source_host?, source_url? } ⇒ { title, tags[], site_category, variables, config }
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import OpenAI from "https://esm.sh/openai@4.56.0";
const openaiKey = Deno.env.get("OPENAI_API_KEY");
const openai = openaiKey ? new OpenAI({
  apiKey: openaiKey
}) : null;
const KNOWN_TOOLS = [
  "chatgpt",
  "heygen",
  "veo",
  "runway",
  "elevenlabs",
  "midjourney",
  "cursor",
  "replit",
  "bolt",
  "windsurf",
  "codeium"
];
serve(async (req)=>{
  if (req.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405
    });
  }
  try {
    const { text, source_host, source_url } = await req.json();
    const body = (text ?? "").toString().trim();
    if (!body) {
      return json({
        error: "Empty text"
      }, 400);
    }
    const hostTag = (source_host || "").toLowerCase().replace(/^www\./, "");
    const toolHit = KNOWN_TOOLS.find((t)=>hostTag.includes(t)) || null;
    // Default guess for site_category
    let site_category = inferCategory(body, toolHit);
    // Defaults (used if OPENAI_API_KEY absent or model call fails)
    let meta = {
      title: defaultTitle(body),
      tags: normalizeTags(uniq([
        ...toolHit ? [
          toolHit
        ] : [],
        ...guessTags(body).slice(0, 5)
      ])),
      site_category,
      variables: {},
      config: {},
      preview: defaultPreview(body, site_category)
    };
    if (openai) {
      const sys = `You create structured metadata for user-saved highlight snippets so they can be reused as custom prompts inside Viberly.
Rules:
- Title: <= 7 words, concise, no emojis.
- Tags: follow the Tags Rules below.
- Include one host-related tag if source_host hints at a known tool (chatgpt, heygen, veo, runway, elevenlabs, midjourney, cursor, replit, bolt, windsurf, codeium).
- site_category must be exactly one of: "programming", "general", "video", "marketing", "sales", "operations", "research".
- preview: 80-100 characters, verb-first, action-oriented continuation (no trailing punctuation) that states how this highlight will be reused.

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

Return ONLY JSON: {"title":"...","tags":["..."],"site_category":"...","preview":"..."} (no extra keys).`;
      const user = [
        source_host ? `source_host: ${source_host}` : "",
        source_url ? `source_url: ${source_url}` : "",
        `text:\n${body.slice(0, 3500)}`
      ].filter(Boolean).join("\n");
      try {
        const chat = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: sys
            },
            {
              role: "user",
              content: user
            }
          ],
          temperature: 0.2
        });
        const raw = String(chat.choices?.[0]?.message?.content ?? "{}");
        const j = safeJSON(raw);
        if (j?.title) meta.title = String(j.title).slice(0, 80);
        if (Array.isArray(j?.tags)) meta.tags = normalizeTags(uniq(StringArray(j.tags)).slice(0, 8));
        if (j?.site_category) meta.site_category = String(j.site_category);
        if (j?.preview) meta.preview = String(j.preview).slice(0, 100);
      } catch  {
      // keep heuristic defaults
      }
    }
    return json(meta, 200);
  } catch (e) {
    return json({
      error: String(e?.message || e)
    }, 500);
  }
});
// ---------- helpers ----------
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}
function safeJSON(s) {
  try {
    return JSON.parse(s);
  } catch  {
    return null;
  }
}
function StringArray(arr) {
  return (arr || []).map((x)=>String(x || "")).filter(Boolean);
}
function uniq(arr) {
  return Array.from(new Set(arr));
}
function defaultTitle(txt) {
  const first = txt.split(/\r?\n/).map((s)=>s.trim()).find(Boolean) || "Saved Highlight";
  return first.slice(0, 80);
}
function guessTags(txt) {
  const t = txt.toLowerCase();
  const tags = [];
  if (/\b(video|script|voiceover|storyboard|b-roll|shotlist)\b/.test(t)) tags.push("ai-video", "script");
  if (/\bprompt|system|assistant|persona|few-shot\b/.test(t)) tags.push("prompt", "persona");
  if (/\bhttp|https|url\b/.test(t)) tags.push("links");
  if (/\btypescript|javascript|python|sql|api|sdk|bug|error|stacktrace\b/.test(t)) tags.push("code");
  if (/\bwrite|blog|copy|ad|headline|hook|email\b/.test(t)) tags.push("copywriting");
  if (/\bsales|outreach|cadence|follow-up|objection\b/.test(t)) tags.push("sales");
  if (/\bresearch|summary|report|analysis|brief\b/.test(t)) tags.push("research");
  return uniq(tags);
}
function inferCategory(txt, toolHit) {
  const t = txt.toLowerCase();
  if (toolHit === "heygen" || toolHit === "veo" || /video|voiceover|script|shot|b-roll/.test(t)) return "video";
  if (/typescript|javascript|python|sql|stacktrace|api|sdk|error/.test(t)) return "programming";
  if (/ad|campaign|hook|headline|cta|copy|landing page|ugc/.test(t)) return "marketing";
  if (/outreach|cadence|crm|pipeline|deal|objection/.test(t)) return "sales";
  if (/process|sop|runbook|ops|handoff|shift/.test(t)) return "operations";
  if (/research|brief|analysis|summary|report/.test(t)) return "research";
  return "general";
}
function normalizeTags(arr) {
  return arr
    .map((tag)=>String(tag || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""))
    .filter(Boolean);
}
function defaultPreview(txt, category) {
  const verbs = {
    programming: "Audit",
    video: "Produce",
    marketing: "Create",
    sales: "Prepare",
    operations: "Organize",
    research: "Summarize",
    general: "Document"
  } as Record<string, string>;
  const verb = verbs[category] || "Create";
  const clean = txt.replace(/\s+/g, " ").trim();
  const fragment = clean.slice(0, 92);
  const preview = `${verb} ${fragment}`.replace(/\.+$/, "").trim();
  return preview.slice(0, 100);
}
