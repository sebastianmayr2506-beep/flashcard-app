// React state wrapper around Google Drive auth + auto-backup logic.
//
// State machine:
//   idle           → no connection, never connected (fresh user)
//   connecting     → OAuth popup is open
//   connected      → access token in memory + persisted "is connected" flag
//   error          → last operation failed; UI shows error message
//
// Auto-backup runs once on first call to `maybeAutoBackup` after the user
// has cards loaded, IF >= AUTO_BACKUP_INTERVAL_HOURS have passed since the
// last successful backup. Persisted across reloads via localStorage.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isGoogleDriveConfigured,
  requestAccessToken,
  revokeAccessToken,
  uploadBackup,
  fetchUserEmail,
  type AccessToken,
} from '../utils/googleDrive';
import type { Flashcard } from '../types/card';
import { exportBackupString } from '../utils/export';

const LS_CONNECTED = 'gdrive:connected';
const LS_EMAIL = 'gdrive:email';
const LS_LAST_BACKUP_AT = 'gdrive:lastBackupAt';   // epoch ms
const LS_LAST_BACKUP_NAME = 'gdrive:lastBackupName';
const LS_AUTO_ENABLED = 'gdrive:autoEnabled';

const AUTO_BACKUP_INTERVAL_HOURS = 18; // run once when 18+ hours since last upload

export interface GoogleDriveState {
  configured: boolean;       // is VITE_GOOGLE_CLIENT_ID set
  connected: boolean;
  connecting: boolean;
  email: string | null;
  lastBackupAt: number | null;
  lastBackupName: string | null;
  autoEnabled: boolean;
  busy: boolean;             // a backup is currently in flight
  error: string | null;
}

export interface GoogleDriveActions {
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  backupNow: (cards: Flashcard[]) => Promise<void>;
  setAutoEnabled: (enabled: boolean) => void;
  /**
   * Called from App after cards finish loading. No-ops if:
   *  - not connected
   *  - auto disabled
   *  - <18h since last backup
   *  - cards.length === 0 (don't overwrite legitimate empty state)
   *  - already running
   */
  maybeAutoBackup: (cards: Flashcard[]) => Promise<void>;
}

export function useGoogleDrive(
  showToast?: (msg: string, type?: 'success' | 'error' | 'info') => void,
): GoogleDriveState & GoogleDriveActions {
  // Persisted bits — initialize lazily from localStorage so re-mounts don't flicker
  const [connected, setConnected] = useState<boolean>(() => localStorage.getItem(LS_CONNECTED) === '1');
  const [email, setEmail] = useState<string | null>(() => localStorage.getItem(LS_EMAIL));
  const [lastBackupAt, setLastBackupAt] = useState<number | null>(() => {
    const raw = localStorage.getItem(LS_LAST_BACKUP_AT);
    const n = raw ? parseInt(raw, 10) : NaN;
    return isNaN(n) ? null : n;
  });
  const [lastBackupName, setLastBackupName] = useState<string | null>(() => localStorage.getItem(LS_LAST_BACKUP_NAME));
  const [autoEnabled, setAutoEnabledState] = useState<boolean>(() => localStorage.getItem(LS_AUTO_ENABLED) !== '0');

  const [connecting, setConnecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Access token kept in-memory only (never persisted). Refreshed silently
  // via GIS when expired.
  const tokenRef = useRef<AccessToken | null>(null);
  // Re-entrancy guard for auto-backup so a slow upload doesn't get retriggered
  const autoRunningRef = useRef(false);

  const persistConnected = (v: boolean) => {
    if (v) localStorage.setItem(LS_CONNECTED, '1');
    else localStorage.removeItem(LS_CONNECTED);
  };

  const persistEmail = (v: string | null) => {
    if (v) localStorage.setItem(LS_EMAIL, v);
    else localStorage.removeItem(LS_EMAIL);
  };

  const persistLastBackup = (at: number, name: string) => {
    localStorage.setItem(LS_LAST_BACKUP_AT, String(at));
    localStorage.setItem(LS_LAST_BACKUP_NAME, name);
    setLastBackupAt(at);
    setLastBackupName(name);
  };

  /** Get a valid access token, refreshing silently if needed. */
  const ensureToken = useCallback(async (interactive: boolean): Promise<string> => {
    const cur = tokenRef.current;
    if (cur && cur.expires_at - 60_000 > Date.now()) {
      return cur.access_token;
    }
    const fresh = await requestAccessToken({ interactive });
    tokenRef.current = fresh;
    return fresh.access_token;
  }, []);

  const connect = useCallback(async () => {
    if (!isGoogleDriveConfigured()) {
      setError('Google Client ID nicht konfiguriert');
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      const token = await ensureToken(true);
      // Try to fetch email — non-fatal if it fails
      const e = await fetchUserEmail(token);
      setEmail(e);
      persistEmail(e);
      setConnected(true);
      persistConnected(true);
      showToast?.('✅ Mit Google Drive verbunden', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      showToast?.(`Verbindung fehlgeschlagen: ${msg}`, 'error');
    } finally {
      setConnecting(false);
    }
  }, [ensureToken, showToast]);

  const disconnect = useCallback(async () => {
    if (tokenRef.current) {
      try { await revokeAccessToken(tokenRef.current.access_token); }
      catch (err) { console.warn('[gdrive] revoke failed:', err); }
    }
    tokenRef.current = null;
    setConnected(false);
    persistConnected(false);
    setEmail(null);
    persistEmail(null);
    showToast?.('Google Drive getrennt', 'info');
  }, [showToast]);

  const backupNow = useCallback(async (cards: Flashcard[]) => {
    if (!connected) {
      showToast?.('Erst Google Drive verbinden', 'error');
      return;
    }
    if (cards.length === 0) {
      showToast?.('Keine Karten zum Sichern', 'info');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const token = await ensureToken(false); // silent
      const json = exportBackupString(cards);
      const result = await uploadBackup(token, json);
      persistLastBackup(Date.now(), result.fileName);
      const cleanupHint = result.cleanedUp > 0 ? ` · ${result.cleanedUp} alte gelöscht` : '';
      showToast?.(`💾 Backup hochgeladen: ${result.fileName}${cleanupHint}`, 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      // If the silent token request failed, the user likely revoked access in Drive
      if (msg.includes('popup') || msg.includes('access_denied')) {
        setConnected(false);
        persistConnected(false);
        showToast?.('Zugriff abgelaufen — bitte neu verbinden', 'error');
      } else {
        showToast?.(`Backup fehlgeschlagen: ${msg}`, 'error');
      }
    } finally {
      setBusy(false);
    }
  }, [connected, ensureToken, showToast]);

  const maybeAutoBackup = useCallback(async (cards: Flashcard[]) => {
    if (!connected || !autoEnabled) return;
    if (cards.length === 0) return;
    if (autoRunningRef.current || busy) return;

    const last = lastBackupAt ?? 0;
    const hoursSince = (Date.now() - last) / 3_600_000;
    if (hoursSince < AUTO_BACKUP_INTERVAL_HOURS) return;

    autoRunningRef.current = true;
    try {
      // Don't show a toast for auto-backup unless something interesting happens —
      // we don't want to spam "Backup OK" every time the user opens the app.
      const token = await ensureToken(false); // silent — no popup
      const json = exportBackupString(cards);
      const result = await uploadBackup(token, json);
      persistLastBackup(Date.now(), result.fileName);
      console.info('[gdrive] auto-backup ok:', result.fileName);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[gdrive] auto-backup failed:', msg);
      // Silent failure for auto path — don't bother user. Manual backup still
      // surfaces errors loudly. If silent token failed, mark disconnected so
      // the Settings UI shows a "reconnect" hint on next visit.
      if (msg.includes('access_denied') || msg.includes('idpiframe')) {
        setConnected(false);
        persistConnected(false);
      }
    } finally {
      autoRunningRef.current = false;
    }
  }, [connected, autoEnabled, busy, lastBackupAt, ensureToken]);

  const setAutoEnabled = useCallback((enabled: boolean) => {
    setAutoEnabledState(enabled);
    localStorage.setItem(LS_AUTO_ENABLED, enabled ? '1' : '0');
  }, []);

  // If user reopens the app with a connected flag set, attempt a silent token
  // refresh so subsequent operations don't show a popup. Best effort.
  useEffect(() => {
    if (!connected) return;
    if (!isGoogleDriveConfigured()) return;
    let cancelled = false;
    (async () => {
      try { await ensureToken(false); }
      catch (err) {
        if (cancelled) return;
        console.warn('[gdrive] silent refresh failed on mount:', err);
        // Don't auto-disconnect — the user might come back to Settings and click
        // "Backup now" which will then prompt interactively.
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    configured: isGoogleDriveConfigured(),
    connected,
    connecting,
    email,
    lastBackupAt,
    lastBackupName,
    autoEnabled,
    busy,
    error,
    connect,
    disconnect,
    backupNow,
    setAutoEnabled,
    maybeAutoBackup,
  };
}
