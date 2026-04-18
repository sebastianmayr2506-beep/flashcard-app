import { useState, useMemo } from 'react';
import type { Flashcard, CardLink } from '../types/card';
import MarkdownText from './MarkdownText';

// ─── Editor section ───────────────────────────────────────────

interface LinkedCardsProps {
  card: Flashcard;
  allCards: Flashcard[];
  links: CardLink[];
  onAddLink: (cardId: string, linkedCardId: string, linkType: 'child' | 'related') => void;
  onRemoveLink: (linkId: string) => void;
}

export default function LinkedCards({ card, allCards, links, onAddLink, onRemoveLink }: LinkedCardsProps) {
  const [search, setSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [pendingCard, setPendingCard] = useState<Flashcard | null>(null);
  const [linkType, setLinkType] = useState<'child' | 'related'>('related');
  const [viewingCard, setViewingCard] = useState<Flashcard | null>(null);

  const cardLinks = useMemo(() =>
    links.filter(l => l.cardId === card.id || l.linkedCardId === card.id),
    [links, card.id]
  );

  const linkedCards = useMemo(() =>
    cardLinks.map(link => {
      const otherId = link.cardId === card.id ? link.linkedCardId : link.cardId;
      const other = allCards.find(c => c.id === otherId);
      return other ? { card: other, link } : null;
    }).filter(Boolean) as { card: Flashcard; link: CardLink }[],
    [cardLinks, allCards, card.id]
  );

  const linkedIds = useMemo(() =>
    new Set([...cardLinks.map(l => l.cardId), ...cardLinks.map(l => l.linkedCardId), card.id]),
    [cardLinks, card.id]
  );

  const searchResults = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.toLowerCase();
    return allCards
      .filter(c => !linkedIds.has(c.id))
      .filter(c =>
        c.front.toLowerCase().includes(q) ||
        c.subjects?.some(s => s.toLowerCase().includes(q)) ||
        c.customTags.some(t => t.toLowerCase().includes(q))
      )
      .slice(0, 8);
  }, [search, allCards, linkedIds]);

  const handleConfirmLink = () => {
    if (!pendingCard) return;
    onAddLink(card.id, pendingCard.id, linkType);
    setPendingCard(null);
    setSearch('');
    setShowSearch(false);
    setLinkType('related');
  };

  return (
    <div className="bg-[#1e2130] border border-[#2d3148] rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-white flex items-center gap-2">
          🔗 Verknüpfte Karten
          {linkedCards.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-400">
              {linkedCards.length}
            </span>
          )}
        </h3>
        <button
          type="button"
          onClick={() => { setShowSearch(s => !s); setPendingCard(null); setSearch(''); }}
          className="text-sm px-3 py-1.5 rounded-xl bg-[#252840] hover:bg-indigo-500/20 border border-[#2d3148] hover:border-indigo-500/30 text-[#9ca3af] hover:text-indigo-400 transition-colors"
        >
          ＋ Verknüpfen
        </button>
      </div>

      {showSearch && (
        <div className="space-y-3">
          {!pendingCard ? (
            <>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Karte suchen (Vorderseite, Fach, Tag)…"
                autoFocus
                className="w-full text-sm bg-[#252840] border border-[#2d3148] rounded-xl px-3 py-2 text-white placeholder-[#6b7280] focus:border-indigo-500 focus:outline-none"
              />
              {searchResults.length > 0 && (
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {searchResults.map(c => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => { setPendingCard(c); setSearch(''); }}
                      className="w-full text-left px-3 py-2 rounded-xl bg-[#252840] hover:bg-[#2d3148] border border-[#2d3148] text-sm text-white transition-colors"
                    >
                      <span className="line-clamp-1">{c.front || '(leer)'}</span>
                      <span className="text-xs text-[#6b7280] block">{c.subjects?.join(', ')}</span>
                    </button>
                  ))}
                </div>
              )}
              {search.trim() && searchResults.length === 0 && (
                <p className="text-xs text-[#6b7280] text-center py-2">Keine Karten gefunden</p>
              )}
            </>
          ) : (
            <div className="space-y-3">
              <div className="p-3 rounded-xl bg-[#252840] border border-[#2d3148]">
                <p className="text-xs text-[#9ca3af] mb-1">Ausgewählt:</p>
                <p className="text-sm text-white line-clamp-2">{pendingCard.front}</p>
              </div>
              <div>
                <p className="text-xs text-[#9ca3af] mb-2">Verknüpfungstyp:</p>
                <div className="flex gap-2">
                  {(['related', 'child'] as const).map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setLinkType(t)}
                      className={`flex-1 py-2 rounded-xl border text-sm font-medium transition-all ${
                        linkType === t
                          ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-300'
                          : 'bg-[#252840] border-[#2d3148] text-[#9ca3af] hover:text-white'
                      }`}
                    >
                      {t === 'related' ? '🔗 Verwandt' : '🌿 Unterfrage'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setPendingCard(null); setSearch(''); }}
                  className="flex-1 py-2 rounded-xl border border-[#2d3148] text-[#9ca3af] hover:text-white text-sm transition-colors"
                >
                  Zurück
                </button>
                <button
                  type="button"
                  onClick={handleConfirmLink}
                  className="flex-1 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white text-sm font-semibold transition-colors"
                >
                  Verknüpfen
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {linkedCards.length === 0 && !showSearch && (
        <p className="text-sm text-[#6b7280] text-center py-2">Noch keine verknüpften Karten</p>
      )}

      {linkedCards.map(({ card: linked, link }) => (
        <div key={link.id} className="flex items-center gap-3 p-3 rounded-xl bg-[#252840] border border-[#2d3148] group">
          <button
            type="button"
            onClick={() => setViewingCard(linked)}
            className="flex-1 text-left min-w-0"
          >
            <p className="text-sm text-white line-clamp-2 hover:text-indigo-300 transition-colors">{linked.front || '(leer)'}</p>
            <span className={`text-xs px-1.5 py-0.5 rounded mt-1 inline-block ${
              link.linkType === 'child'
                ? 'bg-purple-500/15 text-purple-400'
                : 'bg-indigo-500/15 text-indigo-400'
            }`}>
              {link.linkType === 'child' ? '🌿 Unterfrage' : '🔗 Verwandt'}
            </span>
          </button>
          <button
            type="button"
            onClick={() => onRemoveLink(link.id)}
            className="shrink-0 w-7 h-7 rounded-md hover:bg-red-500/20 text-[#6b7280] hover:text-red-400 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100"
          >
            ✕
          </button>
        </div>
      ))}

      {viewingCard && (
        <LinkedCardModal card={viewingCard} onClose={() => setViewingCard(null)} />
      )}
    </div>
  );
}

// ─── Linked cards collapsible (for study/exam sessions) ───────

interface LinkedCardsPanelProps {
  cardId: string;
  allCards: Flashcard[];
  links: CardLink[];
  title?: string;
  onAnswer?: (cardId: string, isCorrect: boolean) => void;
}

export function LinkedCardsPanel({ cardId, allCards, links, title, onAnswer }: LinkedCardsPanelProps) {
  const [open, setOpen] = useState(false);
  const [viewingCard, setViewingCard] = useState<Flashcard | null>(null);

  const cardLinks = useMemo(() =>
    links.filter(l => l.cardId === cardId || l.linkedCardId === cardId),
    [links, cardId]
  );

  const linkedCards = useMemo(() =>
    cardLinks.map(link => {
      const otherId = link.cardId === cardId ? link.linkedCardId : link.cardId;
      return allCards.find(c => c.id === otherId) ?? null;
    }).filter(Boolean) as Flashcard[],
    [cardLinks, allCards, cardId]
  );

  if (linkedCards.length === 0) return null;

  return (
    <div className="rounded-xl border border-[#2d3148] overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-[#1e2130] hover:bg-[#252840] transition-colors text-left"
      >
        <span className="text-sm font-medium text-[#9ca3af]">
          {title ?? '🔗 Verwandte Fragen'} ({linkedCards.length})
        </span>
        <span className={`text-xs text-[#6b7280] transition-transform ${open ? 'rotate-180' : ''}`}>▼</span>
      </button>

      {open && (
        <div className="bg-[#1a1d27] divide-y divide-[#2d3148]">
          {linkedCards.map(c => (
            <button
              key={c.id}
              onClick={() => setViewingCard(c)}
              className="w-full text-left px-4 py-3 hover:bg-[#252840] transition-colors"
            >
              <p className="text-sm text-white line-clamp-2">{c.front || '(leer)'}</p>
              <p className="text-xs text-[#6b7280] mt-0.5">{c.subjects?.join(', ')}</p>
            </button>
          ))}
        </div>
      )}

      {viewingCard && (
        <LinkedCardModal
          card={viewingCard}
          onClose={() => setViewingCard(null)}
          onAnswer={onAnswer ? (isCorrect) => { onAnswer(viewingCard.id, isCorrect); setViewingCard(null); } : undefined}
        />
      )}
    </div>
  );
}

// ─── Mini card view modal ─────────────────────────────────────

export function LinkedCardModal({ card, onClose, onAnswer }: {
  card: Flashcard;
  onClose: () => void;
  onAnswer?: (isCorrect: boolean) => void;
}) {
  const [flipped, setFlipped] = useState(false);

  const imgSrc = (img: Flashcard['frontImage']) =>
    img ? (img.type === 'base64' ? `data:${img.mimeType ?? 'image/png'};base64,${img.data}` : img.data) : null;

  const frontImg = imgSrc(card.frontImage);
  const backImg = imgSrc(card.backImage);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-[#1a1d27] rounded-3xl border border-[#2d3148] overflow-hidden shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#2d3148]">
          <span className="text-xs font-semibold text-[#9ca3af] uppercase tracking-widest">🔗 Verknüpfte Karte</span>
          <button onClick={onClose} className="text-[#9ca3af] hover:text-white text-xl leading-none transition-colors">✕</button>
        </div>

        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          <div>
            <p className="text-xs text-indigo-400 uppercase tracking-widest mb-2">Frage</p>
            {frontImg && <img src={frontImg} alt="" className="max-h-32 object-contain rounded-xl mb-2" />}
            <p className="text-base text-white font-medium leading-relaxed">
              <MarkdownText text={card.front} />
            </p>
          </div>

          {!flipped ? (
            <button
              onClick={() => setFlipped(true)}
              className="w-full py-3 rounded-xl bg-[#252840] hover:bg-[#2d3148] border border-[#2d3148] text-white font-semibold transition-all"
            >
              Antwort zeigen
            </button>
          ) : (
            <>
              <div className="border-t border-[#2d3148] pt-4">
                <p className="text-xs text-purple-400 uppercase tracking-widest mb-2">Antwort</p>
                {backImg && <img src={backImg} alt="" className="max-h-32 object-contain rounded-xl mb-2" />}
                <p className="text-sm text-[#e8eaf0] leading-relaxed">
                  <MarkdownText text={card.back} />
                </p>
              </div>
              {onAnswer ? (
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => onAnswer(false)}
                    className="py-3 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 font-bold transition-all"
                  >
                    ❌ Nicht gewusst
                  </button>
                  <button
                    onClick={() => onAnswer(true)}
                    className="py-3 rounded-xl bg-green-500/10 hover:bg-green-500/20 border border-green-500/30 text-green-400 font-bold transition-all"
                  >
                    ✅ Gewusst
                  </button>
                </div>
              ) : (
                <button
                  onClick={onClose}
                  className="w-full py-3 rounded-xl border border-[#2d3148] text-[#9ca3af] hover:text-white transition-colors font-medium"
                >
                  Schließen
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
