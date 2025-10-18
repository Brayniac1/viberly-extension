// src/content/enhance/extract-spans.js
// Compute role-based highlight spans from composer text.

import { ENH_CFG, LOG_PREFIX } from "./config.js";

function shouldDebug() {
  return typeof window !== "undefined" && Boolean(window.VG_INTENT_DEBUG);
}

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
  let actionSpan = null;
  const actionMatch =
    findFromList(lower, COMMAND_PHRASES) ||
    findFromList(lower, INTENT.verbs) ||
    findFromList(lower, REQUEST_PREFIXES) ||
    findFromList(lower, THIRD_PARTY_PREFIXES);

  if (actionMatch) {
    actionSpan = clampSpan(
      {
        start: base + actionMatch.start,
        end: base + actionMatch.end,
        role: "action",
      },
      docLength
    );
    spans.push(actionSpan);
  } else if (stripped.length) {
    const firstWord = stripped[0];
    const idx = lower.indexOf(firstWord);
    if (idx >= 0) {
      actionSpan = clampSpan(
        {
          start: base + idx,
          end: base + idx + firstWord.length,
          role: "action",
        },
        docLength
      );
      spans.push(actionSpan);
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

  const directObjectSpan = actionSpan
    ? findDirectObjectSpan({
        sentence,
        lower,
        base,
        actionSpan,
        docLength,
      })
    : null;

  if (directObjectSpan) {
    spans.push(directObjectSpan);
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
  if (shouldDebug()) {
    console.debug(`${LOG_PREFIX} spans`, unique);
  }
  }
  return unique;
}

function __DEV__() {
  return typeof window !== "undefined" && window.__VIB_ENHANCE_DEV__ === true;
}

const DETERMINERS = [
  "a",
  "an",
  "the",
  "this",
  "that",
  "these",
  "those",
  "my",
  "our",
  "your",
  "his",
  "her",
  "their",
  "any",
  "another",
];

const NUMBER_WORDS = [
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
  "twenty",
];

const OBJECT_STOP_WORDS = [
  ...TOPIC_PREPS,
  "to",
  "with",
  "at",
  "from",
  "into",
  "onto",
  "over",
  "under",
  "around",
  "and",
  "but",
  "or",
];

function findDirectObjectSpan({ sentence, lower, base, actionSpan, docLength }) {
  const relStart = Math.max(0, actionSpan.end - base);
  if (relStart >= sentence.length) return null;

  const tail = sentence.slice(relStart);
  const lowerTail = lower.slice(relStart);

  let stopIdx = tail.length;
  for (const stop of OBJECT_STOP_WORDS) {
    const idx = lowerTail.indexOf(`${stop} `);
    if (idx >= 0 && idx < stopIdx) {
      stopIdx = idx;
    }
  }

  const candidate = tail.slice(0, stopIdx).trim();
  if (!candidate) return null;
  const lowerCandidate = candidate.toLowerCase();

  const detRegex = new RegExp(
    `\\b(?:${[...DETERMINERS, ...NUMBER_WORDS].join("|")}|\\d+)\\b`
  );
  let startOffset = 0;
  const detMatch = detRegex.exec(lowerCandidate);
  if (detMatch) {
    startOffset = detMatch.index;
  } else {
    const firstWord = /\b[a-z0-9][\w'-]*\b/i.exec(candidate);
    if (!firstWord) return null;
    startOffset = firstWord.index;
  }

  const words = [];
  const wordRegex = /\b[a-z0-9][\w'-]*\b/gi;
  wordRegex.lastIndex = startOffset;
  let wordMatch;
  while ((wordMatch = wordRegex.exec(candidate))) {
    words.push(wordMatch);
    if (wordRegex.lastIndex >= candidate.length) break;
    if (words.length >= 4) break;
  }
  if (!words.length) return null;
  const lastWord = words[words.length - 1];
  const localStart = startOffset;
  const localEnd = lastWord.index + lastWord[0].length;
  if (localEnd <= localStart) return null;

  const absStart = base + relStart + localStart;
  const absEnd = base + relStart + localEnd;
  if (absEnd - absStart < 2) return null;

  return clampSpan(
    {
      start: absStart,
      end: absEnd,
      role: "topic",
    },
    docLength
  );
}
