export const ZOHO_NUDGE_TIMEZONE = "America/Toronto";

type LocalDateTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timezone: string) {
  let value = formatters.get(timezone);
  if (!value) {
    value = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      fractionalSecondDigits: 3
    });
    formatters.set(timezone, value);
  }
  return value;
}

export function getZonedDateTime(timestamp: Date, timezone = ZOHO_NUDGE_TIMEZONE): LocalDateTime {
  const values = Object.fromEntries(
    formatter(timezone).formatToParts(timestamp).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)])
  );
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour === 24 ? 0 : values.hour,
    minute: values.minute,
    second: values.second,
    millisecond: values.fractionalSecond ?? 0
  };
}

function pseudoUtc(parts: LocalDateTime) {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, parts.millisecond);
}

function localDateTimeToInstant(parts: LocalDateTime, timezone: string) {
  let guess = pseudoUtc(parts);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const actual = getZonedDateTime(new Date(guess), timezone);
    const adjustment = pseudoUtc(parts) - pseudoUtc(actual);
    if (adjustment === 0) return new Date(guess);
    guess += adjustment;
  }
  return new Date(guess);
}

function addCalendarDay(parts: LocalDateTime) {
  const value = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1));
  return {
    ...parts,
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate()
  };
}

function isWeekend(parts: Pick<LocalDateTime, "year" | "month" | "day">) {
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  return weekday === 0 || weekday === 6;
}

export function addBusinessDaysPreservingWallClock(
  start: Date,
  businessDays: number,
  timezone = ZOHO_NUDGE_TIMEZONE
) {
  if (!Number.isInteger(businessDays) || businessDays < 0) {
    throw new Error("Business-day threshold must be a non-negative integer.");
  }
  let local = getZonedDateTime(start, timezone);
  let advanced = 0;
  while (advanced < businessDays) {
    local = addCalendarDay(local);
    if (!isWeekend(local)) advanced += 1;
  }
  return localDateTimeToInstant(local, timezone);
}

export function calculateBusinessDayEligibility(input: {
  start: Date;
  thresholdBusinessDays: number;
  evaluationAt: Date;
  timezone?: string;
}) {
  const timezone = input.timezone ?? ZOHO_NUDGE_TIMEZONE;
  const nextEligibleAt = addBusinessDaysPreservingWallClock(
    input.start,
    input.thresholdBusinessDays,
    timezone
  );
  let elapsedBusinessDays = 0;
  if (input.evaluationAt >= input.start) {
    for (let day = 1; day <= 10_000; day += 1) {
      const boundary = addBusinessDaysPreservingWallClock(input.start, day, timezone);
      if (boundary > input.evaluationAt) break;
      elapsedBusinessDays = day;
    }
  }
  const eligible = input.evaluationAt >= nextEligibleAt;
  return {
    eligible,
    elapsedBusinessDays,
    nextEligibleAt,
    explanation: eligible
      ? `${input.thresholdBusinessDays} business-day wall-clock boundaries have elapsed in ${timezone}.`
      : `The ${input.thresholdBusinessDays}-business-day boundary is ${nextEligibleAt.toISOString()}; the next daily run at or after that instant may qualify.`
  };
}

export function getZonedBusinessDate(timestamp: Date, timezone = ZOHO_NUDGE_TIMEZONE) {
  const parts = getZonedDateTime(timestamp, timezone);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function isBusinessDay(timestamp: Date, timezone = ZOHO_NUDGE_TIMEZONE) {
  return !isWeekend(getZonedDateTime(timestamp, timezone));
}

export function isTorontoDailyNudgeWindow(timestamp: Date) {
  const local = getZonedDateTime(timestamp, ZOHO_NUDGE_TIMEZONE);
  return !isWeekend(local) && local.hour === 9;
}
