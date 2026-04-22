import { useState, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { Flashcard, RatingValue, CardSet, FlagAttempt } from './types/card';
import { isDueToday } from './types/card';
import type { MergeResult } from './utils/claudeMerge';
import { callClaudeMerge } from './utils/claudeMerge';
import type { SplitResult, SplitCard } from './utils/claudeSplit';
import { callClaudeSplit } from './utils/claudeSplit';
import { useCards } from './hooks/useCards';
import { useSettings } from './hooks/useSettings';
import { useSets } from './hooks/useSets';
import { useCardLinks } from './hooks/useCardLinks';
import { useFlagAttempts } from './hooks/useFlagAttempts';
import { useToast } from './hooks/useToast';
import { useAuth } from './hooks/useAuth';
import { extractParentLinks } from './utils/import';
import { calculateDailyPlan, getCardsRatedToday } from './utils/dailyGoal';

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
import MergePreviewModal from './components/MergePreviewModal';
import SplitPreviewModal from './components/SplitPreviewModal';

type Page = 'dashboard' | 'library' | 'new-card' | 'edit-card' | 'study' | 'import-export' | 'settings' | 'sets' | 'set-detail' | 'exam';

export default function App() {
  const { user, loading: authLoading, signOut } = useAuth();
  const userId = user?.id ?? null;

  const { cards, loading: cardsLoading, loadError: cardsLoadError, addCard, updateCard, removeCard, rateCard, importCards } = useCards(userId);
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
  const [libraryInitialSrs, setLibraryInitialSrs] = useState<string | undefined>();

  // AI merge state
  const [mergeLoading, setMergeLoading] = useState(false);
  const [mergeSources, setMergeSources] = useState<Flashcard[] | null>(null);
  const [mergeSuggestion, setMergeSuggestion] = useState<MergeResult | null>(null);

  // AI split state
  const [splitLoading, setSplitLoading] = useState(false);
  const [splitSource, setSplitSource] = useState<Flashcard | null>(null);
  const [splitResult, setSplitResult] = useState<SplitResult | null>(null);
  // Optional callback fired after split is confirmed (used by StudySession)
  const [splitAfterCallback, setSplitAfterCallback] = useState<((newCardIds: string[]) => void) | null>(null);

  const dueCount = cards.filter(isDueToday).length;

  const navigate = useCallback((target: string) => {
    if (target !== 'edit-card') setEditingCard(undefined);
    if (target !== 'study') { setStudyFilteredCards(null); setActiveDailyPlan(null); }
    if (target !== 'set-detail') setViewingSet(undefined);
    // Always clear SRS pre-filter on normal navigation — only handleNavigateToLibraryWithSrs sets it
    setLibraryInitialSrs(undefined);
    setPage(target as Page);
  }, []);

  const handleNavigateToLibraryWithSrs = useCallback((srs: string) => {
    setEditingCard(undefined);
    setStudyFilteredCards(null);
    setActiveDailyPlan(null);
    setViewingSet(undefined);
    setLibraryInitialSrs(srs);
    setPage('library');
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
    const today = new Date().toDateString();
    const snap = settings.dailyPlanSnapshot;
    const hasSnapToday = snap?.date === today;

    const newDoneToday = hasSnapToday ? (snap.newCardsDone ?? 0) : 0;
    const plan = calculateDailyPlan(cards, settings, newDoneToday);
    if (plan.totalToday === 0) return;

    // How many cards were already successfully rated today — either from the snapshot
    // (accurate, set by handleRate) or bootstrapped from card state (covers the case
    // where the user did reviews/new cards outside the daily-plan flow, so no snapshot exists yet).
    const doneSoFar = hasSnapToday
      ? (snap.totalDone ?? 0)
      : getCardsRatedToday(cards);

    const newSnapshot = {
      date: today,
      totalCards: hasSnapToday
        ? Math.max(snap.totalCards, doneSoFar + plan.totalToday)
        : doneSoFar + plan.totalToday,
      newCardsDone: newDoneToday,
      totalDone: doneSoFar,
    };
    updateSettings({ dailyPlanSnapshot: newSnapshot });

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

    // Track daily plan progress counters (only Schwer/Gut/Einfach, not Nochmal)
    if (activeDailyPlan && rating >= 1) {
      const today = new Date().toDateString();
      const snap = settings.dailyPlanSnapshot;
      const isNewCard = activeDailyPlan.newCards.some(c => c.id === id);
      const isAnyPlanCard = isNewCard || activeDailyPlan.reviewCards.some(c => c.id === id);

      if (isAnyPlanCard) {
        const newCardsDoneSoFar = snap?.date === today ? (snap.newCardsDone ?? 0) : 0;
        const totalDoneSoFar = snap?.date === today ? (snap.totalDone ?? 0) : 0;
        updateSettings({
          dailyPlanSnapshot: {
            date: today,
            totalCards: snap?.date === today ? snap.totalCards : activeDailyPlan.totalPlanned,
            newCardsDone: isNewCard ? newCardsDoneSoFar + 1 : newCardsDoneSoFar,
            totalDone: totalDoneSoFar + 1,
          },
        });
      }
    }
  }, [rateCard, settings.examDate, activeDailyPlan, settings.dailyPlanSnapshot, updateSettings]);

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

  const handleMergeCards = useCallback(async (cardIds: string[]) => {
    if (cardIds.length < 2) return;

    const apiKey = settings.anthropicApiKey?.trim();
    if (!apiKey) {
      showToast('Bitte trage zuerst deinen Anthropic API-Schlüssel in den Einstellungen ein.', 'error');
      return;
    }

    const sources = cards.filter(c => cardIds.includes(c.id));
    if (sources.length < 2) return;

    setMergeLoading(true);
    showToast('🤖 KI analysiert Karten…', 'info');

    try {
      const result = await callClaudeMerge(apiKey, sources);
      setMergeSources(sources);
      setMergeSuggestion(result);
    } catch (err) {
      console.error('Claude merge error:', err);
      showToast(`KI-Fehler: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setMergeLoading(false);
    }
  }, [cards, settings.anthropicApiKey, showToast]);

  const handleConfirmMerge = useCallback((merged: MergeResult) => {
    if (!mergeSources) return;

    const sourceIds = new Set(mergeSources.map(c => c.id));

    // ── Deterministic metadata calculations (don't rely on the AI for these) ──
    // timesAsked: sum — the combined topic was asked N times total
    const timesAsked = mergeSources.reduce((s, c) => s + (c.timesAsked ?? 0), 0);

    // probabilityPercent: max — if any source card has high exam probability,
    // the merged topic inherits that. (Averaging would artificially lower the value.)
    const probabilityPercent = mergeSources.reduce(
      (max, c) => Math.max(max, c.probabilityPercent ?? 0), 0
    ) || undefined;

    // Set-fields: union (deduplicated)
    const union = <T,>(arrs: (T[] | undefined)[]): T[] =>
      Array.from(new Set(arrs.flatMap(a => a ?? [])));

    const subjects        = union(mergeSources.map(c => c.subjects));
    const examiners       = union(mergeSources.map(c => c.examiners));
    const askedByExaminers = union(mergeSources.map(c => c.askedByExaminers));
    const askedInCatalogs  = union(mergeSources.map(c => c.askedInCatalogs));
    const customTags       = union(mergeSources.map(c => c.customTags));

    // Create the new merged card (addCard returns the created card with its new id)
    const created = addCard({
      front: merged.front,
      back: merged.back,
      subjects,
      examiners,
      difficulty: merged.difficulty,
      customTags,
      setId: mergeSources[0]?.setId,
      probabilityPercent,
      timesAsked: timesAsked > 0 ? timesAsked : undefined,
      askedByExaminers,
      askedInCatalogs,
    });
    const newCardId = created.id;

    // Reparent links: any link connecting a source card to an external card
    // gets migrated to the new merged card. source↔source links are dropped.
    const alreadyLinked = new Set<string>(); // prevent duplicate edges
    links.forEach(link => {
      const fromSource = sourceIds.has(link.cardId);
      const toSource = sourceIds.has(link.linkedCardId);
      if (fromSource && !toSource) {
        const key = `${newCardId}:${link.linkedCardId}`;
        if (!alreadyLinked.has(key)) { alreadyLinked.add(key); addLink(newCardId, link.linkedCardId, link.linkType); }
      } else if (!fromSource && toSource) {
        const key = `${link.cardId}:${newCardId}`;
        if (!alreadyLinked.has(key)) { alreadyLinked.add(key); addLink(link.cardId, newCardId, link.linkType); }
      }
    });

    // Delete all source cards
    mergeSources.forEach(c => removeCard(c.id));

    showToast(`✅ ${mergeSources.length} Karten zusammengeführt`, 'success');
    setMergeSources(null);
    setMergeSuggestion(null);
  }, [mergeSources, links, addCard, addLink, removeCard, showToast]);

  // ── AI Split ─────────────────────────────────────────────────
  const handleSplitCard = useCallback(async (cardId: string, afterSplit?: (newCardIds: string[]) => void) => {
    const apiKey = settings.anthropicApiKey?.trim();
    if (!apiKey) {
      showToast('Bitte trage zuerst deinen Anthropic API-Schlüssel in den Einstellungen ein.', 'error');
      return;
    }
    const source = cards.find(c => c.id === cardId);
    if (!source) return;

    if (afterSplit) setSplitAfterCallback(() => afterSplit);
    setSplitLoading(true);
    showToast('🤖 KI analysiert Karte…', 'info');
    try {
      const result = await callClaudeSplit(apiKey, source);
      setSplitSource(source);
      setSplitResult(result);
    } catch (err) {
      console.error('Claude split error:', err);
      showToast(`KI-Fehler: ${err instanceof Error ? err.message : String(err)}`, 'error');
      setSplitAfterCallback(null);
    } finally {
      setSplitLoading(false);
    }
  }, [cards, settings.anthropicApiKey, showToast]);

  const handleConfirmSplit = useCallback((newCards: SplitCard[]) => {
    if (!splitSource) return;
    const source = splitSource;

    // Global max timesAsked (for probability recompute after split)
    const globalMaxAsked = cards.reduce((m, c) => Math.max(m, c.timesAsked ?? 0), 0);

    // Create each new card inheriting metadata 1:1 from the original
    const createdIds: string[] = [];
    newCards.forEach(nc => {
      // Inherited metadata (subjects, examiners, probability, set, etc.) come from source.
      // customTags: the model already filtered per-part; fall back to source tags if empty.
      const tags = nc.customTags.length > 0 ? nc.customTags : (source.customTags ?? []);
      const timesAsked = source.timesAsked ?? 0;
      const probabilityPercent = globalMaxAsked > 0
        ? Math.round((timesAsked / globalMaxAsked) * 100)
        : (source.probabilityPercent ?? 0);

      const created = addCard({
        front: nc.front,
        back: nc.back,
        frontImage: undefined,
        backImage: undefined,
        subjects: source.subjects ?? [],
        examiners: source.examiners ?? [],
        difficulty: nc.difficulty,
        customTags: tags,
        setId: source.setId,
        flagged: source.flagged ?? false,
        timesAsked: timesAsked > 0 ? timesAsked : undefined,
        askedByExaminers: source.askedByExaminers ?? [],
        askedInCatalogs: source.askedInCatalogs ?? [],
        probabilityPercent: probabilityPercent > 0 ? probabilityPercent : undefined,
      });
      createdIds.push(created.id);
    });

    // Migrate any links from the original card to the FIRST new card.
    // (Heuristic — user can re-link manually if a different target makes more sense.)
    const firstId = createdIds[0];
    if (firstId) {
      links.forEach(link => {
        if (link.cardId === source.id && link.linkedCardId !== source.id) {
          addLink(firstId, link.linkedCardId, link.linkType);
        } else if (link.linkedCardId === source.id && link.cardId !== source.id) {
          addLink(link.cardId, firstId, link.linkType);
        }
      });
    }

    // Remove original
    removeCard(source.id);

    showToast(`✂️ Karte in ${newCards.length} Karten getrennt`, 'success');

    // Notify session if split was triggered from within StudySession
    if (splitAfterCallback) {
      splitAfterCallback(createdIds);
      setSplitAfterCallback(null);
    }

    setSplitSource(null);
    setSplitResult(null);
  }, [splitSource, splitAfterCallback, cards, links, addCard, addLink, removeCard, showToast]);

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

  // CRITICAL: if cards failed to load, block the app completely.
  // Showing an empty library would cause users to panic-import and lose data.
  if (cardsLoadError) {
    return (
      <div className="min-h-screen bg-[#0f1117] flex items-center justify-center p-6">
        <div className="max-w-md bg-[#1e2130] border border-red-500/40 rounded-2xl p-6 text-center">
          <p className="text-4xl mb-3">⚠️</p>
          <h2 className="text-xl font-bold text-white mb-2">Karten konnten nicht geladen werden</h2>
          <p className="text-[#9ca3af] text-sm mb-4">
            Deine Karten sind <strong className="text-white">sicher auf dem Server gespeichert</strong> –
            aber die Verbindung ist gerade fehlgeschlagen. Bitte lade die Seite neu.
          </p>
          <p className="text-xs text-amber-400 mb-5">
            ⚠️ Importiere jetzt <strong>nicht</strong> deine Karteikarten neu – das würde deine Server-Daten überschreiben!
          </p>
          <button
            onClick={() => window.location.reload()}
            className="bg-indigo-500 hover:bg-indigo-400 text-white font-semibold px-6 py-3 rounded-xl transition-colors w-full"
          >
            🔄 Seite neu laden
          </button>
          <button
            onClick={signOut}
            className="mt-2 text-xs text-[#6b7280] hover:text-[#9ca3af] transition-colors"
          >
            Abmelden und neu anmelden
          </button>
        </div>
      </div>
    );
  }

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
          onDeleteCard={handleDeleteCard}
          onSplitCard={handleSplitCard}
          onSessionComplete={handleSessionComplete}
          onNavigate={navigate}
        />
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
        {/* Split preview modal rendered on top of session */}
        {splitSource && splitResult && (
          <SplitPreviewModal
            source={splitSource}
            result={splitResult}
            onConfirm={handleConfirmSplit}
            onCancel={() => { setSplitSource(null); setSplitResult(null); setSplitAfterCallback(null); }}
          />
        )}
        {splitLoading && (
          <div className="fixed inset-0 z-[80] bg-black/70 flex items-center justify-center">
            <div className="bg-[#1a1d27] border border-[#2d3148] rounded-2xl px-8 py-6 flex flex-col items-center gap-4 shadow-2xl">
              <div className="w-10 h-10 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-white font-semibold">KI analysiert Karte…</p>
              <p className="text-[#9ca3af] text-sm">Das dauert einen Moment</p>
            </div>
          </div>
        )}
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
            onNavigateToLibraryWithSrs={handleNavigateToLibraryWithSrs}
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
            onMergeCards={handleMergeCards}
            onSplitCard={handleSplitCard}
            onNavigate={navigate}
            initialSrsFilter={libraryInitialSrs}
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
            onResetAllSrs={(mode) => {
              const now = new Date().toISOString();
              const toReset = mode === 'broken-only'
                ? cards.filter(c => c.repetitions === 0 && c.interval > 0)
                : cards;
              toReset.forEach(c => updateCard(c.id, {
                interval: 0,
                repetitions: 0,
                easeFactor: 2.5,
                nextReviewDate: now,
              }));
              updateSettings({ dailyPlanSnapshot: undefined });
            }}
            showToast={showToast}
          />
        )}
      </main>

      {/* AI Split loading overlay */}
      {splitLoading && (
        <div className="fixed inset-0 z-[80] bg-black/70 flex items-center justify-center">
          <div className="bg-[#1a1d27] border border-[#2d3148] rounded-2xl px-8 py-6 flex flex-col items-center gap-4 shadow-2xl">
            <div className="w-10 h-10 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-white font-semibold">KI analysiert Karte…</p>
            <p className="text-[#9ca3af] text-sm">Das dauert einen Moment</p>
          </div>
        </div>
      )}

      {/* AI Split preview modal */}
      {splitSource && splitResult && (
        <SplitPreviewModal
          source={splitSource}
          result={splitResult}
          onConfirm={handleConfirmSplit}
          onCancel={() => { setSplitSource(null); setSplitResult(null); }}
        />
      )}

      {/* AI Merge loading overlay */}
      {mergeLoading && (
        <div className="fixed inset-0 z-[80] bg-black/70 flex items-center justify-center">
          <div className="bg-[#1a1d27] border border-[#2d3148] rounded-2xl px-8 py-6 flex flex-col items-center gap-4 shadow-2xl">
            <div className="w-10 h-10 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-white font-semibold">KI analysiert Karten…</p>
            <p className="text-[#9ca3af] text-sm">Das dauert einen Moment</p>
          </div>
        </div>
      )}

      {/* AI Merge preview modal */}
      {mergeSources && mergeSuggestion && (
        <MergePreviewModal
          sources={mergeSources}
          suggestion={mergeSuggestion}
          onConfirm={handleConfirmMerge}
          onCancel={() => { setMergeSources(null); setMergeSuggestion(null); }}
        />
      )}

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
