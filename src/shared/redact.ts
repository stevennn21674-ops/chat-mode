export function redact(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._\-+/=]+/gi, 'Bearer [redacted]')
    .replace(/\bsk-[A-Za-z0-9_\-]{6,}\b/g, '[redacted]')
}
