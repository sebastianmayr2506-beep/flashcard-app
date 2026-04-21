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
    dailyPlanSnapshot: row.daily_plan_snapshot ?? undefined,
    autoUnflagEnabled: row.auto_unflag_enabled ?? true,
    autoUnflagNotification: row.auto_unflag_notification ?? undefined,
    anthropicApiKey: row.anthropic_api_key ?? undefined,
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
    daily_plan_snapshot: settings.dailyPlanSnapshot ?? null,
    auto_unflag_enabled: settings.autoUnflagEnabled,
    auto_unflag_notification: settings.autoUnflagNotification ?? null,
    anthropic_api_key: settings.anthropicApiKey ?? null,
    updated_at: new Date().toISOString(),
  };
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

        if (error || !data) {
          const local = getLocalSettings();
          await supabase.from('user_settings').upsert(toDb(local, userId), { onConflict: 'user_id' });
          setSettings(local);
          settingsRef.current = local;
        } else {
          const s = fromDb(data as Record<string, unknown>);
          setSettings(s);
          settingsRef.current = s;
        }
      } catch (err) {
        console.error('useSettings load error:', err);
      }
    };

    load();
  }, [userId]);

  const updateSettings = useCallback((updates: Partial<AppSettings>) => {
    if (!userId) return;
    const updated = { ...settingsRef.current, ...updates };
    settingsRef.current = updated;
    setSettings(updated);
    supabase.from('user_settings').upsert(toDb(updated, userId), { onConflict: 'user_id' }).then(({ error }) => {
      if (error) console.error('Failed to update settings:', error);
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

  return { settings, updateSettings, addSubject, removeSubject, addExaminer, removeExaminer, addTag, removeTag };
}
