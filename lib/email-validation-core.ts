const EMAIL_PATTERN = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i;

export function isValidEmailAddress(value: string) {
  return EMAIL_PATTERN.test(value.trim());
}

export function normalizeRequiredEmailValue(value: unknown, label = "Email address") {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  const email = value.trim();
  if (email.length > 320 || !isValidEmailAddress(email)) {
    throw new Error(`Enter a valid ${label.toLowerCase()}.`);
  }
  return email;
}

export function normalizeChangedRequiredEmailValue(
  value: unknown,
  currentValue: string,
  label = "Email address"
) {
  if (value === undefined || value === currentValue) return undefined;
  return normalizeRequiredEmailValue(value, label);
}
