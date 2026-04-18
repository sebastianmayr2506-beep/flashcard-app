import { useState, useCallback, useEffect } from 'react';
import type { AppSettings } from '../types/card';
import { DEFAULT_SUBJECTS, DEFAULT_EXAMINERS } from '../types/card';
import { getSettings, saveSettings } from '../utils/storage';

const defaultSettings: AppSettings = {
  subjects: DEFAULT_SUBJECTS,
  examiners: DEFAULT_EXAMINERS,
  customTags: [],
  studyStreak: 0,
  lastStudiedDate: null,
  dailyNewCardGoal: 10,
};

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getSettings()
      .then(setSettings)
      .finally(() => setLoading(false));
  }, []);

  // Optimistic update: apply to state immediately, persist in background
  const updateSettings = useCallback((updates: Partial<AppSettings>) => {
    let next!: AppSettings;
    setSettings(prev => {
      next = { ...prev, ...updates };
      return next;
    });
    saveSettings(next);
  }, []);

  const updateStreak = useCallback(async (): Promise<AppSettings> => {
    let current!: AppSettings;
    setSettings(prev => { current = prev; return prev; });

    const today = new Date().toDateString();
    if (current.lastStudiedDate === today) return current;

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const isConsecutive = current.lastStudiedDate === yesterday.toDateString();

    const updated: AppSettings = {
      ...current,
      studyStreak: isConsecutive ? current.studyStreak + 1 : 1,
      lastStudiedDate: today,
    };
    setSettings(updated);
    await saveSettings(updated);
    return updated;
  }, []);

  const addSubject = useCallback((subject: string) => {
    setSettings(prev => {
      if (prev.subjects.includes(subject)) return prev;
      const next = { ...prev, subjects: [...prev.subjects, subject] };
      saveSettings(next);
      return next;
    });
  }, []);

  const removeSubject = useCallback((subject: string) => {
    setSettings(prev => {
      const next = { ...prev, subjects: prev.subjects.filter(x => x !== subject) };
      saveSettings(next);
      return next;
    });
  }, []);

  const addExaminer = useCallback((examiner: string) => {
    setSettings(prev => {
      if (prev.examiners.includes(examiner)) return prev;
      const next = { ...prev, examiners: [...prev.examiners, examiner] };
      saveSettings(next);
      return next;
    });
  }, []);

  const removeExaminer = useCallback((examiner: string) => {
    setSettings(prev => {
      const next = { ...prev, examiners: prev.examiners.filter(x => x !== examiner) };
      saveSettings(next);
      return next;
    });
  }, []);

  const addTag = useCallback((tag: string) => {
    setSettings(prev => {
      if (prev.customTags.includes(tag)) return prev;
      const next = { ...prev, customTags: [...prev.customTags, tag] };
      saveSettings(next);
      return next;
    });
  }, []);

  const removeTag = useCallback((tag: string) => {
    setSettings(prev => {
      const next = { ...prev, customTags: prev.customTags.filter(x => x !== tag) };
      saveSettings(next);
      return next;
    });
  }, []);

  return {
    settings,
    loading,
    updateSettings,
    updateStreak,
    addSubject, removeSubject,
    addExaminer, removeExaminer,
    addTag, removeTag,
  };
}
