import "server-only";

// Contact-form department -> inbox routing. SERVER-ONLY: the client submits a
// department KEY ("support"); the API route maps it to an address here. The
// client never names a destination, so the form can't be used as an open email
// relay. Labels live in the dictionary (dict.contact.departments), keyed the
// same way. dev@ and finance@ are intentionally NOT exposed.
export const DEPARTMENT_EMAILS = {
  general: "contact@taqreer.ai",
  sales: "contact@taqreer.ai",
  billing: "billing@taqreer.ai",
  support: "support@taqreer.ai",
} as const;

export type DepartmentKey = keyof typeof DEPARTMENT_EMAILS;

// English labels for the OUTGOING email subject/body (internal, to our team),
// independent of the visitor's UI locale. The dropdown labels (localized) live
// in dict.contact.departments.
export const DEPARTMENT_LABELS_EN: Record<DepartmentKey, string> = {
  general: "General inquiry",
  sales: "Sales & pricing",
  billing: "Billing & payments",
  support: "Support & bug report",
};

export function isDepartment(key: unknown): key is DepartmentKey {
  // own-property check (NOT `in`, which would let prototype keys like
  // "constructor" / "__proto__" pass the guard).
  return (
    typeof key === "string" &&
    Object.prototype.hasOwnProperty.call(DEPARTMENT_EMAILS, key)
  );
}
