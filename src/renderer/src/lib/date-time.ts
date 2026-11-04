const dateTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Karachi",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((candidate) => candidate.type === type)?.value ?? "";
}

export function formatTime(iso: string): string {
  const parts = dateTime.formatToParts(new Date(iso));
  return `${part(parts, "hour")}:${part(parts, "minute")} ${part(parts, "dayPeriod").toLowerCase()}`;
}

export function formatDateTime(iso: string): string {
  const parts = dateTime.formatToParts(new Date(iso));
  return `${part(parts, "day")} ${part(parts, "month")} ${part(parts, "year")}, ${formatTime(iso)}`;
}
