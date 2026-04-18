import { useState } from 'react';
import type { CardSet, Flashcard, AppSettings } from '../types/card';
import { SET_COLORS } from '../types/card';

interface Props {
  sets: CardSet[];
  cards: Flashcard[];
  settings: AppSettings;
  userId: string;
  onAddSet: (data: Omit<CardSet, 'id' | 'createdAt' | 'updatedAt' | 'userId'>, userId: string) => CardSet;
  onUpdateSet: (id: string, data: Partial<Omit<CardSet, 'id' | 'userId' | 'createdAt'>>) => void;
  onDeleteSet: (id: string) => void;
  onViewSet: (set: CardSet) => void;
  onStudySet: (cards: Flashcard[]) => void;
}

interface SetFormState {
  name: string;
  description: string;
  subject: string;
  examiner: string;
  color: string;
}

const emptyForm = (): SetFormState => ({
  name: '', description: '', subject: '', examiner: '', color: SET_COLORS[0],
});

export default function SetsPage({
  sets, cards, settings, userId,
  onAddSet, onUpdateSet, onDeleteSet, onViewSet, onStudySet,
}: Props) {
  const [showForm, setShowForm] = useState(false);
  const [editingSet, setEditingSet] = useState<CardSet | null>(null);
  const [form, setForm] = useState<SetFormState>(emptyForm());
  const [formError, setFormError] = useState('');

  const cardCountForSet = (setId: string) => cards.filter(c => c.setId === setId).length;

  const openCreate = () => {
    setEditingSet(null);
    setForm(emptyForm());
    setFormError('');
    setShowForm(true);
  };

  const openEdit = (set: CardSet) => {
    setEditingSet(set);
    setForm({
      name: set.name,
      description: set.description ?? '',
      subject: set.subject ?? '',
      examiner: set.examiner ?? '',
      color: set.color,
    });
    setFormError('');
    setShowForm(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { setFormError('Name ist erforderlich'); return; }
    const data = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      subject: form.subject || undefined,
      examiner: form.examiner || undefined,
      color: form.color,
    };
    if (editingSet) {
      onUpdateSet(editingSet.id, data);
    } else {
      onAddSet(data, userId);
    }
    setShowForm(false);
    setEditingSet(null);
  };

  const handleDelete = (set: CardSet) => {
    if (!confirm(`Set "${set.name}" wirklich löschen? Die Karten bleiben erhalten, werden aber keinem Set zugeordnet.`)) return;
    onDeleteSet(set.id);
  };

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white">Meine Sets</h2>
          <p className="text-[#9ca3af] text-sm mt-0.5">{sets.length} Set{sets.length !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={openCreate}
          className="bg-indigo-500 hover:bg-indigo-400 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors"
        >
          + Neues Set
        </button>
      </div>

      {/* Create / Edit form */}
      {showForm && (
        <div className="bg-[#1e2130] border border-indigo-500/30 rounded-2xl p-5 space-y-4">
          <h3 className="font-semibold text-white">{editingSet ? 'Set bearbeiten' : 'Neues Set erstellen'}</h3>
          {formError && <p className="text-red-400 text-sm">{formError}</p>}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-[#9ca3af] uppercase tracking-wider block mb-1.5">Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="z.B. BWL Prüfung"
                  autoFocus
                  className="w-full text-sm bg-[#252840] border border-[#2d3148] rounded-xl px-3 py-2 text-white placeholder-[#6b7280] focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-[#9ca3af] uppercase tracking-wider block mb-1.5">Beschreibung</label>
                <input
                  type="text"
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Kurze Beschreibung…"
                  className="w-full text-sm bg-[#252840] border border-[#2d3148] rounded-xl px-3 py-2 text-white placeholder-[#6b7280] focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-[#9ca3af] uppercase tracking-wider block mb-1.5">Standard-Fach</label>
                <select
                  value={form.subject}
                  onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
                  className="w-full text-sm bg-[#252840] border border-[#2d3148] rounded-xl px-3 py-2 text-white focus:border-indigo-500 focus:outline-none"
                >
                  <option value="">Kein Standard</option>
                  {settings.subjects.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-[#9ca3af] uppercase tracking-wider block mb-1.5">Standard-Prüfer</label>
                <select
                  value={form.examiner}
                  onChange={e => setForm(f => ({ ...f, examiner: e.target.value }))}
                  className="w-full text-sm bg-[#252840] border border-[#2d3148] rounded-xl px-3 py-2 text-white focus:border-indigo-500 focus:outline-none"
                >
                  <option value="">Kein Standard</option>
                  {settings.examiners.map(e => <option key={e} value={e}>{e}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-[#9ca3af] uppercase tracking-wider block mb-2">Farbe</label>
              <div className="flex gap-2 flex-wrap">
                {SET_COLORS.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, color: c }))}
                    className={`w-8 h-8 rounded-full transition-all border-2 ${form.color === c ? 'border-white scale-110' : 'border-transparent hover:scale-105'}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="flex-1 py-2.5 rounded-xl border border-[#2d3148] text-[#9ca3af] hover:text-white transition-colors text-sm font-medium"
              >
                Abbrechen
              </button>
              <button
                type="submit"
                className="flex-1 py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white font-semibold text-sm transition-colors"
              >
                {editingSet ? 'Speichern' : 'Erstellen'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Sets grid */}
      {sets.length === 0 && !showForm ? (
        <div className="text-center py-20">
          <p className="text-5xl mb-4">📂</p>
          <p className="text-lg font-semibold text-white">Noch keine Sets</p>
          <p className="text-[#9ca3af] text-sm mt-1 mb-6">Erstelle dein erstes Set um Karten zu gruppieren</p>
          <button
            onClick={openCreate}
            className="bg-indigo-500 hover:bg-indigo-400 text-white font-semibold px-6 py-3 rounded-xl transition-colors"
          >
            + Neues Set erstellen
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {sets.map(set => {
            const count = cardCountForSet(set.id);
            const setCards = cards.filter(c => c.setId === set.id);
            return (
              <div
                key={set.id}
                className="bg-[#1e2130] border border-[#2d3148] rounded-2xl overflow-hidden hover:border-[#3d4168] transition-all group"
              >
                {/* Color stripe */}
                <div className="h-1.5 w-full" style={{ backgroundColor: set.color }} />
                <div className="p-5">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-white text-base truncate">{set.name}</h3>
                      {set.description && (
                        <p className="text-[#9ca3af] text-sm mt-0.5 line-clamp-2">{set.description}</p>
                      )}
                    </div>
                    <div
                      className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-white text-xs font-bold"
                      style={{ backgroundColor: set.color + '33', border: `1px solid ${set.color}66` }}
                    >
                      <span style={{ color: set.color }}>📂</span>
                    </div>
                  </div>

                  <div className="flex gap-2 flex-wrap mt-3">
                    {set.subject && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-[#252840] border border-[#2d3148] text-[#9ca3af]">{set.subject}</span>
                    )}
                    {set.examiner && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-[#252840] border border-[#2d3148] text-[#9ca3af]">👤 {set.examiner}</span>
                    )}
                    <span className="text-xs px-2 py-0.5 rounded-full bg-[#252840] border border-[#2d3148] text-[#9ca3af]">
                      {count} Karte{count !== 1 ? 'n' : ''}
                    </span>
                  </div>

                  <div className="flex gap-2 mt-4 flex-wrap">
                    <button
                      onClick={() => onViewSet(set)}
                      className="flex-1 min-w-[70px] text-xs py-2 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/20 text-indigo-400 transition-colors font-medium"
                    >
                      Öffnen
                    </button>
                    {count > 0 && (
                      <button
                        onClick={() => onStudySet(setCards)}
                        className="flex-1 min-w-[60px] text-xs py-2 rounded-lg bg-green-500/10 hover:bg-green-500/20 border border-green-500/20 text-green-400 transition-colors font-medium"
                      >
                        ▶ Lernen
                      </button>
                    )}
                    <button
                      onClick={() => openEdit(set)}
                      className="text-xs px-3 py-2 rounded-lg bg-[#252840] hover:bg-[#2d3148] border border-[#2d3148] text-[#9ca3af] hover:text-white transition-colors"
                    >
                      ✏
                    </button>
                    <button
                      onClick={() => handleDelete(set)}
                      className="text-xs px-3 py-2 rounded-lg bg-[#252840] hover:bg-red-500/10 border border-[#2d3148] hover:border-red-500/20 text-[#9ca3af] hover:text-red-400 transition-colors"
                    >
                      🗑
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
