// src/content/enhance/suggestion-matcher.js
// Ranks guard candidates for inline prompt suggestions.

const TOKEN_REGEX = /[a-z0-9]+/gi;

function uniqueTokens(tokens) {
  const out = [];
  const seen = new Set();
  for (const token of tokens) {
    if (!token) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

function stemToken(token) {
  if (!token) return token;
  let stem = token;
  if (stem.length > 5 && stem.endsWith("ing")) {
    stem = stem.slice(0, -3);
  } else if (stem.length > 4 && stem.endsWith("ers")) {
    stem = stem.slice(0, -3);
  } else if (stem.length > 4 && stem.endsWith("ies")) {
    stem = `${stem.slice(0, -3)}y`;
  } else if (stem.length > 4 && stem.endsWith("ed")) {
    stem = stem.slice(0, -2);
  } else if (stem.length > 3 && stem.endsWith("es")) {
    stem = stem.slice(0, -2);
  } else if (stem.length > 3 && stem.endsWith("s")) {
    stem = stem.slice(0, -1);
  }
  return stem;
}

function tokenize(text) {
  if (!text) return [];
  const matches = String(text)
    .toLowerCase()
    .match(TOKEN_REGEX);
  if (!matches) return [];
  const stemmed = matches.map(stemToken);
  return uniqueTokens(stemmed);
}

function normalizeForNGrams(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function buildTrigramSet(value) {
  const normalized = normalizeForNGrams(value);
  if (!normalized) return new Set();
  const padded = `  ${normalized}  `;
  const grams = new Set();
  for (let i = 0; i < padded.length - 2; i++) {
    grams.add(padded.slice(i, i + 3));
  }
  return grams;
}

function trigramSimilarity(textA, textB) {
  if (!textA || !textB) return 0;
  const setA = buildTrigramSet(textA);
  const setB = buildTrigramSet(textB);
  if (!setA.size || !setB.size) return 0;
  let intersection = 0;
  setA.forEach((gram) => {
    if (setB.has(gram)) intersection += 1;
  });
  const union = setA.size + setB.size - intersection;
  return union ? intersection / union : 0;
}

function tokenCoverage(tokensA, tokensB) {
  if (!tokensA.length || !tokensB.length) {
    return { coverage: 0, matches: 0, sizeA: tokensA.length, sizeB: tokensB.length };
  }
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  let matches = 0;
  setA.forEach((token) => {
    if (setB.has(token)) matches += 1;
  });
  const coverageA = matches / (setA.size || 1);
  const coverageB = matches / (setB.size || 1);
  return {
    coverage: (coverageA + coverageB) / 2,
    matches,
    sizeA: setA.size,
    sizeB: setB.size,
  };
}

function overlapScore(queryTokens, candidateTokens) {
  if (!queryTokens || !candidateTokens || !queryTokens.length || !candidateTokens.length) {
    return 0;
  }
  const { coverage, matches, sizeA, sizeB } = tokenCoverage(
    queryTokens,
    candidateTokens
  );
  if (!matches) return 0;
  const ratio = matches / Math.max(sizeA || 1, sizeB || 1);
  return Math.max(coverage, ratio);
}

function partialContainsScore(query, candidate) {
  if (!query || !candidate) return 0;
  const lowerQuery = normalizeForNGrams(query);
  const lowerCandidate = normalizeForNGrams(candidate);
  if (!lowerQuery || !lowerCandidate) return 0;
  if (lowerCandidate.includes(lowerQuery)) return 1;
  if (lowerQuery.includes(lowerCandidate)) return 0.85;
  return 0;
}

function computeUsageBoost(stats = {}) {
  const acceptBoost = Math.min(0.3, (stats.acceptCount || 0) * 0.06);
  const recencyBoost =
    stats.lastAcceptedAt && Date.now() - stats.lastAcceptedAt < 30 * 60 * 1000
      ? 0.1
      : 0;
  const rejectPenalty = Math.min(0.25, (stats.rejectCount || 0) * 0.05);
  return acceptBoost + recencyBoost - rejectPenalty;
}

function buildCandidateTokens(guard) {
  const parts = [];
  if (guard.title) parts.push(guard.title);
  if (guard.preview) parts.push(guard.preview);
  if (guard.config?.intent_task_label) {
    parts.push(String(guard.config.intent_task_label));
  }
  return tokenize(parts.join(" "));
}

function buildTagTokens(tags = []) {
  if (!Array.isArray(tags)) return [];
  const normalized = tags
    .map((tag) =>
      typeof tag === "string" ? tag.toLowerCase().replace(/[^a-z0-9]+/g, " ") : ""
    )
    .join(" ")
    .split(/\s+/)
    .map(stemToken);
  return uniqueTokens(normalized);
}

export function deriveQueryFeatures({ labelText = "", tailText = "", tags = [] }) {
  const labelTokens = tokenize(labelText);
  const tailTokens = tokenize(tailText);
  const tagTokens = buildTagTokens(tags);
  return {
    labelText,
    tailText,
    labelTokens,
    tailTokens,
    tagTokens,
  };
}

export function rankGuardSuggestions({ guards = [], query }) {
  if (!guards.length || !query) return [];

  const {
    labelText = "",
    tailText = "",
    labelTokens = [],
    tailTokens = [],
    tagTokens = [],
  } = query;

  const ranked = [];

  for (const guard of guards) {
    if (!guard?.preview) continue;
    if (guard.status && String(guard.status).toLowerCase() !== "active") continue;

    const candidateTokens = buildCandidateTokens(guard);
    const previewTokens = tokenize(guard.preview);
    const guardTagTokens = buildTagTokens(guard.tags);
    const usageBoost = computeUsageBoost(guard.localUsage);

    let baseScore = overlapScore(labelTokens, candidateTokens);

    if (!baseScore && labelText) {
      baseScore = partialContainsScore(labelText, guard.title || guard.preview || "");
    }

    const previewScore = tailTokens.length
      ? overlapScore(tailTokens, previewTokens)
      : 0;

    const combinedCandidateText = [
      guard.title,
      guard.preview,
      guard.config?.intent_task_label,
    ]
      .filter(Boolean)
      .join(" ");

    const characterScore = trigramSimilarity(
      `${labelText} ${tailText}`.trim(),
      combinedCandidateText
    );

    // Encourage guards whose tags align with either the query tags or typed tokens.
    let tagScore = 0;
    if (guardTagTokens.length) {
      const tagOverlap = overlapScore(tagTokens, guardTagTokens);
      const tailOverlap = overlapScore(tailTokens, guardTagTokens);
      tagScore = Math.max(tagOverlap, tailOverlap);
    }

    const combined =
      baseScore * 0.45 +
      previewScore * 0.2 +
      characterScore * 0.2 +
      tagScore * 0.1 +
      usageBoost;

    const normalized = Math.max(0, Math.min(1, combined));

    const debug = {
      baseScore: Number(baseScore.toFixed(3)),
      previewScore: Number(previewScore.toFixed(3)),
      charScore: Number(characterScore.toFixed(3)),
      tagScore: Number(tagScore.toFixed(3)),
      usageBoost: Number(usageBoost.toFixed(3)),
    };

    ranked.push({
      guard,
      score: normalized,
      breakdown: debug,
    });
  }

  ranked.sort((a, b) => b.score - a.score);
  return ranked;
}
