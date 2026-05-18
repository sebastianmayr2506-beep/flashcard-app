// Manifest aller verfügbaren Übungen.
//
// Neue Übungen werden hier registriert. Die `component` wird lazy-geladen,
// damit der initiale App-Bundle nicht durch alle Übungen aufgebläht wird —
// sie tauchen nur im Network auf, wenn der User die Übung tatsächlich öffnet.
//
// Konventionen siehe EXERCISE_GUIDE.md.

import { lazy, type LazyExoticComponent, type ComponentType } from 'react';

export type ExerciseDifficulty = 'einfach' | 'mittel' | 'schwer';

export interface ExerciseProps {
  onClose: () => void;
}

export interface ExerciseMeta {
  /** URL-/Storage-Slug, eindeutig. Stabil halten, einmal vergeben. */
  slug: string;
  /** Anzeigetitel in der Übungs-Liste + im Header. */
  title: string;
  /** 1–2 Sätze Beschreibung — was die Übung macht. */
  description: string;
  /** Fachgebiet, z.B. "Kostenrechnung", "BWL", "Mathematik". */
  subject?: string;
  /** Schwierigkeit. */
  difficulty: ExerciseDifficulty;
  /** Emoji/Icon für die Karte. */
  icon?: string;
  /** Geschätzte Dauer in Minuten. */
  estimatedMinutes?: number;
  /** Lazy-geladene Komponente. */
  component: LazyExoticComponent<ComponentType<ExerciseProps>>;
}

export const EXERCISES: ExerciseMeta[] = [
  {
    slug: 'bueb-bab-trainer',
    title: 'BÜB & BAB Kurs',
    description: 'Kompletter Kurs zur Betriebsüberleitung und Betriebsabrechnung: 8 Theorie-Lektionen (Kostenarten, kalkulatorische Kosten, Verteilungsschlüssel) + 9 Praxis-Phasen vom FIBU-Aufwand bis zu Selbstkosten der Produkte.',
    subject: 'Kostenrechnung',
    difficulty: 'schwer',
    icon: '📊',
    estimatedMinutes: 50,
    component: lazy(() => import('./bueb-bab-trainer')),
  },
  {
    slug: 'cashflow-kurs',
    title: 'Cash-Flow Kurs',
    description: 'Kompletter Mini-Kurs zur Kapitalflussrechnung: 7 Theorie-Lektionen (oCF-Formel, Working Capital, Anlagenverkauf) + 5 Praxis-Szenarien von Pizzeria bis Brauerei.',
    subject: 'Bilanzierung',
    difficulty: 'mittel',
    icon: '💧',
    estimatedMinutes: 45,
    component: lazy(() => import('./cashflow-kurs')),
  },
  {
    slug: 'ruecklagen-rueckstellungen',
    title: 'Rücklagen & Rückstellungen',
    description: 'Bilanzierung: Wann ist es Eigenkapital, wann Fremdkapital? 6 Theorie-Lektionen + 5 Praxis-Übungen inkl. „Bilanz bauen" per Click-to-Place.',
    subject: 'Bilanzierung',
    difficulty: 'mittel',
    icon: '🏦',
    estimatedMinutes: 35,
    component: lazy(() => import('./ruecklagen-rueckstellungen-kurs')),
  },
];

export function findExercise(slug: string): ExerciseMeta | undefined {
  return EXERCISES.find(e => e.slug === slug);
}
