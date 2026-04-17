import { useState, useCallback } from 'react';
import type { AppSettings } from '../types/card';
import { getSettings, saveSettings } from '../utils/storage';

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(() => getSettings());

  const updateSettings = useCallback((updates: Partial<AppSettings>) => {
    const current = getSettings();
    const updated = { ...current, ...updates };
    saveSettings(updated);
    setSettings(updated);
  }, []);

  const addSubject = useCallback((subject: string) => {
    const s = getSettings();
    if (s.subjects.includes(subject)) return;
    updateSettings({ subjects: [...s.subjects, subject] });
  }, [updateSettings]);

  const removeSubject = useCallback((subject: string) => {
    const s = getSettings();
    updateSettings({ subjects: s.subjects.filter(x => x !== subject) });
  }, [updateSettings]);

  const addExaminer = useCallback((examiner: string) => {
    const s = getSettings();
    if (s.examiners.includes(examiner)) return;
    updateSettings({ examiners: [...s.examiners, examiner] });
  }, [updateSettings]);

  const removeExaminer = useCallback((examiner: string) => {
    const s = getSettings();
    updateSettings({ examiners: s.examiners.filter(x => x !== examiner) });
  }, [updateSettings]);

  const addTag = useCallback((tag: string) => {
    const s = getSettings();
    if (s.customTags.includes(tag)) return;
    updateSettings({ customTags: [...s.customTags, tag] });
  }, [updateSettings]);

  const removeTag = useCallback((tag: string) => {
    const s = getSettings();
    updateSettings({ customTags: s.customTags.filter(x => x !== tag) });
  }, [updateSettings]);

  return {
    settings,
    updateSettings,
    addSubject, removeSubject,
    addExaminer, removeExaminer,
    addTag, removeTag,
  };
}
