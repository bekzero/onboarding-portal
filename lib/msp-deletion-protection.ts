export const MSP_HAS_AUTOMATION_HISTORY_CODE = "MSP_HAS_AUTOMATION_HISTORY" as const;

export const MSP_HAS_AUTOMATION_HISTORY_MESSAGE =
  "This MSP cannot be deleted because it has protected Zoho automation history or a linked communication context. Preserve the case and retire or reassign its communication context instead.";

export type MspZohoHistoryCounts = {
  zohoAutomationAudits: number;
  zohoCommunicationContexts: number;
  zohoJourneySends: number;
  zohoNudgeDecisions: number;
  zohoOutboxEvents: number;
};

export function hasProtectedMspZohoHistory(plans: Array<{ _count: MspZohoHistoryCounts }>) {
  return plans.some(({ _count }) =>
    _count.zohoAutomationAudits > 0 ||
    _count.zohoCommunicationContexts > 0 ||
    _count.zohoJourneySends > 0 ||
    _count.zohoNudgeDecisions > 0 ||
    _count.zohoOutboxEvents > 0
  );
}

export class MspHasAutomationHistoryError extends Error {
  readonly code = MSP_HAS_AUTOMATION_HISTORY_CODE;

  constructor() {
    super(MSP_HAS_AUTOMATION_HISTORY_MESSAGE);
    this.name = "MspHasAutomationHistoryError";
  }
}
