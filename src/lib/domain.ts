import { z } from "zod";

export const classifications = ["important", "courtesy", "undecided", "no_contact"] as const;
export type Classification = (typeof classifications)[number];

export const contactSchema = z.object({
  name: z.string().trim().min(1, "氏名を入力してください").max(120),
  company: z.string().trim().max(200),
  role: z.string().trim().max(120),
  email: z.string().trim().toLowerCase().email("メールアドレスの形式を確認してください"),
  phone: z.string().trim().max(40),
  address: z.string().trim().max(400),
  website: z.union([z.literal(""), z.string().url("URLの形式を確認してください")]),
  notes: z.string().trim().max(3000),
});
export type ContactInput = z.infer<typeof contactSchema>;

/** Quick capture mode: email is optional (empty string allowed) */
export const quickContactSchema = z.object({
  name: z.string().trim().min(1, "氏名を入力してください").max(120),
  company: z.string().trim().max(200),
  role: z.string().trim().max(120),
  email: z.union([z.literal(""), z.string().trim().toLowerCase().email("メールアドレスの形式を確認してください")]),
  phone: z.string().trim().max(40),
  address: z.string().trim().max(400),
  website: z.union([z.literal(""), z.string().url("URLの形式を確認してください")]),
  notes: z.string().trim().max(3000),
});

export const mailSchema = z.object({
  contactId: z.string().uuid(),
  recipientEmail: z.string().trim().toLowerCase().email(),
  subject: z.string().trim().min(1).max(180),
  body: z.string().trim().min(1).max(20000),
  cc: z.array(z.string().trim().toLowerCase().email()).max(20).default([]),
  bcc: z.array(z.string().trim().toLowerCase().email()).max(20).default([]),
  disableOrganizationCc: z.boolean().default(false),
  templateId: z.string().uuid().nullable(),
  eventId: z.string().uuid().nullable(),
  classification: z.literal("courtesy"),
  confirmedRecipient: z.literal(true),
  confirmationToken: z.string().min(20),
  idempotencyKey: z.string().uuid(),
  duplicateOverride: z.boolean(),
  duplicateOverrideReason: z.string().max(300).nullable(),
}).superRefine((value, ctx) => {
  if (value.duplicateOverride && !value.duplicateOverrideReason?.trim()) ctx.addIssue({ code: "custom", path: ["duplicateOverrideReason"], message: "重複警告を無視する理由が必要です" });
});

export type ExistingContactSnapshot = { name: string; company: string; role: string; email: string; phone: string; address: string; website: string };
export type DuplicateCandidate = { strength: "strong" | "possible"; reason: "email" | "phone" | "name_company"; contactName: string; contactId?: string; existing?: ExistingContactSnapshot; senderName?: string; sentAt?: string; eventName?: string };
export type MergeMode = "overwrite" | "append";

const digits = (value: string) => value.replace(/\D/g, "");
const text = (value: string) => value.normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase("ja-JP");

export function findDuplicates(input: Pick<ContactInput, "email" | "phone" | "name" | "company">, existing: Array<Pick<ContactInput, "email" | "phone" | "name" | "company"> & { id?: string; existing?: ExistingContactSnapshot; senderName?: string; sentAt?: string; eventName?: string }>): DuplicateCandidate[] {
  const matches: DuplicateCandidate[] = [];
  for (const candidate of existing) {
    const ref = { contactName: candidate.name, contactId: candidate.id, existing: candidate.existing };
    if (input.email && candidate.email && candidate.email.toLowerCase() === input.email.toLowerCase()) matches.push({ strength: "strong", reason: "email", ...ref, senderName: candidate.senderName, sentAt: candidate.sentAt, eventName: candidate.eventName });
    else if (digits(input.phone).length >= 7 && digits(candidate.phone) === digits(input.phone)) matches.push({ strength: "possible", reason: "phone", ...ref });
    else if (text(input.name) === text(candidate.name) && text(input.company) === text(candidate.company)) matches.push({ strength: "possible", reason: "name_company", ...ref });
  }
  // Strongest match first, one entry per contact.
  const seen = new Set<string>();
  return matches.sort((a, b) => (a.strength === b.strength ? 0 : a.strength === "strong" ? -1 : 1)).filter((m) => !m.contactId || (!seen.has(m.contactId) && seen.add(m.contactId)));
}

export function renderTemplate(template: string, variables: Record<string, string>) {
  return template.replace(/{{([a-z_]+)}}/g, (_, key: string) => variables[key] ?? "");
}
