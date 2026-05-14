// AI-Chat-Drawer: Side-Panel right (desktop) / Bottom-Sheet (mobile).
// Loads chat history lazy via useCardChat. Sendet User-Messages durch
// cardChatAI.askCardChat → updated den Verlauf. Optional: "Antwort verbessern"
// Button → suggestBackImprovement → Diff-Modal → onSave applied dem onUpdateCard.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Flashcard, ChatMessage } from '../types/card';
import { useCardChat } from '../hooks/useCardChat';
import { askCardChat, suggestBackImprovement } from '../utils/cardChatAI';
import type { BackSuggestion } from '../utils/cardChatAI';
import MarkdownText from './MarkdownText';

interface Props {
  card: Flashcard;
  userId: string | null;
  open: boolean;
  onClose: () => void;
  onApiError?: (msg: string) => void;
  onUpdateCard: (id: string, patch: Partial<Flashcard>) => void;
  /** Re-generate MC questions after the card was improved (so MC stays in sync). */
  onRegenerateMC?: (cardId: string) => Promise<void>;
  /** AI keys — passed through, not stored. */
  apiKeys: { gemini?: string; anthropic?: string; groq?: string };
}

export default function CardChatDrawer({
  card,
  userId,
  open,
  onClose,
  onApiError,
  onUpdateCard,
  onRegenerateMC,
  apiKeys,
}: Props) {
  const cardId = open ? card.id : null;
  const { messages, updatedAt, loading: loadingChat, appendMessage, clearChat } = useCardChat(userId, cardId);

  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [pendingSuggestion, setPendingSuggestion] = useState<BackSuggestion | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new message
  useEffect(() => {
    if (!open) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, open]);

  // Reset local UI state when drawer closes / card changes
  useEffect(() => {
    if (!open) {
      setInput('');
      setShowHistory(false);
      setConfirmClear(false);
      setPendingSuggestion(null);
    }
  }, [open, card.id]);

  if (!open) return null;

  const hasHistory = messages.length > 0;
  const lastChatLabel = updatedAt ? formatRelativeTime(updatedAt) : null;
  const hasAnyAIKey =
    !!apiKeys.gemini?.trim() || !!apiKeys.anthropic?.trim() || !!apiKeys.groq?.trim();

  // Detect "card edited since chat" — warn the user
  const chatStale = !!(updatedAt && card.updatedAt && new Date(card.updatedAt) > new Date(updatedAt));

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    if (!hasAnyAIKey) {
      onApiError?.('Bitte trage zuerst einen Gemini/Groq/Claude-Key in den Einstellungen ein.');
      return;
    }
    if (messages.length >= 30) {
      onApiError?.('Chat-Limit erreicht (30 Nachrichten). Bitte „Neu starten" klicken.');
      return;
    }
    setInput('');
    setSending(true);
    const userMsg: ChatMessage = { role: 'user', text, ts: Date.now() };
    const nextAfterUser = await appendMessage(userMsg);
    try {
      const reply = await askCardChat(card, nextAfterUser.slice(0, -1), text, apiKeys);
      await appendMessage({ role: 'assistant', text: reply, ts: Date.now() });
    } catch (err) {
      onApiError?.(`Chat-Fehler: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSending(false);
    }
  };

  const handleSuggest = async () => {
    if (suggesting || !hasAnyAIKey) return;
    if (messages.length < 2) {
      onApiError?.('Erst chatten, dann kann die KI Verbesserungen vorschlagen.');
      return;
    }
    setSuggesting(true);
    try {
      const sug = await suggestBackImprovement(card, messages, apiKeys);
      if (sug.changeType === 'none') {
        onApiError?.('Die KI sagt: aktuelle Antwort ist gut — kein Update nötig.');
        return;
      }
      setPendingSuggestion(sug);
    } catch (err) {
      onApiError?.(`Vorschlag-Fehler: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSuggesting(false);
    }
  };

  const acceptSuggestion = async () => {
    if (!pendingSuggestion) return;
    onUpdateCard(card.id, { back: pendingSuggestion.back });
    setPendingSuggestion(null);
    // If card has MC questions, offer regeneration
    if (card.mcQuestions && card.mcQuestions.length > 0 && onRegenerateMC) {
      const ok = window.confirm('Karte wurde aktualisiert. MC-Fragen passen evtl. nicht mehr — jetzt neu generieren?');
      if (ok) {
        try {
          await onRegenerateMC(card.id);
        } catch (err) {
          onApiError?.(`MC-Regenerierung fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  };

  const drawer = (
    <div className="fixed inset-0 z-[70] flex" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" />
      {/* Drawer — full width on mobile, 480px on desktop, slides from right */}
      <div
        className="relative ml-auto w-full sm:w-[480px] h-full bg-[#1a1d27] border-l border-[#2d3148] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-[#2d3148]">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-base">💬</span>
            <h3 className="text-sm font-semibold text-white truncate">KI-Chat zur Karte</h3>
          </div>
          <button
            onClick={onClose}
            className="text-[#9ca3af] hover:text-white text-xl leading-none"
            aria-label="Schließen"
          >
            ✕
          </button>
        </div>

        {/* Card context (compact) */}
        <div className="shrink-0 px-4 py-3 border-b border-[#2d3148] bg-[#15172a]">
          <p className="text-[10px] uppercase tracking-wider text-[#6b7280] font-semibold mb-1">Karte</p>
          <p className="text-xs text-[#d1d5db] line-clamp-2 leading-snug">
            <MarkdownText text={card.front} />
          </p>
        </div>

        {/* Stale-card warning */}
        {chatStale && (
          <div className="shrink-0 mx-4 mt-3 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
            <p className="text-[11px] text-amber-300 leading-relaxed">
              ⚠️ Diese Karte wurde seit dem letzten Chat geändert. Alte Antworten beziehen sich evtl. auf eine frühere Version.
            </p>
          </div>
        )}

        {/* History toggle + clear (only when there's history) */}
        {hasHistory && !showHistory && (
          <div className="shrink-0 px-4 py-2 flex items-center gap-2 border-b border-[#2d3148]">
            <span className="text-xs text-[#9ca3af]">
              ⏪ Letzter Chat {lastChatLabel}
            </span>
            <button
              onClick={() => setShowHistory(true)}
              className="text-xs text-indigo-400 hover:text-indigo-300"
            >
              Verlauf zeigen ▾
            </button>
            <div className="ml-auto">
              {confirmClear ? (
                <div className="flex items-center gap-1">
                  <button
                    onClick={async () => { await clearChat(); setConfirmClear(false); }}
                    className="text-[10px] px-2 py-1 rounded bg-red-500/20 border border-red-500/40 text-red-300 font-semibold"
                  >
                    Neu? Ja
                  </button>
                  <button
                    onClick={() => setConfirmClear(false)}
                    className="text-[10px] px-2 py-1 rounded bg-[#252840] border border-[#2d3148] text-[#9ca3af]"
                  >
                    Nein
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmClear(true)}
                  className="text-[10px] text-[#6b7280] hover:text-red-400"
                >
                  🗑 Neu starten
                </button>
              )}
            </div>
          </div>
        )}

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {loadingChat ? (
            <p className="text-xs text-[#6b7280] text-center pt-8">Lade Chat…</p>
          ) : !hasHistory && !sending ? (
            <div className="text-center pt-6 pb-2">
              <p className="text-sm text-[#9ca3af] leading-relaxed">
                Frag die KI alles zur aktuellen Karte.<br />
                <span className="text-[11px] text-[#6b7280]">
                  z.B. „Erklär mir das einfacher" · „Was ist der Unterschied zu X?" · „Gib mir ein Beispiel"
                </span>
              </p>
            </div>
          ) : (
            (showHistory ? messages : messages.slice(-CHAT_VISIBLE_TAIL)).map((m, i) => (
              <MessageBubble key={`${m.ts}-${i}`} message={m} />
            ))
          )}
          {sending && (
            <div className="flex items-center gap-2 text-xs text-[#9ca3af]">
              <span className="inline-block w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
              KI denkt nach…
            </div>
          )}
        </div>

        {/* Suggest improvement button (only if messages exchanged) */}
        {messages.filter(m => m.role === 'assistant').length >= 1 && !pendingSuggestion && (
          <div className="shrink-0 px-4 pb-2">
            <button
              onClick={handleSuggest}
              disabled={suggesting}
              className="w-full text-xs px-3 py-2 rounded-lg bg-purple-500/15 hover:bg-purple-500/25 border border-purple-500/40 text-purple-300 font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {suggesting ? (
                <>
                  <span className="inline-block w-3 h-3 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                  Vorschlag wird vorbereitet…
                </>
              ) : (
                <>✨ Antwort der Karte verbessern lassen</>
              )}
            </button>
          </div>
        )}

        {/* Input */}
        <div className="shrink-0 px-4 py-3 border-t border-[#2d3148] bg-[#15172a]">
          <div className="flex gap-2">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder="Frage stellen…"
              rows={2}
              disabled={sending || !hasAnyAIKey}
              className="flex-1 text-sm bg-[#252840] border border-[#2d3148] rounded-xl px-3 py-2 text-white placeholder-[#6b7280] focus:border-indigo-500 focus:outline-none resize-none disabled:opacity-50"
            />
            <button
              onClick={send}
              disabled={sending || !input.trim() || !hasAnyAIKey}
              className="px-4 rounded-xl bg-indigo-500 hover:bg-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold transition-colors shrink-0"
            >
              →
            </button>
          </div>
          {!hasAnyAIKey && (
            <p className="text-[11px] text-amber-400 mt-1.5">
              Kein KI-Schlüssel hinterlegt. In Einstellungen → KI eintragen.
            </p>
          )}
          {messages.length >= 25 && messages.length < 30 && (
            <p className="text-[11px] text-amber-400 mt-1.5">
              Noch {30 - messages.length} Nachrichten bis zum Limit.
            </p>
          )}
        </div>
      </div>

      {/* Suggestion diff modal */}
      {pendingSuggestion && (
        <SuggestionDiffModal
          oldBack={card.back}
          suggestion={pendingSuggestion}
          onAccept={acceptSuggestion}
          onReject={() => setPendingSuggestion(null)}
        />
      )}
    </div>
  );

  return createPortal(drawer, document.body);
}

// Show last N messages by default; full history on demand.
const CHAT_VISIBLE_TAIL = 12;

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] px-3 py-2 rounded-xl text-sm leading-relaxed ${
          isUser
            ? 'bg-indigo-500/20 border border-indigo-500/40 text-white'
            : 'bg-[#252840] border border-[#2d3148] text-[#e8eaf0]'
        }`}
      >
        <MarkdownText text={message.text} />
      </div>
    </div>
  );
}

function SuggestionDiffModal({
  oldBack,
  suggestion,
  onAccept,
  onReject,
}: {
  oldBack: string;
  suggestion: BackSuggestion;
  onAccept: () => void;
  onReject: () => void;
}) {
  const changeLabel = {
    clarify:  '🔍 Schärfer formuliert',
    simplify: '✂️ Vereinfacht',
    rephrase: '🔄 Umformuliert',
    expand:   '➕ Erweitert',
    none:     '✓ Keine Änderung',
  }[suggestion.changeType];

  return createPortal(
    <div className="fixed inset-0 z-[80] bg-black/70 flex items-center justify-center p-4" onClick={onReject}>
      <div
        className="bg-[#1a1d27] border border-[#2d3148] rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="shrink-0 px-5 py-4 border-b border-[#2d3148] flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-white">✨ Karten-Antwort verbessern</h3>
            <p className="text-xs text-purple-300 mt-0.5">{changeLabel}</p>
          </div>
          <button onClick={onReject} className="text-[#9ca3af] hover:text-white text-xl leading-none">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="bg-purple-500/10 border border-purple-500/30 rounded-xl p-3">
            <p className="text-[11px] uppercase tracking-wider text-purple-300 font-semibold mb-1">Begründung der KI</p>
            <p className="text-sm text-[#d1d5db]">{suggestion.rationale}</p>
          </div>

          <div>
            <p className="text-[11px] uppercase tracking-wider text-[#6b7280] font-semibold mb-1.5">Vorher</p>
            <div className="bg-[#252840] border border-[#2d3148] rounded-xl px-3 py-2.5 text-sm text-[#9ca3af] leading-relaxed">
              <MarkdownText text={oldBack} />
            </div>
          </div>

          <div>
            <p className="text-[11px] uppercase tracking-wider text-emerald-400 font-semibold mb-1.5">Vorschlag</p>
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-3 py-2.5 text-sm text-white leading-relaxed">
              <MarkdownText text={suggestion.back} />
            </div>
          </div>
        </div>

        <div className="shrink-0 px-5 py-4 border-t border-[#2d3148] flex gap-2">
          <button
            onClick={onReject}
            className="flex-1 px-4 py-2.5 rounded-xl bg-[#252840] hover:bg-[#2d3148] border border-[#2d3148] text-[#d1d5db] font-semibold transition-colors"
          >
            Verwerfen
          </button>
          <button
            onClick={onAccept}
            className="flex-1 px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-semibold transition-colors"
          >
            ✓ Übernehmen
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return 'gerade eben';
  const min = Math.round(sec / 60);
  if (min < 60) return `vor ${min} Min`;
  const h = Math.round(min / 60);
  if (h < 24) return `vor ${h} Std`;
  const d = Math.round(h / 24);
  if (d < 7) return `vor ${d} Tag${d !== 1 ? 'en' : ''}`;
  const w = Math.round(d / 7);
  if (w < 5) return `vor ${w} Woche${w !== 1 ? 'n' : ''}`;
  const months = Math.round(d / 30);
  return `vor ${months} Monat${months !== 1 ? 'en' : ''}`;
}
