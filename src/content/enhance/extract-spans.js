// src/content/enhance/extract-spans.js
// Compute role-based highlight spans from composer text.

import { ENH_CFG, LOG_PREFIX } from "./config.js";

const {
  INTENT,
  COMMAND_PHRASES,
  REQUEST_PREFIXES,
  THIRD_PARTY_PREFIXES,
  PRONOUN_PREFIXES,
  HELPER_VERBS,
  MAX_CLUSTERS,
} = ENH_CFG;

const RECIPIENTS = [
  "me",
  "us",
  "him",
  "her",
  "them",
  "our",
  "our team",
  "my team",
  "the team",
  "client",
  "clients",
  "customers",
  "stakeholders",
];

const TOPIC_PREPS = [
  "about",
  "regarding",
  "for",
  "on",
  "around",
  "of",
  "concerning",
];

const TOPIC_HINTS = [
  "blog",
  "article",
  "post",
  "summary",
  "analysis",
  "report",
  "plan",
  "outline",
  "email",
  "message",
  "script",
  "tweet",
  "draft",
];

function normalize(str) {
  return String(str || "");
}

function sliceSpan(text, start, end) {
  return text.slice(start, end);
}

function findFromList(textLower, list) {
  for (const item of list) {
    const idx = textLower.indexOf(item);
    if (idx >= 0) {
      return { start: idx, end: idx + item.length, value: item };
    }
  }
  return null;
}

function stripPrefixes(words) {
  const stripped = [...words];
  while (stripped.length) {
    const joinedTwo = stripped.slice(0, 2).join(" ");
    const first = stripped[0];
    if (
      PRONOUN_PREFIXES.includes(first) ||
      PRONOUN_PREFIXES.includes(joinedTwo)
    ) {
      stripped.shift();
      continue;
    }
    if (HELPER_VERBS.includes(first) || HELPER_VERBS.includes(joinedTwo)) {
      stripped.shift();
      continue;
    }
    break;
  }
  return stripped;
}

function tokenSegments(sentence) {
  const words = sentence
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  return { words, stripped: stripPrefixes(words) };
}

function clampSpan(span, max) {
  const start = Math.max(0, Math.min(max, span.start));
  const end = Math.max(start, Math.min(max, span.end));
  return { ...span, start, end };
}

export function extractSpans({
  text,
  matchedPhrase,
  matchedOffset,
  maxLength,
}) {
  const spans = [];
  if (!matchedPhrase) return spans;
  const base = matchedOffset || text.indexOf(matchedPhrase);
  if (base < 0) return spans;

  const sentence = normalize(matchedPhrase);
  const lower = sentence.toLowerCase();
  const docLength = typeof maxLength === "number" ? maxLength : text.length;

  const { stripped } = tokenSegments(sentence);
  const actionMatch =
    findFromList(lower, COMMAND_PHRASES) ||
    findFromList(lower, INTENT.verbs) ||
    findFromList(lower, REQUEST_PREFIXES) ||
    findFromList(lower, THIRD_PARTY_PREFIXES);

  if (actionMatch) {
    spans.push(
      clampSpan(
        {
          start: base + actionMatch.start,
          end: base + actionMatch.end,
          role: "action",
        },
        docLength
      )
    );
  } else if (stripped.length) {
    const firstWord = stripped[0];
    const idx = lower.indexOf(firstWord);
    if (idx >= 0) {
      spans.push(
        clampSpan(
          {
            start: base + idx,
            end: base + idx + firstWord.length,
            role: "action",
          },
          docLength
        )
      );
    }
  }

  const recipientMatch = findFromList(lower, RECIPIENTS);
  if (recipientMatch) {
    spans.push(
      clampSpan(
        {
          start: base + recipientMatch.start,
          end: base + recipientMatch.end,
          role: "recipient",
        },
        docLength
      )
    );
  }

  let topicSpan = null;
  for (const prep of TOPIC_PREPS) {
    const token = `${prep} `;
    const idx = lower.indexOf(token);
    if (idx >= 0) {
      const start = idx + token.length;
      const fragment = sentence.slice(start).trim();
      if (fragment) {
        topicSpan = {
          start: base + start,
          end: base + start + fragment.length,
        };
        break;
      }
    }
  }

  if (!topicSpan) {
    const hint = findFromList(lower, TOPIC_HINTS);
    if (hint) {
      topicSpan = {
        start: base + hint.start,
        end: base + Math.min(hint.end + 32, sentence.length),
      };
    }
  }

  if (topicSpan) {
    spans.push(
      clampSpan(
        {
          start: topicSpan.start,
          end: topicSpan.end,
          role: "topic",
        },
        docLength
      )
    );
  }

  const unique = [];
  for (const span of spans) {
    if (
      unique.some(
        (s) =>
          s.role === span.role &&
          Math.abs(s.start - span.start) < 2 &&
          Math.abs(s.end - span.end) < 2
      )
    ) {
      continue;
    }
    unique.push(span);
    if (unique.length >= MAX_CLUSTERS) break;
  }

  if (__DEV__()) {
    console.debug(`${LOG_PREFIX} spans`, unique);
  }
  return unique;
}

function __DEV__() {
  return typeof window !== "undefined" && window.__VIB_ENHANCE_DEV__ === true;
}
