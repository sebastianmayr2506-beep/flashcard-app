import { useState, useCallback } from 'react';
import type { Flashcard, RatingValue } from './types/card';
import { isDueToday } from './types/card';
import { useCards } from './hooks/useCards';
import { useSettings } from './hooks/useSettings';
import { useToast } from './hooks/useToast';
import { useAuth } from './hooks/useAuth';
import { updateStreak, saveSettings, getSettings } from './utils/storage';
import { calculateDailyPlan } from './utils/dailyGoal';

import Sidebar from './components/Sidebar';
import ToastContainer from './components/ToastContainer';

import Dashboard from './pages/Dashboard';
import Library from './pages/Library';
import CardEditor from './pages/CardEditor';
import StudySession, { type DailyPlanSession } from './pages/StudySession';
import ImportExport from './pages/ImportExport';
import Settings from './pages/Settings';
import AuthPage from './pages/AuthPage';

type Page = 'dashboard' | 'library' | 'new-card' | 'edit-card' | 'study' | 'import-export' | 'settings';

export default function App() {
  // All hooks must be called unconditionally before any early returns
  const { user, loading: authLoading, signOut } = useAuth();
  const { cards, addCard, updateCard, removeCard, rateCard, importCards } = useCards();
  const { settings, updateSettings, addSubject, removeSubject, addExaminer, removeExaminer, addTag, removeTag } = useSettings();
  const { toasts, showToast, dismissToast } = useToast();

  const [page, setPage] = useState<Page>('dashboard');
  const [editingCard, setEditingCard] = useState<Flashcard | undefined>();
  const [studyFilteredCards, setStudyFilteredCards] = useState<Flashcard[] | null>(null);
  const [activeDailyPlan, setActiveDailyPlan] = useState<DailyPlanSession | null>(null);

  const dueCount = cards.filter(isDueToday).length;

  const navigate = useCallback((target: string) => {
    if (target !== 'edit-card') setEditingCard(undefined);
    if (target !== 'study') { setStudyFilteredCards(null); setActiveDailyPlan(null); }
    setPage(target as Page);
  }, []);

  const handleEditCard = useCallback((card: Flashcard) => {
    setEditingCard(card);
    setPage('edit-card');
  }, []);

  const handleDeleteCard = useCallback((id: string) => {
    removeCard(id);
    showToast('Karte gelöscht', 'info');
  }, [removeCard, showToast]);

  const handleSaveCard = useCallback((data: Omit<Flashcard, 'id' | 'createdAt' | 'updatedAt' | 'interval' | 'repetitions' | 'easeFactor' | 'nextReviewDate'>) => {
    if (editingCard) {
      updateCard(editingCard.id, data);
      showToast('Karte aktualisiert ✓');
    } else {
      addCard(data);
      showToast('Karte erstellt ✓');
    }
    setEditingCard(undefined);
    setPage('library');
  }, [editingCard, addCard, updateCard, showToast]);

  const handleStudyFiltered = useCallback((filtered: Flashcard[]) => {
    setActiveDailyPlan(null);
    setStudyFilteredCards(filtered);
    setPage('study');
  }, []);

  const handleStartDailySession = useCallback(() => {
    const plan = calculateDailyPlan(cards, settings);
    if (plan.totalToday === 0) return;

    const s = getSettings();
    saveSettings({
      ...s,
      dailyPlanSnapshot: {
        date: new Date().toDateString(),
        totalCards: plan.totalToday,
      },
    });
    updateSettings({
      dailyPlanSnapshot: {
        date: new Date().toDateString(),
        totalCards: plan.totalToday,
      },
    });

    setStudyFilteredCards(null);
    setActiveDailyPlan({
      reviewCards: plan.reviewCards,
      newCards: plan.newCards,
      totalPlanned: plan.totalToday,
    });
    setPage('study');
  }, [cards, settings, updateSettings]);

  const handleSessionComplete = useCallback(() => {
    const updated = updateStreak();
    if (updated.studyStreak > 1) {
      showToast(`🔥 ${updated.studyStreak} Tage in Folge! Weiter so!`, 'success');
    } else {
      showToast('✅ Session abgeschlossen!', 'success');
    }
  }, [showToast]);

  const handleRate = useCallback((id: string, rating: RatingValue) => {
    rateCard(id, rating, settings.examDate);
  }, [rateCard, settings.examDate]);

  // Early returns after all hooks
  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#0f1117] flex items-center justify-center">
        <div className="text-[#9ca3af] text-sm">Laden…</div>
      </div>
    );
  }

  if (!user) return <AuthPage />;

  if (page === 'study') {
    return (
      <>
        <StudySession
          cards={cards}
          settings={settings}
          preFilteredCards={studyFilteredCards}
          dailyPlan={activeDailyPlan}
          onRate={handleRate}
          onSessionComplete={handleSessionComplete}
          onNavigate={navigate}
        />
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      </>
    );
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar active={page} onChange={navigate} dueCount={dueCount} onSignOut={signOut} />

      <main className="flex-1 min-w-0 overflow-y-auto pb-20 md:pb-0">
        {page === 'dashboard' && (
          <Dashboard
            cards={cards}
            settings={settings}
            onNavigate={navigate}
            onStartDailySession={handleStartDailySession}
          />
        )}
        {page === 'library' && (
          <Library
            cards={cards}
            settings={settings}
            onEdit={handleEditCard}
            onDelete={handleDeleteCard}
            onStudyFiltered={handleStudyFiltered}
            onNavigate={navigate}
          />
        )}
        {(page === 'new-card' || page === 'edit-card') && (
          <CardEditor
            card={editingCard}
            settings={settings}
            onSave={handleSaveCard}
            onCancel={() => navigate('library')}
          />
        )}
        {page === 'import-export' && (
          <ImportExport
            cards={cards}
            onImport={importCards}
            showToast={showToast}
          />
        )}
        {page === 'settings' && (
          <Settings
            settings={settings}
            onUpdateSettings={updateSettings}
            onAddSubject={addSubject}
            onRemoveSubject={removeSubject}
            onAddExaminer={addExaminer}
            onRemoveExaminer={removeExaminer}
            onAddTag={addTag}
            onRemoveTag={removeTag}
            showToast={showToast}
          />
        )}
      </main>

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
