import { handleSchedule } from "@vercel/schedules";
import { getZohoDispatchConfiguration } from "../lib/zoho-config";
import { dispatchZohoOutboxBatch } from "../lib/zoho-dispatcher";

export const POST = handleSchedule(async (metadata) => {
  if (metadata.name !== "zoho-automatic-dispatch") {
    throw new Error("Unexpected schedule target.");
  }

  const configuration = getZohoDispatchConfiguration();
  if (!configuration.automaticDispatchEnabled) return;

  await dispatchZohoOutboxBatch();
});
