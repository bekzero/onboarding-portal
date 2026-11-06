import type { ZohoContactSnapshot } from "./zoho-contact-mapping";

type Provider = {
  synchronizeContact(snapshot: ZohoContactSnapshot): Promise<{ classification: string; code: string }>;
  triggerJourney(input: {
    journeyKey: string;
    leadEmail: string;
    listKey: string;
    triggerKey: string;
  }): Promise<{ classification: "TRIGGERED" | "ALREADY_TRIGGERED" | "IGNORED"; code: string }>;
};

export async function executeZohoProviderWorkflow(input: {
  beforeJourneyTrigger?: () => Promise<void>;
  journey?: { journeyKey: string; leadEmail: string; listKey: string; triggerKey: string };
  provider: Provider;
  snapshot: ZohoContactSnapshot;
}) {
  const contact = await input.provider.synchronizeContact(input.snapshot);
  if (!input.journey) return { contact, journey: null };
  await input.beforeJourneyTrigger?.();
  const journey = await input.provider.triggerJourney(input.journey);
  return { contact, journey };
}
