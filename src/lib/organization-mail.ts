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
