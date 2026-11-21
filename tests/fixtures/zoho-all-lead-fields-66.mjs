const requiredFields = [
  ["Contact Email", "contact_email", "email", "standard"],
  ["First Name", "firstname", "text", "standard"],
  ["Last Name", "lastname", "text", "standard"],
  ["Plan ID", "CONTACT_CF1", "text", "custom"],
  ["Next Task ID", "CONTACT_CF2", "text", "custom"],
  ["Next Task Title", "CONTACT_CF3", "text", "custom"],
  ["SE Name", "CONTACT_CF4", "text", "custom"],
  ["Portal URL", "CONTACT_CF5", "url", "custom"],
  ["Next Task Link", "CONTACT_CF6", "url", "custom"],
  ["SE Booking URL", "CONTACT_CF7", "url", "custom"],
  ["SE Email", "CONTACT_CF8", "email", "custom"],
  ["Tenant Type", "CONTACT_CF9", "picklist", "custom"],
  ["Onboarding Role", "CONTACT_CF10", "picklist", "custom"],
  ["Onboarding State", "CONTACT_CF11", "picklist", "custom"],
  ["Next Task Owner", "CONTACT_CF12", "picklist", "custom"],
  ["Next Task Status", "CONTACT_CF13", "picklist", "custom"],
  ["Current Phase", "CONTACT_CF14", "picklist", "custom"],
  ["Next Task Guide URL", "CONTACT_CF15", "url", "custom"],
  ["Next Task Minutes", "CONTACT_CF16", "integer", "custom"],
  ["Apps Approved", "CONTACT_CF17", "integer", "custom"],
  ["Apps Submitted", "CONTACT_CF18", "integer", "custom"],
  ["Next Task Since", "CONTACT_CF26", "datetime", "custom"],
  ["Last SE Touch", "CONTACT_CF27", "datetime", "custom"],
  ["Last MSP Activity", "CONTACT_CF28", "datetime", "custom"],
  ["Nudge Status", "CONTACT_CF31", "text", "custom"],
  ["Next Task Tip", "CONTACT_CF32", "text", "custom"],
  ["Onboarding Progress", "CONTACT_CF116", "percent", "custom"],
  ["Next Task Tip (Old - Date)", "CONTACT_CF29", "date", "custom"]
];

const unrelatedFields = Array.from({ length: 38 }, (_, index) => [
  `Sanitized Unrelated Field ${String(index + 1).padStart(2, "0")}`,
  `SANITIZED_FIELD_${index + 1}`,
  "text",
  "custom"
]);

export const zohoAllLeadFields66Response = {
  response: {
    code: "0",
    fieldnames: {
      fieldname: [...requiredFields, ...unrelatedFields].map(
        ([displayName, fieldName, uiType, type], index) => ({
          DISPLAY_NAME: displayName,
          FIELD_ID: displayName === "Next Task Tip" ? "1329658000000112002" : `sanitized-${index + 1}`,
          FIELD_NAME: fieldName,
          TYPE: type,
          UITYPE: uiType,
          is_otheruser_field: false
        })
      )
    }
  }
};
