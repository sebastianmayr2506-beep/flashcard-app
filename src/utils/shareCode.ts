import { supabase } from '../lib/supabase';
import type { CardSet, Flashcard, CardLink } from '../types/card';

export interface SharedSetPayload {
  set: {
    name: string;
    description?: string;
    subject?: string;
    examiner?: string;
    color: string;
  };
  cards: Array<{
    front: string;
    back: string;
    frontImage?: Flashcard['frontImage'];
    backImage?: Flashcard['backImage'];
    subjects: string[];
    examiners: string[];
    difficulty: Flashcard['difficulty'];
    customTags: string[];
    timesAsked?: number;
    askedByExaminers?: string[];
    askedInCatalogs?: string[];
    probabilityPercent?: number;
  }>;
  // Links stored by front text — survives ID reassignment on import
  links?: Array<{
    cardFront: string;
    linkedCardFront: string;
    linkType: 'child' | 'related';
  }>;
}

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export async function createShareCode(
  set: CardSet,
  cards: Flashcard[],
  links: CardLink[],
  userId: string
): Promise<string> {
  const setCards = cards.filter(c => c.setId === set.id);
  const setCardIds = new Set(setCards.map(c => c.id));

  const setLinks = links
    .filter(l => setCardIds.has(l.cardId) && setCardIds.has(l.linkedCardId))
    .map(l => {
      const cardA = setCards.find(c => c.id === l.cardId)!;
      const cardB = setCards.find(c => c.id === l.linkedCardId)!;
      return { cardFront: cardA.front, linkedCardFront: cardB.front, linkType: l.linkType };
    });

  const payload: SharedSetPayload = {
    set: {
      name: set.name,
      description: set.description,
      subject: set.subject,
      examiner: set.examiner,
      color: set.color,
    },
    cards: setCards.map(c => ({
      front: c.front,
      back: c.back,
      frontImage: c.frontImage,
      backImage: c.backImage,
      subjects: c.subjects,
      examiners: c.examiners,
      difficulty: c.difficulty,
      customTags: c.customTags,
      timesAsked: c.timesAsked,
      askedByExaminers: c.askedByExaminers,
      askedInCatalogs: c.askedInCatalogs,
      probabilityPercent: c.probabilityPercent,
    })),
    links: setLinks.length > 0 ? setLinks : undefined,
  };

  const code = generateCode();
  const { error } = await supabase.from('shared_sets').insert({
    share_code: code,
    created_by: userId,
    set_data: payload,
  });

  if (error) throw new Error(error.message);
  return code;
}

export async function importByShareCode(code: string): Promise<SharedSetPayload> {
  const { data, error } = await supabase
    .from('shared_sets')
    .select('set_data')
    .eq('share_code', code.toUpperCase().trim())
    .single();

  if (error || !data) throw new Error('Ungültiger Code oder Set nicht gefunden');
  return data.set_data as SharedSetPayload;
}
