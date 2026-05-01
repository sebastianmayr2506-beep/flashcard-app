// Google Drive integration for daily backup uploads.
//
// Auth model: Google Identity Services (GIS) — modern browser OAuth.
// We get short-lived (1h) access tokens, refresh silently when needed.
// No refresh tokens stored (would require server-side handling); the user's
// browser handles re-auth invisibly via the GIS token client.
//
// Scope: drive.file ONLY — the app sees only files it created. Files
// uploaded by other apps or the user manually are invisible to us, so
// even a compromised token can't exfiltrate the user's other Drive data.
//
// File layout:
//   - One folder named "Sebi AI Flashcard Backups" at the user's Drive root
//   - Backup files inside: `flashcards-backup-YYYY-MM-DD.json`
//   - Same-day uploads overwrite (we delete the old file first)

/* eslint-disable @typescript-eslint/no-explicit-any */

// drive.file = only files this app creates (NOT all of user's Drive — much safer)
// email     = lets us show "verbunden als foo@bar.com" in Settings
const SCOPES = 'https://www.googleapis.com/auth/drive.file email';
const FOLDER_NAME = 'Sebi AI Flashcard Backups';
const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client';

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

let gisLoadPromise: Promise<void> | null = null;
let tokenClient: any = null;

export interface AccessToken {
  access_token: string;
  /** Epoch ms when this token expires */
  expires_at: number;
}

export function isGoogleDriveConfigured(): boolean {
  return !!CLIENT_ID && CLIENT_ID.length > 10;
}

/**
 * Loads the Google Identity Services client script once. Subsequent calls
 * return the same promise, so it's cheap to call repeatedly.
 */
function loadGis(): Promise<void> {
  if (gisLoadPromise) return gisLoadPromise;
  gisLoadPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined') { reject(new Error('No window')); return; }
    if ((window as any).google?.accounts?.oauth2) { resolve(); return; }
    const existing = document.querySelector(`script[src="${GIS_SCRIPT_URL}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Failed to load GIS')));
      return;
    }
    const script = document.createElement('script');
    script.src = GIS_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Identity Services'));
    document.head.appendChild(script);
  });
  return gisLoadPromise;
}

/** Initialise (or reuse) the GIS token client. Idempotent. */
async function getTokenClient(): Promise<any> {
  if (!CLIENT_ID) throw new Error('VITE_GOOGLE_CLIENT_ID nicht konfiguriert');
  await loadGis();
  if (tokenClient) return tokenClient;
  const google = (window as any).google;
  if (!google?.accounts?.oauth2) throw new Error('Google Identity Services konnte nicht geladen werden');
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    // The actual handler is set per-request via overrideHandler below
    callback: () => { /* set per-request */ },
  });
  return tokenClient;
}

/**
 * Request an access token. With `prompt: ''` this is silent if the user
 * has previously granted access — perfect for daily auto-backups. With
 * `prompt: 'consent'` it shows the OAuth popup (initial connect).
 */
export async function requestAccessToken(opts: { interactive: boolean }): Promise<AccessToken> {
  const client = await getTokenClient();
  return new Promise((resolve, reject) => {
    client.callback = (response: any) => {
      if (response.error) {
        reject(new Error(response.error_description || response.error));
        return;
      }
      const expiresIn = parseInt(response.expires_in ?? '3600', 10);
      resolve({
        access_token: response.access_token,
        expires_at: Date.now() + expiresIn * 1000,
      });
    };
    try {
      client.requestAccessToken({ prompt: opts.interactive ? 'consent' : '' });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/** Revoke the current token — used by Disconnect. */
export async function revokeAccessToken(token: string): Promise<void> {
  await loadGis();
  const google = (window as any).google;
  return new Promise(resolve => {
    google?.accounts?.oauth2?.revoke(token, () => resolve());
  });
}

// ─── Drive REST helpers ────────────────────────────────────────────────────

async function driveFetch(token: string, path: string, init: RequestInit = {}): Promise<any> {
  const url = path.startsWith('http') ? path : `https://www.googleapis.com${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    let detail = `Drive ${res.status}`;
    try { const json = await res.json(); detail = json.error?.message || detail; }
    catch { /* ignore */ }
    throw new Error(detail);
  }
  // 204 etc. → no body
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

/** Find existing app folder, or create one. Returns folder ID. */
async function ensureBackupFolder(token: string): Promise<string> {
  // Search for folder by name + mimeType (exclude trashed)
  const q = encodeURIComponent(`name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const search = await driveFetch(token, `/drive/v3/files?q=${q}&fields=files(id,name)`);
  if (search.files?.length > 0) return search.files[0].id;

  // Create
  const created = await driveFetch(token, '/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  });
  return created.id;
}

/** List files inside the backup folder (with name + createdTime + id). */
async function listBackups(token: string, folderId: string): Promise<Array<{ id: string; name: string; createdTime: string }>> {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const data = await driveFetch(
    token,
    `/drive/v3/files?q=${q}&fields=files(id,name,createdTime)&orderBy=createdTime desc&pageSize=200`,
  );
  return data.files ?? [];
}

/** Delete a single file by id. Errors are swallowed (best-effort cleanup). */
async function deleteFile(token: string, fileId: string): Promise<void> {
  try {
    await driveFetch(token, `/drive/v3/files/${fileId}`, { method: 'DELETE' });
  } catch (err) {
    console.warn('[googleDrive] failed to delete', fileId, err);
  }
}

export interface UploadResult {
  /** Drive file ID of the just-uploaded file */
  fileId: string;
  /** File name as stored in Drive */
  fileName: string;
  /** Total backups currently in the folder after this upload */
  totalBackups: number;
  /** How many old backups got cleaned up */
  cleanedUp: number;
}

/**
 * Upload a JSON backup. If a same-day backup exists, replace it.
 * Cleans up backups older than `maxAgeDays` (default 30).
 */
export async function uploadBackup(
  token: string,
  jsonContent: string,
  opts: { maxAgeDays?: number } = {},
): Promise<UploadResult> {
  const maxAgeDays = opts.maxAgeDays ?? 30;
  const folderId = await ensureBackupFolder(token);

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const fileName = `flashcards-backup-${today}.json`;

  // If a same-day backup already exists, delete it (we'll re-upload fresh)
  const existing = await listBackups(token, folderId);
  for (const f of existing) {
    if (f.name === fileName) await deleteFile(token, f.id);
  }

  // Multipart upload — one request, JSON metadata + file content
  const boundary = `----flashcardbackup${Date.now()}`;
  const metadata = {
    name: fileName,
    parents: [folderId],
    mimeType: 'application/json',
  };
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    `${jsonContent}\r\n` +
    `--${boundary}--`;

  const uploaded = await driveFetch(
    token,
    '/upload/drive/v3/files?uploadType=multipart&fields=id,name',
    {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    },
  );

  // Cleanup: delete files older than maxAgeDays
  let cleanedUp = 0;
  const cutoff = Date.now() - maxAgeDays * 86400_000;
  const after = await listBackups(token, folderId);
  for (const f of after) {
    const created = new Date(f.createdTime).getTime();
    if (!isNaN(created) && created < cutoff && f.id !== uploaded.id) {
      await deleteFile(token, f.id);
      cleanedUp++;
    }
  }

  return {
    fileId: uploaded.id,
    fileName: uploaded.name,
    totalBackups: after.length - cleanedUp,
    cleanedUp,
  };
}

/** Decode the user's email from the token's `userinfo.email` endpoint. */
export async function fetchUserEmail(token: string): Promise<string | null> {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.email === 'string' ? data.email : null;
  } catch {
    return null;
  }
}
