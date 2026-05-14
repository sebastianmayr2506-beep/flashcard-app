import { useState, useEffect, useCallback, useRef } from 'react';
import type { AppSettings } from '../types/card';
import { DEFAULT_SUBJECTS, DEFAULT_EXAMINERS } from '../types/card';
import { supabase } from '../lib/supabase';
import { getSettings as getLocalSettings } from '../utils/storage';

const defaultSettings: AppSettings = {
  subjects: DEFAULT_SUBJECTS,
  examiners: DEFAULT_EXAMINERS,
  customTags: [],
  studyStreak: 0,
  lastStudiedDate: null,
  dailyNewCardGoal: 10,
  dailyReviewCap: 9999,
  autoUnflagEnabled: true,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fromDb(row: Record<string, any>): AppSettings {
  return {
    subjects: row.subjects ?? DEFAULT_SUBJECTS,
    examiners: row.examiners ?? DEFAULT_EXAMINERS,
    customTags: row.custom_tags ?? [],
    studyStreak: row.study_streak ?? 0,
    lastStudiedDate: row.last_studied_date ?? null,
    examDate: row.exam_date ?? undefined,
    dailyNewCardGoal: row.daily_new_card_goal ?? 10,
    dailyNewCardGoalMode: (row.daily_new_card_goal_mode === 'auto' || row.daily_new_card_goal_mode === 'manual') ? row.daily_new_card_goal_mode : 'manual',
    dailyReviewCap: row.daily_review_cap ?? 9999,
    dailyPlanSnapshot: row.daily_plan_snapshot ?? undefined,
    autoUnflagEnabled: row.auto_unflag_enabled ?? true,
    autoUnflagNotification: row.auto_unflag_notification ?? undefined,
    focusMode: (row.focus_mode === 'A' || row.focus_mode === 'AB' || row.focus_mode === 'all') ? row.focus_mode : 'all',
    // API keys sync across devices via user_settings. localStorage stays as a
    // fallback so users who entered keys before the migration aren't suddenly
    // locked out — fromDb prefers Supabase, but falls back if the DB column
    // is empty. A separate migration step in load() then uploads the
    // localStorage value to Supabase so it propagates to all devices.
    anthropicApiKey: ((typeof row.anthropic_api_key === 'string' && row.anthropic_api_key) || localStorage.getItem('anthropic_api_key')) ?? undefined,
    geminiApiKey:    ((typeof row.gemini_api_key === 'string' && row.gemini_api_key)       || localStorage.getItem('gemini_api_key')) ?? undefined,
    groqApiKey:      ((typeof row.groq_api_key === 'string' && row.groq_api_key)           || localStorage.getItem('groq_api_key')) ?? undefined,
    pausedSession: (row.paused_session && typeof row.paused_session === 'object') ? row.paused_session : undefined,
  };
}

function toDb(settings: AppSettings, userId: string) {
  return {
    user_id: userId,
    subjects: settings.subjects,
    examiners: settings.examiners,
    custom_tags: settings.customTags,
    study_streak: settings.studyStreak,
    last_studied_date: settings.lastStudiedDate ?? null,
    exam_date: settings.examDate ?? null,
    daily_new_card_goal: settings.dailyNewCardGoal,
    daily_new_card_goal_mode: settings.dailyNewCardGoalMode ?? null,
    daily_review_cap: settings.dailyReviewCap ?? 9999,
    daily_plan_snapshot: settings.dailyPlanSnapshot ?? null,
    auto_unflag_enabled: settings.autoUnflagEnabled,
    auto_unflag_notification: settings.autoUnflagNotification ?? null,
    focus_mode: settings.focusMode ?? null,
    anthropic_api_key: settings.anthropicApiKey ?? null,
    gemini_api_key: settings.geminiApiKey ?? null,
    groq_api_key: settings.groqApiKey ?? null,
    paused_session: settings.pausedSession ?? null,
    updated_at: new Date().toISOString(),
  };
}

// Map only the keys present in `updates` to their DB column equivalents.
// Used for partial upserts so we don't accidentally overwrite a column that
// another device just updated. Previously updateSettings sent the entire row
// every time, which caused fields like `daily_new_card_goal` to bounce back
// to a stale value whenever any other field (e.g. dailyPlanSnapshot during
// rating) was changed on a device with out-of-date state.
function toDbPartial(updates: Partial<AppSettings>, userId: string): Record<string, unknown> {
  const out: Record<string, unknown> = { user_id: userId, updated_at: new Date().toISOString() };
  if ('subjects' in updates) out.subjects = updates.subjects;
  if ('examiners' in updates) out.examiners = updates.examiners;
  if ('customTags' in updates) out.custom_tags = updates.customTags;
  if ('studyStreak' in updates) out.study_streak = updates.studyStreak;
  if ('lastStudiedDate' in updates) out.last_studied_date = updates.lastStudiedDate ?? null;
  if ('examDate' in updates) out.exam_date = updates.examDate ?? null;
  if ('dailyNewCardGoal' in updates) out.daily_new_card_goal = updates.dailyNewCardGoal;
  if ('dailyNewCardGoalMode' in updates) out.daily_new_card_goal_mode = updates.dailyNewCardGoalMode ?? null;
  if ('dailyReviewCap' in updates) out.daily_review_cap = updates.dailyReviewCap ?? 9999;
  if ('dailyPlanSnapshot' in updates) out.daily_plan_snapshot = updates.dailyPlanSnapshot ?? null;
  if ('autoUnflagEnabled' in updates) out.auto_unflag_enabled = updates.autoUnflagEnabled;
  if ('autoUnflagNotification' in updates) out.auto_unflag_notification = updates.autoUnflagNotification ?? null;
  if ('focusMode' in updates) out.focus_mode = updates.focusMode ?? null;
  if ('anthropicApiKey' in updates) out.anthropic_api_key = updates.anthropicApiKey ?? null;
  if ('geminiApiKey' in updates) out.gemini_api_key = updates.geminiApiKey ?? null;
  if ('groqApiKey' in updates) out.groq_api_key = updates.groqApiKey ?? null;
  if ('pausedSession' in updates) out.paused_session = updates.pausedSession ?? null;
  return out;
}

export function useSettings(userId: string | null) {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const settingsRef = useRef<AppSettings>(defaultSettings);

  useEffect(() => { settingsRef.current = settings; }, [settings]);

  useEffect(() => {
    if (!userId) {
      setSettings(defaultSettings);
      return;
    }

    const load = async () => {
      try {
        const { data, error } = await supabase
          .from('user_settings').select('*').eq('user_id', userId).single();

        if (data) {
          // Row exists in Supabase — always prefer this (it's the source of truth)
          const s = fromDb(data as Record<string, unknown>);
          setSettings(s);
          settingsRef.current = s;

          // One-time migration: if Supabase has no API keys but the user has
          // them in localStorage from before the sync feature, push them up
          // so all the user's devices pick them up via live-sync.
          const dbRow = data as Record<string, unknown>;
          const needsKeyMigration =
            (!dbRow.anthropic_api_key && s.anthropicApiKey) ||
            (!dbRow.gemini_api_key && s.geminiApiKey) ||
            (!dbRow.groq_api_key && s.groqApiKey);
          if (needsKeyMigration) {
            await supabase.from('user_settings').upsert(toDb(s, userId), { onConflict: 'user_id' });
          }
        } else if (error?.code === 'PGRST116') {
          // Row truly doesn't exist yet (new user) — seed from localStorage
          const local = getLocalSettings();
          await supabase.from('user_settings').upsert(toDb(local, userId), { onConflict: 'user_id' });
          setSettings(local);
          settingsRef.current = local;
        }
        // Any other error (network blip etc.): keep current state, don't overwrite Supabase
      } catch (err) {
        console.error('useSettings load error:', err);
      }
    };

    load();

    // Real-time sync: whenever another device changes this user's settings, pull the update
    const channel = supabase
      .channel(`user_settings:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_settings', filter: `user_id=eq.${userId}` },
        (payload) => {
          if (payload.new && typeof payload.new === 'object') {
            const s = fromDb(payload.new as Record<string, unknown>);
            settingsRef.current = s;
            setSettings(s);
          }
        },
      )
      .subscribe();

    // Re-fetch on window focus (catches missed events if tab was suspended).
    // Throttled to once per 10s — multi-tab users would otherwise thunder
    // the DB on every focus event.
    let lastFocusFetch = 0;
    const onFocus = () => {
      const now = Date.now();
      if (now - lastFocusFetch < 10_000) return;
      lastFocusFetch = now;
      load();
    };
    window.addEventListener('focus', onFocus);

    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener('focus', onFocus);
    };
  }, [userId]);

  const updateSettings = useCallback((updates: Partial<AppSettings>) => {
    if (!userId) return;
    // Persist API key to localStorage only (no Supabase column)
    if ('anthropicApiKey' in updates) {
      const key = updates.anthropicApiKey;
      if (key) localStorage.setItem('anthropic_api_key', key);
      else localStorage.removeItem('anthropic_api_key');
    }
    if ('geminiApiKey' in updates) {
      const key = updates.geminiApiKey;
      if (key) localStorage.setItem('gemini_api_key', key);
      else localStorage.removeItem('gemini_api_key');
    }
    if ('groqApiKey' in updates) {
      const key = updates.groqApiKey;
      if (key) localStorage.setItem('groq_api_key', key);
      else localStorage.removeItem('groq_api_key');
    }
    const updated = { ...settingsRef.current, ...updates };
    settingsRef.current = updated;
    setSettings(updated);
    // Partial upsert — only the changed columns. Avoids clobbering values
    // that another device may have updated concurrently. The `user_id`
    // conflict-target plus the actual changed columns is enough; Postgres
    // leaves all other columns alone.
    supabase.from('user_settings').upsert(toDbPartial(updates, userId), { onConflict: 'user_id' }).then(({ error }) => {
      if (error) console.error('[useSettings] Failed to update settings:', error);
    });
  }, [userId]);

  // Functional updater — for read-modify-write where the caller must see the
  // freshest snapshot (e.g. handleRate incrementing newCardsDone). Avoids the
  // stale-closure race where multiple rapid rates each read the same `prev`
  // from a captured closure and overwrite each other.
  const updateSettingsFn = useCallback((updater: (prev: AppSettings) => Partial<AppSettings>) => {
    if (!userId) return;
    const prev = settingsRef.current;
    const updates = updater(prev);
    // Mirror the API-key side-effects from updateSettings (keep behavior consistent)
    if ('anthropicApiKey' in updates) {
      const key = updates.anthropicApiKey;
      if (key) localStorage.setItem('anthropic_api_key', key);
      else localStorage.removeItem('anthropic_api_key');
    }
    if ('geminiApiKey' in updates) {
      const key = updates.geminiApiKey;
      if (key) localStorage.setItem('gemini_api_key', key);
      else localStorage.removeItem('gemini_api_key');
    }
    if ('groqApiKey' in updates) {
      const key = updates.groqApiKey;
      if (key) localStorage.setItem('groq_api_key', key);
      else localStorage.removeItem('groq_api_key');
    }
    const updated = { ...prev, ...updates };
    settingsRef.current = updated;
    setSettings(updated);
    supabase.from('user_settings').upsert(toDbPartial(updates, userId), { onConflict: 'user_id' }).then(({ error }) => {
      if (error) console.error('[useSettings] Failed to update settings (fn):', error);
    });
  }, [userId]);

  const addSubject = useCallback((subject: string) => {
    if (settingsRef.current.subjects.includes(subject)) return;
    updateSettings({ subjects: [...settingsRef.current.subjects, subject] });
  }, [updateSettings]);

  const removeSubject = useCallback((subject: string) => {
    updateSettings({ subjects: settingsRef.current.subjects.filter(x => x !== subject) });
  }, [updateSettings]);

  const addExaminer = useCallback((examiner: string) => {
    if (settingsRef.current.examiners.includes(examiner)) return;
    updateSettings({ examiners: [...settingsRef.current.examiners, examiner] });
  }, [updateSettings]);

  const removeExaminer = useCallback((examiner: string) => {
    updateSettings({ examiners: settingsRef.current.examiners.filter(x => x !== examiner) });
  }, [updateSettings]);

  const addTag = useCallback((tag: string) => {
    if (settingsRef.current.customTags.includes(tag)) return;
    updateSettings({ customTags: [...settingsRef.current.customTags, tag] });
  }, [updateSettings]);

  const removeTag = useCallback((tag: string) => {
    updateSettings({ customTags: settingsRef.current.customTags.filter(x => x !== tag) });
  }, [updateSettings]);

  return { settings, updateSettings, updateSettingsFn, addSubject, removeSubject, addExaminer, removeExaminer, addTag, removeTag };
}
