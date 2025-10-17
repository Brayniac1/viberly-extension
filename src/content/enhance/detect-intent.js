// src/content/enhance/detect-intent.js
// Intent detection pipeline (intent-detection-core-spec v1.0 compliant).

import { ENH_CFG, LOG_PREFIX } from "./config.js";
import { INTENT_SCORING } from "./intent-scoring.js";

const {
  LENGTH_THRESHOLD_WORDS,
  COOLDOWN_MS,
  DAMPEN,
} = ENH_CFG;

const PUNCTUATION_CHARS = new Set([".", "?", "!", ";", "—", "–"]);
const BULLET_LINE_REGEX = /^\s*(?:[-*•]|\d+[.)])\s+/;
const MAX_COMPONENTS = 8;
const MAX_HASHED_NGRAMS = 12;

const GREETINGS = [
  "hi",
  "hey",
  "hello",
  "good morning",
  "good afternoon",
  "good evening",
];

const POLITENESS = [
  "please",
  "kindly",
  "would you mind",
  "if possible",
  "when you can",
];

const HEDGES = [
  "sorry",
  "apologies",
  "just",
  "maybe",
  "kinda",
  "sort of",
  "a bit",
  "so",
  "like",
  "you know",
  "basically",
  "literally",
  "right now",
  "at the moment",
];

const META_INTROS = [
  "for context",
  "backstory",
  "long story short",
  "quick note",
  "side note",
];

const PRONOUNS = ["it", "that", "this", "they", "them", "those", "these"];

const ACTION_VERBS = [
  "write",
  "create",
  "generate",
  "summarize",
  "translate",
  "analyze",
  "design",
  "build",
  "produce",
  "draft",
  "prepare",
  "compose",
  "outline",
  "plan",
  "research",
  "develop",
  "improve",
  "make",
];

const MODAL_PHRASES = [
  "can you",
  "could you",
  "would you",
  "would you mind",
  "could you please",
  "can i",
  "can we",
  "how to",
];

const THIRD_PARTY_NOUNS = [
  "boss",
  "manager",
  "client",
  "stakeholder",
  "stakeholders",
  "leadership",
  "team",
];

const PASSIVE_VERBS = ["asked", "told", "required", "expected", "needs", "needed"];

const COMMAND_PHRASES = [
  "put together",
  "put this together",
  "put the",
  "put that",
  "prepare",
  "pull together",
  "compile",
  "assemble",
  "set up",
  "follow up with",
  "pull the",
  "drop the",
  "send over",
  "hand off",
  "handoff",
  "ship the",
];

const TRANSITION_CUES = [
  "ok",
  "okay",
  "right",
  "alright",
  "so",
  "next",
  "and next",
  "ok next",
  "okay next",
  "alright next",
  "now",
  "well",
  "then",
];

const CARRIER_DEMAND_REGEX = /\b(?:i|we)\s+(?:need|want|have to|must|plan|intend|try to)\b/;
const IN_PROGRESS_REGEX = /\b(?:i'?m|we'?re)\s+(?:working on|creating|drafting|preparing)\b/;
const THIRD_PARTY_REGEX = new RegExp(
  String.raw`\b(?:my|our)\s+(?:${THIRD_PARTY_NOUNS.join("|")})\s+(?:${PASSIVE_VERBS.join("|")})\b`
);
const PASSIVE_REGEX = /\b(?:i|we)\s+(?:was|were|have been)\s+(?:asked|told|required to?)\b/;
const MODAL_REGEX = new RegExp(
  String.raw`\b(?:${MODAL_PHRASES.map(escapeRegExp).join("|")})\b`
);
const IMPERATIVE_START_REGEX = new RegExp(
  String.raw`^(?:please\s+)?(?:${ACTION_VERBS.join("|")})\b`
);
const TO_VERB_REGEX = new RegExp(
  String.raw`(?<!\baccording\s)(?<!\bclose\s)(?<!\bdue\s)(?<!\bused\s)(?<!\bnext\s)(?<!\blook\s)to\s+(?:${ACTION_VERBS.join("|")})\b`
);
const PRONOUN_REGEX = new RegExp(String.raw`\b(?:${PRONOUNS.join("|")})\b`);
const TOPIC_REGEX = /\b(?:about|on|regarding|around)\s+([^.,;!?]+)/i;

const LENGTH_REGEX = /\b(\d{1,5})\s*(words?|pages?|chars?|characters?|sentences?)\b/gi;
const RANGE_REGEX = /\b(\d+)\s*[-–]\s*(\d+)\s*(words?|pages?|chars?|characters?)\b/gi;
const TONE_REGEX = /\b(?:in|with)\s+(?:an?\s+)?([a-z\s]+?)\s+tone\b/gi;
const FORMAT_REGEX = /\b(?:use|format (?:it|this|the) as)\s+([a-z\s]+)\b/gi;
const AUDIENCE_REGEX = /\bfor\s+(?:the\s+)?([a-z\s]+?)\b(?=\s+(?:team|leaders|executives|readers|audience|clients|customers|stakeholders)\b)/gi;
const LANGUAGE_REGEX = /\b(?:in|to)\s+(?:be\s+)?([a-z\s]+?)\s+(?:language|locale)\b/gi;
const DEADLINE_REGEX = /\bby\s+(today|tomorrow|eod|end of day|end of week|(?:next\s+)?(?:monday|tuesday|wednesday|thursday|friday)|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/gi;
const INCLUDE_REGEX = /\b(?:must|should|need(?:s)? to)\s+include\s+([a-z0-9\s]+?)(?=[.,;!?]|$)/gi;
const EXCLUDE_REGEX = /\b(?:don't|do not|avoid)\s+([a-z0-9\s]+?)(?=[.,;!?]|$)/gi;

const MAX_SCORING_TOTAL =
  INTENT_SCORING.CARRIER +
  INTENT_SCORING.IN_PROGRESS +
  INTENT_SCORING.THIRD_PARTY_OR_PASSIVE +
  INTENT_SCORING.IMPERATIVE_OR_MODAL_OR_TO_VERB +
  INTENT_SCORING.COMMAND_PHRASE +
  INTENT_SCORING.TRANSITION +
  INTENT_SCORING.ACTION_OBJECT +
  INTENT_SCORING.CONTINUATION_BULLETS +
  INTENT_SCORING.CONSTRAINT * 2;

function normalize(str) {
  return String(str || "");
}

function toWords(str) {
  return normalize(str)
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function includesPhrase(haystack, needles) {
  const lower = haystack.toLowerCase();
  return needles.some((phrase) => lower.includes(phrase));
}

function escapeRegExp(str) {
  return String(str || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function standardizeQuotes(str) {
  return String(str || "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
}

function removeDeChatter(text) {
  let output = String(text || "");
  const phrases = [...GREETINGS, ...POLITENESS, ...HEDGES, ...META_INTROS];
  for (const phrase of phrases) {
    const pattern = new RegExp(String.raw`\b${escapeRegExp(phrase)}\b[:,!\s]*`, "gi");
    output = output.replace(pattern, " ");
  }
  return output.replace(/\s+/g, " ").trim();
}

function sanitizeClauseText(clauseText) {
  const standardized = standardizeQuotes(clauseText).toLowerCase();
  return removeDeChatter(standardized);
}

function segmentClauses(text) {
  const source = normalize(text);
  const len = source.length;
  const segments = [];
  let start = 0;
  let i = 0;
  let inContinuation = false;
  let lastSegmentEnd = 0;

  function pushSegment(end, forcedContinuation = false) {
    if (end <= start) {
      start = end;
      return;
    }
    const raw = source.slice(start, end);
    const leadingMatch = raw.match(/^\s*/);
    const trailingMatch = raw.match(/\s*$/);
    const leading = leadingMatch ? leadingMatch[0].length : 0;
    const trailing = trailingMatch ? trailingMatch[0].length : 0;
    const trimmed = raw.slice(leading, raw.length - trailing);
    if (!trimmed) {
      start = end;
      return;
    }
    const segmentStart = start + leading;
    const segmentEnd = end - trailing;
    const paragraphBreak =
      segments.length > 0 &&
      /\r?\n\s*\r?\n/.test(source.slice(lastSegmentEnd, segmentStart));
    const hasContinuation =
      forcedContinuation ||
      /:\s*\r?\n\s*(?:[-*•]|\d+[.)])\s+/i.test(trimmed);
    segments.push({
      text: trimmed,
      start: segmentStart,
      end: segmentEnd,
      hasContinuation,
      paragraphBreakBefore: paragraphBreak,
    });
    lastSegmentEnd = segmentEnd;
    start = end;
  }

  while (i <= len) {
    if (i === len) {
      pushSegment(i, inContinuation);
      break;
    }
    const char = source[i];

    if (char === ":" && !inContinuation) {
      let j = i + 1;
      while (j < len && source[j] === " ") j++;
      if (j < len && (source[j] === "\n" || source[j] === "\r")) {
        const newlineLen =
          source[j] === "\r" && source[j + 1] === "\n" ? 2 : 1;
        let lineStart = j + newlineLen;
        while (lineStart < len && (source[lineStart] === " " || source[lineStart] === "\t")) {
          lineStart++;
        }
        let lineEnd = lineStart;
        while (lineEnd < len && source[lineEnd] !== "\n" && source[lineEnd] !== "\r") {
          lineEnd++;
        }
        const line = source.slice(lineStart, lineEnd);
        if (BULLET_LINE_REGEX.test(line)) {
          inContinuation = true;
        }
      }
    }

    if (char === "\n" || char === "\r") {
      const newlineLen =
        char === "\r" && source[i + 1] === "\n" ? 2 : 1;
      const nextLineStart = i + newlineLen;
      let lineStart = nextLineStart;
      while (lineStart < len && (source[lineStart] === " " || source[lineStart] === "\t")) {
        lineStart++;
      }
      let lineEnd = lineStart;
      while (lineEnd < len && source[lineEnd] !== "\n" && source[lineEnd] !== "\r") {
        lineEnd++;
      }
      const line = source.slice(lineStart, lineEnd);
      const isBulletLine = BULLET_LINE_REGEX.test(line);
      const isBlankLine = line.trim().length === 0;

      if (inContinuation && !isBulletLine) {
        pushSegment(nextLineStart, true);
        inContinuation = false;
      } else if (!inContinuation && isBlankLine) {
        pushSegment(i);
        start = nextLineStart;
      }

      i = nextLineStart;
      continue;
    }

    if (PUNCTUATION_CHARS.has(char) && !inContinuation) {
      const end = i + 1;
      pushSegment(end);
      i = end;
      continue;
    }

    i++;
  }

  return segments;
}

function extractActionObject(sanitizedText) {
  if (!sanitizedText) return { action: null, object: null };
  const actionRegex = new RegExp(
    String.raw`\b(?:${ACTION_VERBS.join("|")})\b`
  );
  const actionMatch = sanitizedText.match(actionRegex);
  if (!actionMatch) {
    return { action: null, object: null };
  }

  const action = actionMatch[0];
  const remainder = sanitizedText.slice(actionMatch.index + action.length).trim();
  if (!remainder) {
    return { action, object: null };
  }

  const object = remainder
    .split(/\b(?:for|about|on|with|using|by|that|which|who|to|into|in order)\b/)[0]
    .trim();

  return {
    action,
    object: object || null,
  };
}

function extractTopic(segmentText) {
  const match = String(segmentText || "").match(TOPIC_REGEX);
  if (!match) return null;
  return match[1].trim();
}

function extractComponents(segmentText) {
  const lines = String(segmentText || "").split(/\r?\n/);
  const components = [];
  for (const line of lines) {
    if (!BULLET_LINE_REGEX.test(line)) continue;
    const stripped = line.replace(BULLET_LINE_REGEX, "").trim();
    if (stripped) {
      components.push(stripped);
      if (components.length >= MAX_COMPONENTS) break;
    }
  }
  return components;
}

function collectConstraintMatches(regex, text, type) {
  regex.lastIndex = 0;
  const results = [];
  let match;
  while ((match = regex.exec(text))) {
    const value = match.slice(1).filter(Boolean).join(" ").trim();
    if (!value) continue;
    results.push({
      type,
      value,
      raw: match[0],
    });
  }
  return results;
}

function extractConstraints(segmentText) {
  const text = String(segmentText || "");
  const constraints = [
    ...collectConstraintMatches(RANGE_REGEX, text, "lengthRange"),
    ...collectConstraintMatches(LENGTH_REGEX, text, "length"),
    ...collectConstraintMatches(TONE_REGEX, text, "tone"),
    ...collectConstraintMatches(FORMAT_REGEX, text, "format"),
    ...collectConstraintMatches(AUDIENCE_REGEX, text, "audience"),
    ...collectConstraintMatches(LANGUAGE_REGEX, text, "language"),
    ...collectConstraintMatches(DEADLINE_REGEX, text, "deadline"),
    ...collectConstraintMatches(INCLUDE_REGEX, text, "include"),
    ...collectConstraintMatches(EXCLUDE_REGEX, text, "exclude"),
  ];
  return constraints;
}

function attachPronounConstraints(constraints, sanitizedText, context) {
  if (!constraints.length) return constraints;
  if (!context?.lastObject) return constraints;
  if (!PRONOUN_REGEX.test(sanitizedText || "")) return constraints;
  return constraints.map((constraint) => ({
    ...constraint,
    target: context.lastObject,
  }));
}

function dedupeStrings(values) {
  const seen = new Set();
  const deduped = [];
  for (const value of values) {
    if (!value) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    deduped.push(value);
  }
  return deduped;
}

function hasCommandPhrase(text) {
  if (!text) return false;
  const lower = String(text).toLowerCase();
  return COMMAND_PHRASES.some((phrase) =>
    lower.startsWith(phrase) || lower.includes(` ${phrase}`)
  );
}

function hasTransitionCue(rawText) {
  if (!rawText) return false;
  const lower = String(rawText).toLowerCase();
  return TRANSITION_CUES.some((cue) => lower.startsWith(cue));
}

function analyzeClause(segment, context) {
  const sanitized = sanitizeClauseText(segment.text);
  const actionInfo = extractActionObject(sanitized);
  const rawConstraints = extractConstraints(segment.text);
  const constraints = attachPronounConstraints(rawConstraints, sanitized, context);
  const patternsHit = [];
  let score = 0;

  if (CARRIER_DEMAND_REGEX.test(sanitized)) {
    score += INTENT_SCORING.CARRIER;
    patternsHit.push("carrier-demand");
  }
  if (IN_PROGRESS_REGEX.test(sanitized)) {
    score += INTENT_SCORING.IN_PROGRESS;
    patternsHit.push("in-progress");
  }
  if (THIRD_PARTY_REGEX.test(sanitized) || PASSIVE_REGEX.test(sanitized)) {
    score += INTENT_SCORING.THIRD_PARTY_OR_PASSIVE;
    patternsHit.push("third-party/passive");
  }
  if (
    IMPERATIVE_START_REGEX.test(sanitized) ||
    MODAL_REGEX.test(sanitized) ||
    TO_VERB_REGEX.test(sanitized)
  ) {
    score += INTENT_SCORING.IMPERATIVE_OR_MODAL_OR_TO_VERB;
    patternsHit.push("imperative/modal/to-verb");
  }

  if (hasCommandPhrase(sanitized)) {
    score += INTENT_SCORING.COMMAND_PHRASE;
    patternsHit.push("command-phrase");
  }

  if (hasTransitionCue(segment?.text || "")) {
    score += INTENT_SCORING.TRANSITION;
    patternsHit.push("transition");
  }

  if (constraints.length) {
    const constraintBonus = Math.min(2, constraints.length) * INTENT_SCORING.CONSTRAINT;
    score += constraintBonus;
    patternsHit.push(
      ...constraints.map((constraint) => `constraint:${constraint.type}`)
    );
  }

  if (actionInfo.action || actionInfo.object) {
    score += INTENT_SCORING.ACTION_OBJECT;
    patternsHit.push("action/object");
  }

  if (segment.hasContinuation) {
    score += INTENT_SCORING.CONTINUATION_BULLETS;
    patternsHit.push("continuation-bullets");
  }

  const components = segment.hasContinuation ? extractComponents(segment.text) : [];
  const topic = extractTopic(segment.text);

  return {
    sanitized,
    score,
    patternsHit: dedupeStrings(patternsHit),
    constraints,
    action: actionInfo.action,
    object: actionInfo.object,
    components,
    topic,
  };
}

function updateContext(context, segment, analysis) {
  if (!context) return;
  if (segment.paragraphBreakBefore) {
    context.lastObject = null;
    context.lastAction = null;
    context.emptyStreak = 0;
  }

  if (analysis.action || analysis.object) {
    if (analysis.action) context.lastAction = analysis.action;
    if (analysis.object) context.lastObject = analysis.object;
    context.emptyStreak = 0;
  } else {
    context.emptyStreak = (context.emptyStreak || 0) + 1;
    if (context.emptyStreak >= 2) {
      context.lastObject = null;
      context.lastAction = null;
      context.emptyStreak = 0;
    }
  }
}

function constraintsToMap(constraints) {
  if (!constraints.length) return {};
  const map = {};
  for (const constraint of constraints) {
    if (!constraint?.type || !constraint?.value) continue;
    if (map[constraint.type]) {
      if (Array.isArray(map[constraint.type])) {
        map[constraint.type].push(constraint.value);
      } else {
        map[constraint.type] = [map[constraint.type], constraint.value];
      }
    } else {
      map[constraint.type] = constraint.value;
    }
    if (constraint.target) {
      map.target = constraint.target;
    }
  }
  return map;
}

function computeConfidence(score) {
  if (!score) return 0.4;
  const ratio = Math.min(score / MAX_SCORING_TOTAL, 1);
  const confidence = 0.45 + ratio * 0.45;
  return Math.max(0.45, Math.min(0.99, Number(confidence.toFixed(2))));
}

function buildStructuredIntent(segment, analysis, context) {
  const constraints = constraintsToMap(analysis.constraints);
  const intent = analysis.action || context?.lastAction || null;
  const object = analysis.object || context?.lastObject || null;
  const topic = analysis.topic || null;
  const components = analysis.components.length ? analysis.components : undefined;

  return {
    intent,
    object,
    topic,
    components,
    constraints: Object.keys(constraints).length ? constraints : undefined,
    confidence: computeConfidence(analysis.score),
  };
}

function hasherSeed() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function hashString(str) {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;
  }
  return hash.toString(16);
}

function hashClauseNGrams(text) {
  const tokens = String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) return [];
  const hashes = new Set();
  const maxSize = Math.min(3, tokens.length);
  for (let size = 1; size <= maxSize; size++) {
    for (let i = 0; i <= tokens.length - size; i++) {
      const gram = tokens.slice(i, i + size).join(" ");
      hashes.add(hashString(gram));
      if (hashes.size >= MAX_HASHED_NGRAMS) break;
    }
    if (hashes.size >= MAX_HASHED_NGRAMS) break;
  }
  return Array.from(hashes);
}

function getFeatureFlags() {
  const globalRoot =
    (typeof window !== "undefined" && window.__VG) ||
    (typeof globalThis !== "undefined" && globalThis.__VG);
  return globalRoot?.featureFlags || null;
}

function shouldLogTelemetry() {
  const isDev =
    (typeof process !== "undefined" && process.env && process.env.NODE_ENV === "development") ||
    (typeof window !== "undefined" && window.__VG_ENV__ === "development") ||
    (typeof globalThis !== "undefined" && globalThis.__VG_ENV__ === "development");
  if (!isDev) return false;
  const flags = getFeatureFlags();
  return Boolean(flags && flags.intentTelemetry === true);
}

function emitTelemetry(event, payload) {
  if (!shouldLogTelemetry()) return;
  try {
    const record = { event, at: Date.now(), ...payload };
    const root =
      (typeof window !== "undefined" && window.__VG) ||
      (typeof globalThis !== "undefined" && globalThis.__VG) ||
      {};
    if (typeof root.trackIntentEvent === "function") {
      root.trackIntentEvent(record);
    } else {
      console.debug(`${LOG_PREFIX} intent telemetry`, record);
    }
  } catch {
    // no-op telemetry failures
  }
}

export function shouldTrigger({
  text,
  now = Date.now(),
  lastFireAt = 0,
}) {
  const rawText = normalize(text);
  const trimmed = rawText.trim();
  const lower = trimmed.toLowerCase();
  const result = {
    trigger: false,
    reason: "",
    wordCount: 0,
    cooldownUntil: 0,
    matchedPhrase: "",
    matchedOffset: -1,
  };

  if (!trimmed) {
    result.reason = "empty";
    return result;
  }

  void lastFireAt;

  if (includesPhrase(lower, DAMPEN)) {
    result.reason = "dampened";
    return result;
  }

  result.wordCount = toWords(trimmed).length;
  const startTime = hasherSeed();

  const context = {
    lastObject: null,
    lastAction: null,
    emptyStreak: 0,
  };
  const segments = segmentClauses(rawText);

  const matches = [];
  const telemetrySegments = [];
  const aggregatePatterns = new Set();
  const aggregateConstraints = new Set();
  let bestAnalysis = null;
  let bestStructured = null;

  for (const segment of segments) {
    const analysis = analyzeClause(segment, context);
    telemetrySegments.push({
      patternsHit: analysis.patternsHit,
      score: analysis.score,
      hasContinuation: segment.hasContinuation,
      constraints: analysis.constraints.map((constraint) => constraint.type),
      hashes: shouldLogTelemetry() ? hashClauseNGrams(segment.text) : [],
    });

    analysis.patternsHit.forEach((hit) => aggregatePatterns.add(hit));
    analysis.constraints.forEach((constraint) => aggregateConstraints.add(constraint.type));

    const passesThreshold = analysis.score >= INTENT_SCORING.THRESHOLD;
    if (passesThreshold) {
      const structured = buildStructuredIntent(segment, analysis, context);
      if (!bestAnalysis || analysis.score > bestAnalysis.score) {
        bestAnalysis = { segment, analysis };
        bestStructured = structured;
      }
      matches.push({
        text: segment.text.slice(0, 240),
        start: segment.start,
        end: segment.end,
        score: analysis.score,
        patternsHit: analysis.patternsHit,
        constraints: analysis.constraints,
        components: analysis.components,
        topic: analysis.topic,
        intent: analysis.action,
        object: analysis.object,
        hasContinuation: segment.hasContinuation,
        structured,
      });
    }

    updateContext(context, segment, analysis);
  }

  const totalElapsed =
    (typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now()) - startTime;

  if (!matches.length) {
    if (result.wordCount < LENGTH_THRESHOLD_WORDS) {
      result.reason = "short-no-intent";
    } else {
      result.reason = "no-intent";
    }

    emitTelemetry("intent.none", {
      patternsHit: Array.from(aggregatePatterns),
      score: 0,
      hasContinuation: false,
      constraints: Array.from(aggregateConstraints),
      timeMs: Number(totalElapsed.toFixed(3)),
      segments: telemetrySegments.slice(0, 4),
    });
    return result;
  }

  matches.sort((a, b) => a.start - b.start);

  result.trigger = true;
  result.reason = "intent";
  result.matchedSegments = matches;
  result.matchedPhrase = matches[0]?.text || "";
  result.matchedOffset = matches[0]?.start ?? -1;
  result.cooldownUntil = now + COOLDOWN_MS;
  result.intentSummary = bestStructured || matches[0]?.structured;

  emitTelemetry("intent.detected", {
    patternsHit: Array.from(aggregatePatterns),
    score: bestAnalysis?.analysis?.score ?? 0,
    hasContinuation: Boolean(matches.some((item) => item.hasContinuation)),
    constraints: Array.from(aggregateConstraints),
    timeMs: Number(totalElapsed.toFixed(3)),
    segments: telemetrySegments.slice(0, 4),
  });

  console.debug(`${LOG_PREFIX} intent hit`, {
    words: result.wordCount,
    matched: result.matchedPhrase,
    segments: matches.length,
    score: bestAnalysis?.analysis?.score ?? 0,
  });

  return result;
}
