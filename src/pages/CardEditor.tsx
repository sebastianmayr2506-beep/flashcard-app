import { useState, useEffect } from 'react';
import type { Flashcard, Difficulty, AppSettings, CardImage } from '../types/card';
import ImageInput from '../components/ImageInput';

interface Props {
  card?: Flashcard;
  settings: AppSettings;
  onSave: (data: Omit<Flashcard, 'id' | 'createdAt' | 'updatedAt' | 'interval' | 'repetitions' | 'easeFactor' | 'nextReviewDate'>) => void;
  onCancel: () => void;
}

const DIFFICULTIES: { value: Difficulty; label: string }[] = [
  { value: 'einfach', label: 'Einfach' },
  { value: 'mittel',  label: 'Mittel' },
  { value: 'schwer',  label: 'Schwer' },
];

export default function CardEditor({ card, settings, onSave, onCancel }: Props) {
  const [front, setFront] = useState(card?.front ?? '');
  const [back, setBack] = useState(card?.back ?? '');
  const [frontImage, setFrontImage] = useState<CardImage | undefined>(card?.frontImage);
  const [backImage, setBackImage] = useState<CardImage | undefined>(card?.backImage);
  const [subjects, setSubjects] = useState<string[]>(card?.subjects ?? []);
  const [examiners, setExaminers] = useState<string[]>(card?.examiners ?? []);
  const [difficulty, setDifficulty] = useState<Difficulty>(card?.difficulty ?? 'mittel');
  const [tagsInput, setTagsInput] = useState(card?.customTags.join(', ') ?? '');
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    if (card) {
      setFront(card.front); setBack(card.back);
      setFrontImage(card.frontImage); setBackImage(card.backImage);
      setSubjects(card.subjects ?? []); setExaminers(card.examiners ?? []);
      setDifficulty(card.difficulty);
      setTagsInput(card.customTags.join(', '));
    }
  }, [card]);

  const validate = () => {
    const errs: string[] = [];
    if (!front.trim() && !frontImage) errs.push('Vorderseite darf nicht leer sein');
    if (!back.trim() && !backImage) errs.push('Rückseite darf nicht leer sein');
    if (subjects.length === 0) errs.push('Bitte mindestens ein Fach auswählen');
    return errs;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validate();
    if (errs.length > 0) { setErrors(errs); return; }
    const customTags = tagsInput.split(',').map(t => t.trim()).filter(Boolean);
    onSave({ front: front.trim(), back: back.trim(), frontImage, backImage, subjects, examiners, difficulty, customTags });
  };

  return (
    <div className="p-4 md:p-6 lg:p-8 fade-in">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-white">{card ? 'Karte bearbeiten' : 'Neue Karte'}</h2>
            <p className="text-[#9ca3af] text-sm mt-0.5">Fülle alle Felder aus</p>
          </div>
          <button onClick={onCancel} className="text-[#9ca3af] hover:text-white text-2xl transition-colors">✕</button>
        </div>

        {errors.length > 0 && (
          <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30">
            {errors.map(e => <p key={e} className="text-red-400 text-sm">{e}</p>)}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Front */}
          <div className="bg-[#1e2130] border border-[#2d3148] rounded-2xl p-5 space-y-4">
            <h3 className="font-semibold text-white flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-indigo-500/20 border border-indigo-500/40 text-indigo-400 text-xs flex items-center justify-center font-bold">V</span>
              Vorderseite (Frage)
            </h3>
            <textarea
              value={front}
              onChange={e => setFront(e.target.value)}
              placeholder="Frage oder Begriff…"
              rows={3}
              className="w-full text-sm bg-[#252840] border border-[#2d3148] rounded-xl px-3 py-2.5 text-white placeholder-[#6b7280] focus:border-indigo-500 focus:outline-none resize-none"
            />
            <ImageInput value={frontImage} onChange={setFrontImage} label="Bild Vorderseite" />
          </div>

          {/* Back */}
          <div className="bg-[#1e2130] border border-[#2d3148] rounded-2xl p-5 space-y-4">
            <h3 className="font-semibold text-white flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-purple-500/20 border border-purple-500/40 text-purple-400 text-xs flex items-center justify-center font-bold">R</span>
              Rückseite (Antwort)
            </h3>
            <textarea
              value={back}
              onChange={e => setBack(e.target.value)}
              placeholder="Antwort oder Erklärung…"
              rows={3}
              className="w-full text-sm bg-[#252840] border border-[#2d3148] rounded-xl px-3 py-2.5 text-white placeholder-[#6b7280] focus:border-indigo-500 focus:outline-none resize-none"
            />
            <ImageInput value={backImage} onChange={setBackImage} label="Bild Rückseite" />
          </div>

          {/* Meta */}
          <div className="bg-[#1e2130] border border-[#2d3148] rounded-2xl p-5 space-y-4">
            <h3 className="font-semibold text-white">Details</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="text-xs font-medium text-[#9ca3af] uppercase tracking-wider block mb-1.5">Fach * (Mehrfachauswahl möglich)</label>
                <div className="flex flex-wrap gap-2">
                  {settings.subjects.map(s => {
                    const selected = subjects.includes(s);
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setSubjects(prev => selected ? prev.filter(x => x !== s) : [...prev, s])}
                        className={`text-sm px-3 py-1.5 rounded-xl border transition-all ${
                          selected
                            ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-300'
                            : 'bg-[#252840] border-[#2d3148] text-[#9ca3af] hover:text-white'
                        }`}
                      >
                        {s}
                      </button>
                    );
                  })}
                </div>
                {subjects.length > 0 && (
                  <p className="text-xs text-[#6b7280] mt-1.5">Ausgewählt: {subjects.join(', ')}</p>
                )}
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs font-medium text-[#9ca3af] uppercase tracking-wider block mb-1.5">Prüfer (Mehrfachauswahl möglich)</label>
                <div className="flex flex-wrap gap-2">
                  {settings.examiners.map(e => {
                    const selected = examiners.includes(e);
                    return (
                      <button
                        key={e}
                        type="button"
                        onClick={() => setExaminers(prev => selected ? prev.filter(x => x !== e) : [...prev, e])}
                        className={`text-sm px-3 py-1.5 rounded-xl border transition-all ${
                          selected
                            ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-300'
                            : 'bg-[#252840] border-[#2d3148] text-[#9ca3af] hover:text-white'
                        }`}
                      >
                        {e}
                      </button>
                    );
                  })}
                </div>
                {examiners.length > 0 && (
                  <p className="text-xs text-[#6b7280] mt-1.5">Ausgewählt: {examiners.join(', ')}</p>
                )}
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-[#9ca3af] uppercase tracking-wider block mb-1.5">Schwierigkeit</label>
              <div className="flex gap-2">
                {DIFFICULTIES.map(d => (
                  <button
                    key={d.value}
                    type="button"
                    onClick={() => setDifficulty(d.value)}
                    className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-all ${
                      difficulty === d.value
                        ? d.value === 'einfach' ? 'bg-green-500/20 border-green-500/40 text-green-400'
                          : d.value === 'mittel' ? 'bg-amber-500/20 border-amber-500/40 text-amber-400'
                          : 'bg-red-500/20 border-red-500/40 text-red-400'
                        : 'bg-[#252840] border-[#2d3148] text-[#9ca3af] hover:text-white'
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-[#9ca3af] uppercase tracking-wider block mb-1.5">Tags (kommagetrennt)</label>
              <input
                type="text"
                value={tagsInput}
                onChange={e => setTagsInput(e.target.value)}
                placeholder="z.B. Klausur, Kapitel 3, Formel"
                className="w-full text-sm bg-[#252840] border border-[#2d3148] rounded-xl px-3 py-2 text-white placeholder-[#6b7280] focus:border-indigo-500 focus:outline-none"
              />
              {tagsInput.trim() && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {tagsInput.split(',').map(t => t.trim()).filter(Boolean).map(t => (
                    <span key={t} className="text-xs px-2 py-0.5 rounded-full bg-[#252840] border border-[#2d3148] text-[#9ca3af]">#{t}</span>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 py-3 rounded-xl border border-[#2d3148] text-[#9ca3af] hover:text-white hover:border-[#6b7280] transition-colors font-medium"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              className="flex-1 py-3 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white font-semibold transition-colors"
            >
              {card ? 'Änderungen speichern' : 'Karte erstellen'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
