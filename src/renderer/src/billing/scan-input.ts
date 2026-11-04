const codePattern = /^[A-Za-z0-9-]+$/;

export function isCodeLike(text: string): boolean {
  const trimmed = text.trim();
  return codePattern.test(trimmed) && /\d/.test(trimmed);
}

export function notFoundMessage(text: string): string {
  const trimmed = text.trim();
  return isCodeLike(trimmed) ? `Barcode ${trimmed} not found` : `No product matches '${trimmed}'`;
}
