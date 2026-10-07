export type AccessRole = "owner" | "admin" | "member";
export type SenderMode = "organization_email" | "personal_email";

export type MailSettings = {
  admin_sender_mode: SenderMode;
  member_sender_mode: SenderMode;
  auto_cc_organization_email: boolean;
  allow_member_to_disable_cc: boolean;
};

export function senderModeForRole(role: AccessRole, settings: MailSettings): SenderMode {
  return role === "member" ? settings.member_sender_mode : settings.admin_sender_mode;
}

export function enforcedCc(input: {
  role: AccessRole;
  settings: MailSettings;
  organizationEmail: string | null;
  requestedCc: string[];
  disableOrganizationCc: boolean;
}) {
  const cc = new Set(input.requestedCc.map((email) => email.trim().toLowerCase()).filter(Boolean));
  if (input.role === "member" && input.settings.auto_cc_organization_email && input.organizationEmail) {
    const mayDisable = input.settings.allow_member_to_disable_cc && input.disableOrganizationCc;
    if (!mayDisable) cc.add(input.organizationEmail.toLowerCase());
  }
  return [...cc];
}

export function canManageOrganization(role: AccessRole) {
  return role === "owner" || role === "admin";
}

export function canManageRoles(role: AccessRole) {
  return role === "owner";
}

export type GoogleConnectionSummary = { google_email: string; status: string } | null | undefined;
export type SenderState = "ready" | "not_connected" | "needs_reconnect";
export type SenderStatus = {
  mode: SenderMode;
  email: string | null;
  state: SenderState;
  /** Who can fix a broken sender: organization senders need an owner/admin, personal senders the member themself. */
  fixableBy: "manager" | "self";
};

/**
 * Single source of truth for "which Gmail account will this member send from, and can it send right now".
 * Used by both the settings API (for the UI) and the send API, so the screen and the server never disagree.
 */
export function resolveSender(input: {
  role: AccessRole;
  settings: MailSettings;
  organizationGoogle: GoogleConnectionSummary;
  userGoogle: GoogleConnectionSummary;
}): SenderStatus {
  const mode = senderModeForRole(input.role, input.settings);
  const connection = mode === "organization_email" ? input.organizationGoogle : input.userGoogle;
  const fixableBy = mode === "organization_email" ? "manager" : "self";
  if (!connection) return { mode, email: null, state: "not_connected", fixableBy };
  return { mode, email: connection.google_email, state: connection.status === "active" ? "ready" : "needs_reconnect", fixableBy };
}

/** Google returns invalid_grant when a refresh token was revoked, expired, or the password changed. */
export function isGoogleReauthError(error: unknown) {
  const e = error as { message?: unknown; response?: { data?: { error?: unknown } } } | null;
  const code = e?.response?.data?.error;
  return code === "invalid_grant" || (typeof e?.message === "string" && e.message.includes("invalid_grant"));
}

/** Owners/admins can edit any contact; a member can edit the contacts they registered themselves (to fix their own OCR/typing mistakes). */
export function canEditContact(member: { id: string; access_role: string }, contact: { created_by: string | null }) {
  return member.access_role === "owner" || member.access_role === "admin" || (contact.created_by !== null && contact.created_by === member.id);
}
