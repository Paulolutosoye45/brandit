import type { TemplateKey } from '../content/messages';
/** The name the WhatsApp template is submitted under (see WHATSAPP_TEMPLATES.md). Same rule as lib/messages.ts, kept free of the database so the console can import it anywhere. */
export const whatsappName = (key: TemplateKey) => `brandit_${key}`;
