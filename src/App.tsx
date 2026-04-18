import { useState, useCallback } from 'react';
import type { Flashcard, RatingValue, CardSet } from './types/card';
import { isDueToday } from './types/card';
import { useCards } from './hooks/useCards';
import { useSettings } from './hooks/useSettings';
import { useSets } from './hooks/useSets';
import { useCardLinks } from './hooks/useCardLinks';
import { useToast } from './hooks/useToast';
import { useAuth } from './hooks/useAuth';
import { updateStreak, saveSettings, getSettings, saveAllCards, getCards, saveFlagAttempt, getDistinctCorrectDays, getFlagAttempts } from './utils/storage';
import { extractParentLinks } from './utils/import';
import { calculateDailyPlan } from './utils/dailyGoal';
import { v4 as uuidv4 } from 'uuid';
import type { FlagAttempt } from './types/card';

import Sidebar from './components/Sidebar';
import ToastContainer from './components/ToastContainer';

import Dashboard from './pages/Dashboard';
import Library from './pages/Library';
import CardEditor from './pages/CardEditor';
import StudySession, { type DailyPlanSession } from './pages/StudySession';
import ImportExport from './pages/ImportExport';
import Settings from './pages/Settings';
import AuthPage from './pages/AuthPage';
import SetsPage from './pages/SetsPage';
import SetDetail from './pages/SetDetail';
import ExamMode from './pages/ExamMode';

type Page = 'dashboard' | 'library' | 'new-card' | 'edit-card' | 'study' | 'import-export' | 'settings' | 'sets' | 'set-detail' | 'exam';

export default function App() {
  // All hooks must be called unconditionally before any early returns
  const { user, loading: authLoading, signOut } = useAuth();
  const { cards, addCard, updateCard, removeCard, rateCard, importCards, refresh: refreshCards } = useCards();
  const { settings, updateSettings, addSubject, removeSubject, addExaminer, removeExaminer, addTag, removeTag } = useSettings();
  const { sets, addSet, updateSet, removeSet } = useSets();
  const { links, addLink, removeLink } = useCardLinks();
  const { toasts, showToast, dismissToast } = useToast();

  const [flagAttempts, setFlagAttempts] = useState<FlagAttempt[]>(() => getFlagAttempts());

  const [page, setPage] = useState<Page>('dashboard');
  const [editingCard, setEditingCard] = useState<Flashcard | undefined>();
  const [viewingSet, setViewingSet] = useState<CardSet | undefined>();
  const [studyFilteredCards, setStudyFilteredCards] = useState<Flashcard[] | null>(null);
  const [activeDailyPlan, setActiveDailyPlan] = useState<DailyPlanSession | null>(null);

  const dueCount = cards.filter(isDueToday).length;

  const navigate = useCallback((target: string) => {
    if (target !== 'edit-card') setEditingCard(undefined);
    if (target !== 'study') { setStudyFilteredCards(null); setActiveDailyPlan(null); }
    if (target !== 'set-detail') setViewingSet(undefined);
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

  const handleRecordAttempts = useCallback((correct: typeof cards, wrong: typeof cards): typeof cards => {
    const today = new Date().toISOString().split('T')[0];
    [...correct, ...wrong].forEach(card => {
      const isCorrect = correct.some(c => c.id === card.id);
      saveFlagAttempt({ id: uuidv4(), cardId: card.id, answeredCorrectly: isCorrect, attemptedAt: today, createdAt: new Date().toISOString() });
    });
    setFlagAttempts(getFlagAttempts());

    if (!settings.autoUnflagEnabled) return [];

    const autoUnflagged: typeof cards = [];
    correct.filter(c => c.flagged).forEach(card => {
      if (getDistinctCorrectDays(card.id) >= 2) {
        updateCard(card.id, { flagged: false });
        autoUnflagged.push(card);
      }
    });

    if (autoUnflagged.length > 0) {
      const todayStr = new Date().toDateString();
      const existing = settings.autoUnflagNotification;
      const prev = existing?.date === todayStr ? existing.count : 0;
      updateSettings({ autoUnflagNotification: { date: todayStr, count: prev + autoUnflagged.length, dismissed: false } });
    }

    return autoUnflagged;
  }, [settings.autoUnflagEnabled, settings.autoUnflagNotification, updateCard, updateSettings]);

  const handleDismissUnflagNotification = useCallback(() => {
    if (!settings.autoUnflagNotification) return;
    updateSettings({ autoUnflagNotification: { ...settings.autoUnflagNotification, dismissed: true } });
  }, [settings.autoUnflagNotification, updateSettings]);

  const handleFlagCards = useCallback((cardIds: string[]) => {
    cardIds.forEach(id => updateCard(id, { flagged: true }));
    showToast(`${cardIds.length} Karte${cardIds.length !== 1 ? 'n' : ''} geflaggt 🚩`, 'info');
  }, [updateCard, showToast]);

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

  const handleBulkAssignSet = useCallback((cardIds: string[], setId: string | undefined) => {
    cardIds.forEach(id => updateCard(id, { setId }));
    showToast(`${cardIds.length} Karte${cardIds.length !== 1 ? 'n' : ''} zugewiesen`, 'success');
  }, [updateCard, showToast]);

  const handleViewSet = useCallback((set: CardSet) => {
    setViewingSet(set);
    setPage('set-detail');
  }, []);

  // Import a full set + its cards (from share code or set-JSON file)
  const handleImportSet = useCallback((
    setData: Omit<CardSet, 'id' | 'createdAt' | 'updatedAt' | 'userId'>,
    newCards: Flashcard[],
    userId: string
  ) => {
    const newSet = addSet(setData, userId);
    // Assign the fresh setId to all imported cards, then add them
    const tagged = newCards.map(c => ({
      ...c,
      id: c.id || uuidv4(),
      setId: newSet.id,
    }));
    const existing = getCards();
    const existingIds = new Set(existing.map(c => c.id));
    const toAdd = tagged.filter(c => !existingIds.has(c.id));
    saveAllCards([...existing, ...toAdd]);
    refreshCards();
  }, [addSet, refreshCards]);

  const handleImportLinks = useCallback((jsonText: string, importedCards: typeof cards) => {
    const hints = extractParentLinks(jsonText);
    if (hints.length === 0) return;
    const allKnownCards = [...getCards()];
    hints.forEach(({ childFront, parentFront }) => {
      const child = importedCards.find(c => c.front === childFront) ?? allKnownCards.find(c => c.front === childFront);
      const parent = allKnownCards.find(c => c.front === parentFront);
      if (child && parent) addLink(child.id, parent.id, 'child');
    });
  }, [addLink]);

  // Early returns after all hooks
  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#0f1117] flex items-center justify-center">
        <div className="text-[#9ca3af] text-sm">Laden…</div>
      </div>
    );
  }

  if (!user) return <AuthPage />;

  if (page === 'exam') {
    return (
      <>
        <ExamMode
          cards={cards}
          sets={sets}
          settings={settings}
          links={links}
          onFlagCards={handleFlagCards}
          onRecordAttempts={handleRecordAttempts}
          onNavigate={navigate}
        />
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      </>
    );
  }

  if (page === 'study') {
    return (
      <>
        <StudySession
          cards={cards}
          settings={settings}
          sets={sets}
          links={links}
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
      <Sidebar active={page} onChange={navigate} dueCount={dueCount} onSignOut={signOut} userEmail={user.email ?? undefined} />

      <main className="flex-1 min-w-0 overflow-y-auto pb-20 md:pb-0">
        {page === 'dashboard' && (
          <Dashboard
            cards={cards}
            settings={settings}
            onNavigate={navigate}
            onStartDailySession={handleStartDailySession}
            onDismissUnflagNotification={handleDismissUnflagNotification}
            onEditCard={handleEditCard}
          />
        )}
        {page === 'library' && (
          <Library
            cards={cards}
            settings={settings}
            sets={sets}
            links={links}
            flagAttempts={flagAttempts}
            onEdit={handleEditCard}
            onDelete={handleDeleteCard}
            onStudyFiltered={handleStudyFiltered}
            onBulkAssignSet={handleBulkAssignSet}
            onNavigate={navigate}
          />
        )}
        {(page === 'new-card' || page === 'edit-card') && (
          <CardEditor
            card={editingCard}
            settings={settings}
            sets={sets}
            allCards={cards}
            links={links}
            onSave={handleSaveCard}
            onCancel={() => navigate('library')}
            onAddLink={addLink}
            onRemoveLink={removeLink}
          />
        )}
        {page === 'sets' && (
          <SetsPage
            sets={sets}
            cards={cards}
            settings={settings}
            userId={user.id}
            onAddSet={addSet}
            onUpdateSet={updateSet}
            onDeleteSet={removeSet}
            onViewSet={handleViewSet}
            onStudySet={handleStudyFiltered}
          />
        )}
        {page === 'set-detail' && viewingSet && (
          <SetDetail
            set={viewingSet}
            cards={cards}
            userId={user.id}
            onBack={() => navigate('sets')}
            onEdit={handleEditCard}
            onDelete={handleDeleteCard}
            onStudy={handleStudyFiltered}
            showToast={showToast}
          />
        )}
        {page === 'import-export' && (
          <ImportExport
            cards={cards}
            sets={sets}
            userId={user.id}
            onImport={importCards}
            onImportSet={handleImportSet}
            onImportLinks={handleImportLinks}
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
