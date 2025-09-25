// src/usage/tokenCounter.js
// Wrapper around vendored gpt-tokenizer for consistent token counting.

import { encode } from "../../vendor/gpt-tokenizer/main.js";

export function countTokens(text) {
  if (!text) return 0;
  return encode(text).length;
}
