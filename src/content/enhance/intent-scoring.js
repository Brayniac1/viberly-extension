// src/content/enhance/intent-scoring.js
// Intent detection scoring constants (intent-detection-core-spec v1.0).

export const INTENT_SCORING = Object.freeze({
  CARRIER: 2,
  IN_PROGRESS: 2,
  THIRD_PARTY_OR_PASSIVE: 2,
  IMPERATIVE_OR_MODAL_OR_TO_VERB: 2,
  ACTION_OBJECT: 1,
  COMMAND_PHRASE: 2,
  TRANSITION: 1,
  CONSTRAINT: 1,
  CONTINUATION_BULLETS: 1,
  THRESHOLD: 2,
});
