import { useState, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { Flashcard, RatingValue, CardSet, FlagAttempt } from './types/card';
import { isDueToday } from './types/card';
import { useCards } from './hooks/useCards';
import { useSettings } from './hooks/useSettings';
import { useSets } from './hooks/useSets';
import { useCardLinks } from './hooks/useCardLinks';
import { useFlagAttempts } from './hooks/useFlagAttempts';
import { useToast } from './hooks/useToast';
import { useAuth } from './hooks/useAuth';
import { extractParentLinks } from './utils/import';
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
import SetsPage from './pages/SetsPage';
import SetDetail from './pages/SetDetail';
import ExamMode from './pages/ExamMode';

type Page = 'dashboard' | 'library' | 'new-card' | 'edit-card' | 'study' | 'import-export' | 'settings' | 'sets' | 'set-detail' | 'exam';

export default function App() {
  const { user, loading: authLoading, signOut } = useAuth();
  const userId = user?.id ?? null;

  const { cards, loading: cardsLoading, addCard, updateCard, removeCard, rateCard, importCards } = useCards(userId);
  const { settings, updateSettings, addSubject, removeSubject, addExaminer, removeExaminer, addTag, removeTag } = useSettings(userId);
  const { sets, addSet, updateSet, removeSet } = useSets(userId);
  const { links, addLink, removeLink, replaceLinks } = useCardLinks(userId);
  const { flagAttempts, addAttempt, getDistinctCorrectDays } = useFlagAttempts(userId);
  const { toasts, showToast, dismissToast } = useToast();

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

    const snapshot = { date: new Date().toDateString(), totalCards: plan.totalToday };
    updateSettings({ dailyPlanSnapshot: snapshot });

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

    // Build new attempts first so we can include today's session in the correct-days count
    const newAttempts: FlagAttempt[] = [...correct, ...wrong].map(card => ({
      id: uuidv4(),
      cardId: card.id,
      answeredCorrectly: correct.some(c => c.id === card.id),
      attemptedAt: today,
      createdAt: new Date().toISOString(),
    }));

    newAttempts.forEach(a => addAttempt(a.cardId, a.answeredCorrectly));

    if (!settings.autoUnflagEnabled) return [];

    const autoUnflagged: typeof cards = [];
    correct.filter(c => c.flagged).forEach(card => {
      const cardNewAttempts = newAttempts.filter(a => a.cardId === card.id);
      if (getDistinctCorrectDays(card.id, cardNewAttempts) >= 2) {
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
  }, [settings.autoUnflagEnabled, settings.autoUnflagNotification, addAttempt, getDistinctCorrectDays, updateCard, updateSettings]);

  const handleDismissUnflagNotification = useCallback(() => {
    if (!settings.autoUnflagNotification) return;
    updateSettings({ autoUnflagNotification: { ...settings.autoUnflagNotification, dismissed: true } });
  }, [settings.autoUnflagNotification, updateSettings]);

  const handleFlagCards = useCallback((cardIds: string[]) => {
    cardIds.forEach(id => updateCard(id, { flagged: true }));
    showToast(`${cardIds.length} Karte${cardIds.length !== 1 ? 'n' : ''} geflaggt 🚩`, 'info');
  }, [updateCard, showToast]);

  const handleSessionComplete = useCallback(() => {
    const today = new Date().toDateString();
    const lastStudied = settings.lastStudiedDate;
    let newStreak = settings.studyStreak;

    if (lastStudied !== today) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      newStreak = lastStudied === yesterday.toDateString() ? settings.studyStreak + 1 : 1;
      updateSettings({ studyStreak: newStreak, lastStudiedDate: today });
    }

    if (newStreak > 1) {
      showToast(`🔥 ${newStreak} Tage in Folge! Weiter so!`, 'success');
    } else {
      showToast('✅ Session abgeschlossen!', 'success');
    }
  }, [settings, updateSettings, showToast]);

  const handleRate = useCallback((id: string, rating: RatingValue) => {
    rateCard(id, rating, settings.examDate);
  }, [rateCard, settings.examDate]);

  const handleBulkAssignSet = useCallback((cardIds: string[], setId: string | undefined) => {
    cardIds.forEach(id => updateCard(id, { setId }));
    showToast(`${cardIds.length} Karte${cardIds.length !== 1 ? 'n' : ''} zugewiesen`, 'success');
  }, [updateCard, showToast]);

  const handleBulkDelete = useCallback((cardIds: string[]) => {
    cardIds.forEach(id => removeCard(id));
    showToast(`${cardIds.length} Karte${cardIds.length !== 1 ? 'n' : ''} gelöscht`, 'info');
  }, [removeCard, showToast]);

  const handleBulkCreateAndAssignSet = useCallback((cardIds: string[], setName: string) => {
    if (!userId) return;
    const newSet = addSet({ name: setName, color: '#6366f1' }, userId);
    cardIds.forEach(id => updateCard(id, { setId: newSet.id }));
    showToast(`Set "${setName}" erstellt und ${cardIds.length} Karte${cardIds.length !== 1 ? 'n' : ''} zugewiesen`, 'success');
  }, [userId, addSet, updateCard, showToast]);

  const handleViewSet = useCallback((set: CardSet) => {
    setViewingSet(set);
    setPage('set-detail');
  }, []);

  const handleImportSet = useCallback(async (
    setData: Omit<CardSet, 'id' | 'createdAt' | 'updatedAt' | 'userId'>,
    newCards: Flashcard[],
    ownerId: string,
    linkHints?: Array<{ cardFront: string; linkedCardFront: string; linkType: 'child' | 'related' }>
  ) => {
    const newSet = addSet(setData, ownerId);
    const tagged = newCards.map(c => ({ ...c, id: c.id || uuidv4(), setId: newSet.id }));
    await importCards(tagged, true); // wait for cards to be in Supabase before adding links

    if (linkHints && linkHints.length > 0) {
      linkHints.forEach(({ cardFront, linkedCardFront, linkType }) => {
        const card = tagged.find(c => c.front === cardFront);
        const linked = tagged.find(c => c.front === linkedCardFront);
        if (card && linked && card.id !== linked.id) addLink(card.id, linked.id, linkType);
      });
    }
  }, [addSet, importCards, addLink]);

  const handleRepairLinks = useCallback((jsonText: string): number => {
    const hints = extractParentLinks(jsonText);
    if (hints.length === 0) return 0;
    let created = 0;
    hints.forEach(({ childFront, parentFront }) => {
      const child = cards.find(c => c.front === childFront);
      const parent = cards.find(c => c.front === parentFront);
      if (child && parent && child.id !== parent.id) {
        const already = links.some(l =>
          (l.cardId === child.id && l.linkedCardId === parent.id) ||
          (l.cardId === parent.id && l.linkedCardId === child.id)
        );
        if (!already) { addLink(child.id, parent.id, 'child'); created++; }
      }
    });
    return created;
  }, [cards, links, addLink]);

  // Wrapper around importCards: on non-merge (replace), save & restore links + verify count
  const handleImport = useCallback(async (newCards: Flashcard[], merge: boolean) => {
    // Snapshot surviving links BEFORE the import (cascade-delete happens inside importCards)
    const survivingLinks = merge
      ? []
      : (() => {
          const newIds = new Set(newCards.map(c => c.id));
          return links.filter(l => newIds.has(l.cardId) && newIds.has(l.linkedCardId));
        })();

    const result = await importCards(newCards, merge);

    // After non-merge import, Supabase cascade-deleted all card_links —
    // restore them via replaceLinks (force-overwrite state + Supabase).
    if (!merge) {
      await replaceLinks(survivingLinks);
    }

    if (result && !result.ok) {
      showToast(
        `⚠️ Import unvollständig: ${result.saved} von ${result.expected} Karten gespeichert. Konsole prüfen.`,
        'error'
      );
    } else if (!merge && survivingLinks.length > 0) {
      showToast(`✅ ${survivingLinks.length} Verknüpfungen wiederhergestellt`, 'success');
    }
  }, [importCards, replaceLinks, links, showToast]);

  const handleImportLinks = useCallback((jsonText: string, importedCards: typeof cards) => {
    const hints = extractParentLinks(jsonText);
    if (hints.length === 0) return;
    // importedCards are the newly imported cards (passed from ImportExport before state update)
    // cards is the pre-import state; together they cover all known cards
    const allKnownCards = [...cards, ...importedCards];
    hints.forEach(({ childFront, parentFront }) => {
      const child = importedCards.find(c => c.front === childFront) ?? allKnownCards.find(c => c.front === childFront);
      const parent = importedCards.find(c => c.front === parentFront) ?? allKnownCards.find(c => c.front === parentFront);
      if (child && parent && child.id !== parent.id) addLink(child.id, parent.id, 'child');
    });
  }, [cards, addLink]);

  // Show loading screen while auth or initial card data is loading
  if (authLoading || (userId !== null && cardsLoading)) {
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
          onUpdateCard={updateCard}
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
          onUpdateCard={updateCard}
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
            onBulkCreateAndAssignSet={handleBulkCreateAndAssignSet}
            onBulkDelete={handleBulkDelete}
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
            links={links}
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
            onImport={handleImport}
            onImportSet={handleImportSet}
            onImportLinks={handleImportLinks}
            onRepairLinks={handleRepairLinks}
            showToast={showToast}
          />
        )}
        {page === 'settings' && (
          <Settings
            settings={settings}
            cards={cards}
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
