// Admin-Check für Power-User-Features (Invite-Codes, Split-Karten, etc.).
// Single source of truth — wenn das Admin-Konto sich mal ändert, hier
// editieren reicht.

export const ADMIN_EMAIL = 'bastimayr@gmx.at';

export function isAdmin(email: string | undefined | null): boolean {
  return email === ADMIN_EMAIL;
}
