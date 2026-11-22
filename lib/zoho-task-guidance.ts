import { getTaskGuides } from "./guide-previews.ts";

const ZOHO_TEXT_FIELD_MAX_LENGTH = 300;

function firstSentence(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return null;
  const sentence = normalized.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? normalized;
  return sentence.length <= ZOHO_TEXT_FIELD_MAX_LENGTH ? sentence : null;
}

export function getZohoTaskGuidance(input: { description: string | null; templateKey: string }) {
  const guide = getTaskGuides(input.templateKey)[0] ?? null;
  return {
    guideUrl: guide?.href ?? null,
    tip: input.description ? firstSentence(input.description) : null
  };
}
