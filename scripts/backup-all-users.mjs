// @ts-check
/**
 * Admin-Backup-Script: zieht für JEDEN registrierten User ein komplettes
 * Backup aller Karten + Lernfortschritt + Settings + Sets + Links + Flag-
 * Attempts + Card-Chats.
 *
 * Verwendet den SUPABASE_SERVICE_ROLE_KEY — bypassed RLS, sieht alle Daten
 * aller User. NIEMALS in Frontend oder Git committen.
 *
 * Output: backups/YYYY-MM-DD_HH-MM/<email>.json  (eine Datei pro User)
 *
 * Ausführen:
 *   npm run backup:admin
 *
 * Setup (einmalig):
 *   1. .env.local im Repo-Root anlegen (ist via .gitignore geschützt)
 *   2. Folgende Variablen reinpacken:
 *        VITE_SUPABASE_URL=https://<projekt>.supabase.co
 *        SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
 *      Den Service-Role-Key findest du in:
 *        Supabase Dashboard → Project Settings → API → service_role secret
 *      (NICHT der anon-Key — der hat keine Admin-Rechte!)
 *
 * Wann nutzen:
 *   - Vor jeder geplanten globalen Migration
 *   - Wenn ein User Daten verloren hat und wiederherstellen will
 *   - Wöchentliche Routine als Sicherheits-Net über Supabase's daily backup
 *
 * Reines Node-Script (.mjs) — keine extra deps. .env.local wird via
 * Node's eingebautem --env-file Flag geladen (siehe npm script).
 */

import { createClient } from '@supabase/supabase-js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const URL = process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !KEY) {
  console.error('❌ Fehlende env vars. .env.local braucht:');
  console.error('   VITE_SUPABASE_URL=...');
  console.error('   SUPABASE_SERVICE_ROLE_KEY=...');
  console.error('Stell auch sicher dass das npm-Script mit --env-file=.env.local läuft.');
  process.exit(1);
}

const admin = createClient(URL, KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
  const outDir = join('backups', ts);
  mkdirSync(outDir, { recursive: true });

  console.log(`📦 Admin-Backup → ${outDir}`);
  console.log('Lade User-Liste…');

  // Alle Auth-User holen (paginiert um Limits zu vermeiden)
  const users = [];
  let page = 1;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw new Error(`auth.admin.listUsers fehlgeschlagen: ${error.message}`);
    if (!data?.users?.length) break;
    for (const u of data.users) users.push({ id: u.id, email: u.email ?? null });
    if (data.users.length < 100) break;
    page++;
  }
  console.log(`→ ${users.length} User gefunden`);

  const summaries = [];

  for (const user of users) {
    const label = user.email ?? user.id;
    console.log(`\n👤 ${label}`);

    // Karten (paginiert)
    const cards = [];
    {
      let from = 0;
      const PAGE = 1000;
      while (true) {
        const { data, error } = await admin
          .from('cards').select('*').eq('user_id', user.id)
          .range(from, from + PAGE - 1);
        if (error) throw new Error(`cards für ${label}: ${error.message}`);
        cards.push(...(data ?? []));
        if ((data ?? []).length < PAGE) break;
        from += PAGE;
      }
    }

    // Settings (Single Row)
    const { data: settings } = await admin
      .from('user_settings').select('*').eq('user_id', user.id).maybeSingle();

    // Sets
    const { data: sets } = await admin
      .from('sets').select('*').eq('user_id', user.id);

    // Card Links
    const { data: links } = await admin
      .from('card_links').select('*').eq('user_id', user.id);

    // Flag Attempts
    const { data: flagAttempts } = await admin
      .from('flag_attempts').select('*').eq('user_id', user.id);

    // Card Chats
    const { data: chats } = await admin
      .from('card_chats').select('*').eq('user_id', user.id);

    const payload = {
      _meta: {
        backedUpAt: new Date().toISOString(),
        userId: user.id,
        email: user.email,
        counts: {
          cards: cards.length,
          sets: sets?.length ?? 0,
          links: links?.length ?? 0,
          flagAttempts: flagAttempts?.length ?? 0,
          chats: chats?.length ?? 0,
        },
      },
      cards,
      user_settings: settings ?? null,
      sets: sets ?? [],
      card_links: links ?? [],
      flag_attempts: flagAttempts ?? [],
      card_chats: chats ?? [],
    };

    const safeEmail = (user.email ?? user.id).replace(/[^a-z0-9@._-]/gi, '_');
    const filename = `${safeEmail}.json`;
    writeFileSync(join(outDir, filename), JSON.stringify(payload, null, 2));
    console.log(`   ✓ ${cards.length} cards, ${sets?.length ?? 0} sets, ${links?.length ?? 0} links, ${flagAttempts?.length ?? 0} flag-attempts, ${chats?.length ?? 0} chats → ${filename}`);

    summaries.push({
      id: user.id,
      email: user.email,
      cards: cards.length,
      sets: sets?.length ?? 0,
      links: links?.length ?? 0,
      flagAttempts: flagAttempts?.length ?? 0,
      chats: chats?.length ?? 0,
    });
  }

  // Summary-Datei zur Übersicht
  writeFileSync(
    join(outDir, '_summary.json'),
    JSON.stringify({ backedUpAt: new Date().toISOString(), users: summaries }, null, 2),
  );

  console.log(`\n✅ Backup fertig. ${users.length} User exportiert nach ${outDir}/`);
  console.log(`   Karten gesamt: ${summaries.reduce((s, u) => s + u.cards, 0)}`);
}

main().catch(err => {
  console.error('❌ Backup fehlgeschlagen:', err);
  process.exit(1);
});
