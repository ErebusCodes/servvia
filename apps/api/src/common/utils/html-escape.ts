/**
 * Encodes a value for HTML text or a quoted attribute: & < > " ' become
 * entities (the same set escape-html encodes). Every value interpolated into
 * an HTML email must pass through this, because guest-supplied text (a
 * reservation name) reaches those templates (Story 2.7, audit section 4.9).
 * It is not for URLs, scripts or CSS, which have their own contexts.
 */
const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (c) => HTML_ENTITIES[c]);
}
