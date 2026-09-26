/** Pull phone numbers and emails out of a .vcf contacts export. Nothing else is read. */
export function parseVCard(text: string) {
  const out: string[] = [];
  // vCard lines can be folded onto several lines; unfold first.
  const lines = text.replace(/\r\n[ \t]/g, "").split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^(?:item\d+\.)?(TEL|EMAIL)[^:]*:(.+)$/i);
    if (m) out.push(m[2].trim().replace(/^tel:/i, "").replace(/^mailto:/i, ""));
  }
  return out;
}
