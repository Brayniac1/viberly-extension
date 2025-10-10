// src/content/enhance/detect-intent.js
// Intent + cooldown heuristics for Phase 2.

import { ENH_CFG, LOG_PREFIX } from "./config.js";

const {
  INTENT,
  DAMPEN,
  LENGTH_THRESHOLD_WORDS,
  COOLDOWN_MS,
  REQUEST_PREFIXES,
  COMMAND_PHRASES,
  THIRD_PARTY_PREFIXES,
  HELPER_VERBS,
  PRONOUN_PREFIXES,
} = ENH_CFG;

function normalize(str) {
  return String(str || "").trim();
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

function startsWithVerb(words) {
  if (!words.length) return false;
  return INTENT.verbs.includes(words[0]);
}

function startsWithWh(words) {
  if (!words.length) return false;
  return INTENT.wh.includes(words[0]);
}

function hasPolitePrefix(textLower) {
  return INTENT.polite.some((phrase) => textLower.startsWith(phrase));
}

function stripPrefixes(words) {
  const stripped = [...words];
  while (stripped.length) {
    const joined = stripped.slice(0, 2).join(" ");
    const single = stripped[0];
    if (
      PRONOUN_PREFIXES.includes(single) ||
      PRONOUN_PREFIXES.includes(joined)
    ) {
      stripped.shift();
      continue;
    }
    if (
      HELPER_VERBS.includes(single) ||
      HELPER_VERBS.includes(joined)
    ) {
      stripped.shift();
      continue;
    }
    break;
  }
  return stripped;
}

function sanitizeToken(token) {
  return token.replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, "");
}

function matchPrefix(tokens, list, maxLen = 3) {
  const limit = Math.min(maxLen, tokens.length);
  for (let len = limit; len >= 1; len--) {
    const piece = tokens
      .slice(0, len)
      .map(sanitizeToken)
      .join(" ")
      .trim();
    if (piece && list.includes(piece)) {
      return len;
    }
  }
  return 0;
}

function stripLeadIns(words) {
  const stripped = [...words];
  // Remove pure lead-ins at the very start
  while (true) {
    const len = matchPrefix(stripped, ENH_CFG.LEAD_IN_PREFIXES || []);
    if (len > 0) {
      stripped.splice(0, len);
      continue;
    }
    break;
  }

  // If a pronoun prefix leads, drop any filler immediately after it
  const pronounLen = matchPrefix(stripped, PRONOUN_PREFIXES || [], 3);
  if (pronounLen > 0) {
    let index = pronounLen;
    while (index < stripped.length) {
      const len = matchPrefix(stripped.slice(index), ENH_CFG.LEAD_IN_PREFIXES || []);
      if (len > 0) {
        stripped.splice(index, len);
        continue;
      }
      break;
    }
  }

  return stripped;
}

function startsWithPhrase(words, phrases) {
  const lower = words.join(" ");
  return phrases.some((phrase) => lower.startsWith(phrase));
}

function evaluateSegment(segment) {
  const cleaned = normalize(segment);
  if (!cleaned) return false;
  const trimmed = cleaned.trim();
  if (!trimmed) return false;
  if (!/[.!?]$/.test(trimmed)) return false;

  const originalWords = toWords(trimmed);
  const leadStripped = stripLeadIns(originalWords);
  const words = leadStripped.length ? leadStripped : originalWords;
  const lower = words.join(" ");

  if (startsWithVerb(words)) return true;
  if (startsWithWh(words)) return true;
  if (hasPolitePrefix(lower)) return true;
  if (startsWithPhrase(words, REQUEST_PREFIXES)) return true;
  if (startsWithPhrase(words, COMMAND_PHRASES)) return true;
  if (startsWithPhrase(words, THIRD_PARTY_PREFIXES)) return true;
  if (cleaned.endsWith("?") && startsWithWh(words)) return true;

  const stripped = stripPrefixes(words);
  if (stripped.length && startsWithVerb(stripped)) return true;
  return false;
}

export function shouldTrigger({
  text,
  now = Date.now(),
  lastFireAt = 0,
}) {
  const normalized = normalize(text);
  const lower = normalized.toLowerCase();
  const result = {
    trigger: false,
    reason: "",
    wordCount: 0,
    cooldownUntil: 0,
    hasIntent: false,
    matchedPhrase: "",
    matchedOffset: -1,
  };

  if (!normalized) {
    result.reason = "empty";
    return result;
  }

  if (includesPhrase(lower, DAMPEN)) {
    result.reason = "dampened";
    return result;
  }

  result.wordCount = toWords(normalized).length;

  const segments = [];
  const regex = /([^\n.!?]+[.!?]?)/g;
  let match;
  let matchesWithIntent = [];
  while ((match = regex.exec(normalized))) {
    const raw = match[1];
    const leading = raw.length - raw.replace(/^\s+/, "").length;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    segments.push({
      text: trimmed,
      start: match.index + leading,
      end: match.index + leading + trimmed.length,
    });
  }
  if (!segments.length) {
    segments.push({ text: normalized, start: 0, end: normalized.length });
  }

  for (const seg of segments) {
    if (evaluateSegment(seg.text)) {
      result.hasIntent = true;
      matchesWithIntent.push({
        text: seg.text.slice(0, 240),
        start: seg.start,
        end: seg.end,
      });
      if (!result.matchedPhrase) {
        result.matchedPhrase = seg.text.slice(0, 120);
        result.matchedOffset = seg.start;
      }
    }
  }

  if (result.wordCount < LENGTH_THRESHOLD_WORDS && !result.hasIntent) {
    result.reason = "short-no-intent";
    return result;
  }

  if (result.wordCount >= LENGTH_THRESHOLD_WORDS && !result.hasIntent) {
    result.reason = "no-intent";
    return result;
  }

  result.trigger = true;
  result.reason = "intent";
  result.matchedSegments = matchesWithIntent;
  result.cooldownUntil = now + COOLDOWN_MS;
  console.debug(`${LOG_PREFIX} intent hit`, {
    words: result.wordCount,
    matched: result.matchedPhrase,
    segments: matchesWithIntent.length,
  });
  return result;
}
