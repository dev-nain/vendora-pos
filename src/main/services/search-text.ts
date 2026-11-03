export function normalizeSearchText(...parts: Array<string | null | undefined>): string {
  return parts
    .filter((part): part is string => typeof part === "string" && part.trim() !== "")
    .join(" ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
