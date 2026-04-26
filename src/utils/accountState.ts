// Determines whether a Supabase auth user has *ever* used the app before
// (i.e. has a `user_settings` row). This is the authoritative "is new user?"
// signal — much safer than "is the cards/sets/links table empty for this
// user?", which mis-reads "user deleted everything" as "user is new" and
// triggers the localStorage→Supabase migration to re-upload zombie data
// from another device. (See CHANGELOG: "Resurrection-Bug".)
//
// Usage from migration code:
//   if (await isExistingAccount(userId)) {
//     // skip migration entirely — empty table means user deleted, not new
//     localStorage.setItem(migrationKey, '1');
//     return;
//   }
//
// `user_settings` is a perfect signal because `useSettings` upserts a row
// on first load for any new user, so any user who has ever opened the app
// (on any device) will have one. Existence implies "not a brand-new account".

import { supabase } from '../lib/supabase';

/**
 * Returns true if the user has a `user_settings` row in Supabase.
 * Returns false if no row exists.
 * Returns null on network/permissions error — caller should treat as
 * "unknown" and NOT migrate (better to skip migration than to resurrect).
 */
export async function isExistingAccount(userId: string): Promise<boolean | null> {
  const { data, error } = await supabase
    .from('user_settings')
    .select('user_id')
    .eq('user_id', userId)
    .limit(1);
  if (error) {
    console.error('[accountState] failed to check user_settings:', error);
    return null;
  }
  return (data ?? []).length > 0;
}
