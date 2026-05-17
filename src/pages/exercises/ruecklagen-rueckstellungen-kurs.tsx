// Rücklagen & Rückstellungen Kurs
// Kompletter Mini-Kurs zur Abgrenzung Rücklage (Eigenkapital) vs.
// Rückstellung (Fremdkapital): 6 Theorie-Lektionen + 5 Praxis-Übungen
// (True/False, Bilanz-Zuordnung, Eigenschaften, Praxisfälle, Bilanz
// bauen per Click-to-Place).
//
// Portiert aus ruecklagen-rueckstellungen-kurs.jsx — Light-Theme +
// Inline-Styles → Tailwind Dark-Theme. Color-Coding: rl = blau,
// rs = amber, vb = rot.

import { useState } from 'react';
import { ExerciseShell, Card } from './_shared';

type ColorKey = 'indigo' | 'blue' | 'emerald' | 'red' | 'amber' | 'purple' | 'gray';

// ─── Theorie-Daten ─────────────────────────────────────────────────────

type ContentBlock =
  | { type: 'text'; value: string }
  | { type: 'callout'; emoji: string; value: string }
  | { type: 'versus'; left: VersusItem; right: VersusItem }
  | { type: 'cards'; items: { label: string; desc: string; icon: string; color: ColorKey }[] }
  | { type: 'bilanz'; items: { label: string; sub: string; color: ColorKey; icon: string; includes: string[] }[] }
  | { type: 'compareTable'; headers: string[]; rows: string[][] }
  | { type: 'summary'; items: string[] };

interface VersusItem {
  label: string;
  icon: string;
  color: ColorKey;
  sub: string;
  desc: string;
}

interface TheoryPage {
  title: string;
  icon: string;
  content: ContentBlock[];
}

const theory: TheoryPage[] = [
  {
    title: 'Die große Verwechslung', icon: '🔀',
    content: [
      { type: 'text', value: 'Rücklagen und Rückstellungen – klingt ähnlich, ist aber grundverschieden! Beide stehen auf der Passivseite der Bilanz, gehören aber in völlig unterschiedliche Kategorien.' },
      {
        type: 'versus',
        left: { label: 'Rücklage', icon: '🏦', color: 'blue', sub: 'Gespartes Eigenkapital', desc: 'Kein Schuldner wartet auf dein Geld' },
        right: { label: 'Rückstellung', icon: '⏳', color: 'amber', sub: 'Geparkte Schuld', desc: 'Jemand wird irgendwann Geld fordern' },
      },
      { type: 'callout', emoji: '🎯', value: 'Eselsbrücke: Rück-LAGE = ich LEGE Geld zur Seite (EK). Rück-STELLUNG = ich STELLE mich auf eine Zahlung EIN (FK).' },
    ],
  },
  {
    title: 'Rücklagen = Eigenkapital', icon: '🏦',
    content: [
      { type: 'text', value: 'Rücklagen sind einbehaltene Gewinne oder Kapitalzuschüsse. Sie stärken das Eigenkapital und gehören den Eigentümern – kein Gläubiger hat Anspruch darauf.' },
      {
        type: 'cards', items: [
          { label: 'Gesetzliche Rücklage', desc: 'Pflicht! Z.B. GmbH: 5% des Jahresgewinns bis 10% des Stammkapitals.', icon: '⚖️', color: 'blue' },
          { label: 'Kapitalrücklage (Agio)', desc: 'Aufgeld bei Aktienausgabe über Nennwert.', icon: '📈', color: 'indigo' },
          { label: 'Gewinnrücklage', desc: 'Freiwillig aus Gewinnen gebildet.', icon: '💰', color: 'emerald' },
          { label: 'Satzungsmäßige Rücklage', desc: 'Im Gesellschaftsvertrag vorgesehen.', icon: '📜', color: 'purple' },
          { label: 'Stille Rücklage', desc: 'Verdeckt! Durch Unterbewertung von Aktiva oder Überbewertung von Passiva.', icon: '🤫', color: 'gray' },
        ],
      },
      { type: 'callout', emoji: '💡', value: 'Rücklagen entstehen NACH Steuern – sie mindern den Gewinn nicht, sie verwenden ihn.' },
    ],
  },
  {
    title: 'Rückstellungen = Fremdkapital', icon: '⏳',
    content: [
      { type: 'text', value: 'Rückstellungen sind Vorsorge für Verpflichtungen, die dem Grunde nach bestehen, aber in Höhe oder Zeitpunkt ungewiss sind. Sie haben Schuldcharakter!' },
      {
        type: 'cards', items: [
          { label: 'Abfertigungsrückstellung', desc: 'Für gesetzliche Abfertigungsansprüche der Mitarbeiter.', icon: '👋', color: 'amber' },
          { label: 'Urlaubsrückstellung', desc: 'Für offene Urlaubstage am Jahresende.', icon: '🏖️', color: 'blue' },
          { label: 'Gewährleistungsrückstellung', desc: 'Für mögliche Garantiefälle nach Verkauf.', icon: '🔧', color: 'red' },
          { label: 'Steuerrückstellung', desc: 'Für noch nicht veranlagte Steuern.', icon: '🏛️', color: 'purple' },
          { label: 'Pensionsrückstellung', desc: 'Für zugesagte Betriebspensionen.', icon: '👴', color: 'emerald' },
          { label: 'Prozessrückstellung', desc: 'Für laufende Rechtsstreitigkeiten.', icon: '⚖️', color: 'gray' },
        ],
      },
      { type: 'callout', emoji: '⚠️', value: 'Rückstellungen mindern den Gewinn VOR Steuern – das ist steuerlich vorteilhaft! Wenn Betrag UND Zeitpunkt feststehen → ist es eine Verbindlichkeit, keine Rückstellung.' },
    ],
  },
  {
    title: 'Wo in der Bilanz?', icon: '📋',
    content: [
      { type: 'text', value: 'Die Passivseite der Bilanz hat eine klare Ordnung. Rücklagen und Rückstellungen sitzen an ganz verschiedenen Stellen:' },
      {
        type: 'bilanz', items: [
          { label: 'Eigenkapital', sub: 'Stammkapital, Rücklagen, Gewinn/Verlust', color: 'blue', icon: '🏦', includes: ['Stammkapital', 'Gesetzliche Rücklage', 'Kapitalrücklage', 'Gewinnrücklage', 'Bilanzgewinn/-verlust'] },
          { label: 'Rückstellungen', sub: 'Ungewisse Verbindlichkeiten', color: 'amber', icon: '⏳', includes: ['Abfertigungsrückstellung', 'Steuerrückstellung', 'Urlaubsrückstellung', 'Gewährleistungs-RST'] },
          { label: 'Verbindlichkeiten', sub: 'Sichere Schulden (Betrag + Zeitpunkt fix)', color: 'red', icon: '📄', includes: ['Bankkredit', 'Lieferantenverbindlichkeit', 'Darlehen'] },
        ],
      },
      { type: 'callout', emoji: '📌', value: 'Rückstellungen stehen ZWISCHEN Eigenkapital und Verbindlichkeiten – sie sind wie Schulden, nur noch nicht sicher in Höhe/Zeitpunkt.' },
    ],
  },
  {
    title: 'UGB vs. Steuerrecht', icon: '⚖️',
    content: [
      { type: 'text', value: 'Das UGB (Handelsbilanz) und das Steuerrecht behandeln Rückstellungen unterschiedlich. Wichtig für die Prüfung:' },
      {
        type: 'compareTable',
        headers: ['', 'UGB (Handelsbilanz)', 'Steuerrecht'],
        rows: [
          ['Prinzip', 'Vorsichtsprinzip → großzügiger', 'Enger gefasst'],
          ['Pflicht', 'Bildung bei wahrscheinlicher Verpflichtung', 'Viele RST nicht anerkannt'],
          ['Rücklagen', 'Alle Arten erlaubt', 'Stille Rücklagen problematisch'],
          ['Basis', 'Ausgangspunkt (Maßgeblichkeit)', 'Anpassungen nötig'],
        ],
      },
      { type: 'callout', emoji: '💡', value: 'Maßgeblichkeitsprinzip: Die Handelsbilanz (UGB) ist Ausgangspunkt für die Steuerbilanz – aber das Steuerrecht kann abweichen!' },
    ],
  },
  {
    title: 'Bereit zum Üben!', icon: '🚀',
    content: [
      { type: 'text', value: 'Die Kernunterschiede nochmal auf einen Blick:' },
      {
        type: 'compareTable',
        headers: ['', 'Rücklage', 'Rückstellung'],
        rows: [
          ['Bilanzposition', 'Eigenkapital', 'Fremdkapital'],
          ['Gläubiger?', 'Nein', 'Ja (potenzielle)'],
          ['Entsteht aus', 'Gewinn (nach Steuern)', 'Aufwand (vor Steuern)'],
          ['Betrag ungewiss?', 'Nein', 'Ja'],
          ['Steuereffekt', 'Kein direkter', 'Gewinnmindernd'],
        ],
      },
      {
        type: 'summary', items: [
          'Rücklage = gespartes Eigenkapital, kein Schuldner',
          'Rückstellung = geparkte Schuld, jemand wartet auf Geld',
          'Beide auf Passivseite, aber verschiedene Positionen',
          'UGB ist großzügiger als Steuerrecht bei RST-Bildung',
          'Wenn Betrag + Zeitpunkt fix → Verbindlichkeit, nicht RST',
        ],
      },
    ],
  },
];

// ─── Praxis-Daten ──────────────────────────────────────────────────────

const EX_TRUEFALSE: { text: string; answer: boolean; why: string }[] = [
  { text: 'Rückstellungen stärken das Eigenkapital.', answer: false, why: 'Rückstellungen sind Fremdkapital – sie stellen eine wahrscheinliche Schuld dar.' },
  { text: 'Rücklagen entstehen aus dem Gewinn nach Steuern.', answer: true, why: 'Rücklagen sind einbehaltene, bereits versteuerte Gewinne → Eigenkapital.' },
  { text: 'Wenn Betrag UND Zeitpunkt einer Schuld feststehen, bildet man eine Rückstellung.', answer: false, why: 'Dann ist es eine Verbindlichkeit! RST nur wenn Betrag ODER Zeitpunkt ungewiss.' },
  { text: 'Rückstellungen mindern den Gewinn vor Steuern.', answer: true, why: 'RST-Bildung = Aufwand in der GuV → mindert den Gewinn → steuerlich vorteilhaft.' },
  { text: 'Rücklagen haben Schuldcharakter.', answer: false, why: 'Rücklagen = Eigenkapital. Kein Gläubiger hat Anspruch darauf.' },
  { text: 'Stille Rücklagen sind in der Bilanz direkt sichtbar.', answer: false, why: "Deshalb heißen sie 'still' – sie entstehen durch Unterbewertung von Aktiva und sind verdeckt." },
  { text: 'Das Steuerrecht ist großzügiger bei der RST-Bildung als das UGB.', answer: false, why: 'Umgekehrt! Das UGB (Vorsichtsprinzip) ist großzügiger. Steuerrecht erkennt viele RST nicht an.' },
  { text: 'Bei Rückstellungen existieren potenzielle Gläubiger.', answer: true, why: 'RST = wahrscheinliche Verpflichtung → jemand wird voraussichtlich Geld fordern.' },
  { text: 'Eine Urlaubsrückstellung gehört zum Eigenkapital.', answer: false, why: 'Urlaubsrückstellung = Verpflichtung gegenüber Mitarbeitern → Fremdkapital.' },
  { text: 'Die Handelsbilanz (UGB) ist Ausgangspunkt für die Steuerbilanz.', answer: true, why: 'Maßgeblichkeitsprinzip – aber das Steuerrecht kann Anpassungen vornehmen.' },
];

type BilanzSection = 'ek' | 'rs' | 'vb';

const EX_BILANZ: { name: string; section: BilanzSection }[] = [
  { name: 'Stammkapital', section: 'ek' },
  { name: 'Gesetzliche Rücklage', section: 'ek' },
  { name: 'Urlaubsrückstellung', section: 'rs' },
  { name: 'Bankkredit', section: 'vb' },
  { name: 'Kapitalrücklage', section: 'ek' },
  { name: 'Gewährleistungs-RST', section: 'rs' },
  { name: 'Lieferantenverbindlichkeit', section: 'vb' },
  { name: 'Abfertigungsrückstellung', section: 'rs' },
  { name: 'Bilanzgewinn', section: 'ek' },
  { name: 'Darlehen', section: 'vb' },
  { name: 'Steuerrückstellung', section: 'rs' },
  { name: 'Gewinnrücklage', section: 'ek' },
];

type RlRs = 'rl' | 'rs';

const EX_PROPS: { text: string; answer: RlRs }[] = [
  { text: 'Hat Schuldcharakter', answer: 'rs' },
  { text: 'Gehört zum Eigenkapital', answer: 'rl' },
  { text: 'Entsteht aus Gewinn nach Steuern', answer: 'rl' },
  { text: 'Mindert den Gewinn vor Steuern', answer: 'rs' },
  { text: 'Betrag oder Zeitpunkt ungewiss', answer: 'rs' },
  { text: 'Kein Gläubiger hat Anspruch', answer: 'rl' },
  { text: 'Potenzielle Gläubiger existieren', answer: 'rs' },
  { text: 'Stärkt die Eigenkapitalbasis', answer: 'rl' },
];

const EX_CASES: { text: string; answer: RlRs; what: string; why: string }[] = [
  { text: 'Ein Kunde reklamiert ein Produkt. Es ist wahrscheinlich, dass Reparaturkosten anfallen – die genaue Höhe ist aber noch unklar.', answer: 'rs', what: 'Gewährleistungsrückstellung', why: 'Verpflichtung wahrscheinlich, Höhe ungewiss → RST' },
  { text: 'Die AG gibt 10.000 Aktien mit Nennwert 10€ zum Kurs von 15€ aus. Die Differenz von 50.000€ wird verbucht.', answer: 'rl', what: 'Kapitalrücklage (Agio)', why: 'Aufgeld über Nennwert → Eigenkapital' },
  { text: 'Am 31.12. haben Mitarbeiter noch 200 Urlaubstage offen. Das Unternehmen muss dafür vorsorgen.', answer: 'rs', what: 'Urlaubsrückstellung', why: 'Verpflichtung besteht, genaue Kosten beim Verbrauch' },
  { text: 'Die GmbH erzielt 80.000€ Jahresgewinn und muss laut Gesetz 5% einbehalten.', answer: 'rl', what: 'Gesetzliche Rücklage (4.000€)', why: 'Gesetzliche Pflicht, aus versteuertem Gewinn → EK' },
  { text: 'Das Unternehmen wird verklagt. Der Ausgang ist ungewiss, aber eine Zahlung von ca. 30.000€ ist wahrscheinlich.', answer: 'rs', what: 'Prozessrückstellung', why: 'Wahrscheinliche Verpflichtung, Höhe geschätzt → RST' },
  { text: 'Der Vorstand beschließt, 100.000€ des Gewinns nicht auszuschütten, sondern im Unternehmen zu belassen.', answer: 'rl', what: 'Gewinnrücklage', why: 'Freiwillige Thesaurierung → stärkt EK' },
];

const EX_PLACE: { name: string; amount: string; section: BilanzSection; icon: string }[] = [
  { name: 'Stammkapital', amount: '100.000', section: 'ek', icon: '🏛️' },
  { name: 'Gesetzliche Rücklage', amount: '5.000', section: 'ek', icon: '⚖️' },
  { name: 'Kapitalrücklage', amount: '20.000', section: 'ek', icon: '📈' },
  { name: 'Gewinnrücklage', amount: '15.000', section: 'ek', icon: '💰' },
  { name: 'Bilanzgewinn', amount: '30.000', section: 'ek', icon: '📊' },
  { name: 'Abfertigungs-RST', amount: '25.000', section: 'rs', icon: '👋' },
  { name: 'Urlaubs-RST', amount: '8.000', section: 'rs', icon: '🏖️' },
  { name: 'Gewährleistungs-RST', amount: '12.000', section: 'rs', icon: '🔧' },
  { name: 'Steuer-RST', amount: '5.000', section: 'rs', icon: '🏛️' },
  { name: 'Bankkredit', amount: '80.000', section: 'vb', icon: '🏦' },
  { name: 'Lieferantenverb.', amount: '20.000', section: 'vb', icon: '📦' },
  { name: 'Darlehen', amount: '45.000', section: 'vb', icon: '📄' },
];

// ─── Color-Helper ──────────────────────────────────────────────────────

const palette: Record<ColorKey, { text: string; bgSoft: string; border: string; chip: string }> = {
  indigo:  { text: 'text-indigo-400',  bgSoft: 'bg-indigo-500/10',  border: 'border-indigo-500/40',  chip: 'bg-indigo-500/15 text-indigo-300' },
  blue:    { text: 'text-blue-400',    bgSoft: 'bg-blue-500/10',    border: 'border-blue-500/40',    chip: 'bg-blue-500/15 text-blue-300' },
  emerald: { text: 'text-emerald-400', bgSoft: 'bg-emerald-500/10', border: 'border-emerald-500/40', chip: 'bg-emerald-500/15 text-emerald-300' },
  red:     { text: 'text-red-400',     bgSoft: 'bg-red-500/10',     border: 'border-red-500/40',     chip: 'bg-red-500/15 text-red-300' },
  amber:   { text: 'text-amber-400',   bgSoft: 'bg-amber-500/10',   border: 'border-amber-500/40',   chip: 'bg-amber-500/15 text-amber-300' },
  purple:  { text: 'text-purple-400',  bgSoft: 'bg-purple-500/10',  border: 'border-purple-500/40',  chip: 'bg-purple-500/15 text-purple-300' },
  gray:    { text: 'text-[#9ca3af]',   bgSoft: 'bg-[#252840]',      border: 'border-[#3d4168]',      chip: 'bg-[#252840] text-[#d1d5db]' },
};

const bilanzSectionColor: Record<BilanzSection, ColorKey> = { ek: 'blue', rs: 'amber', vb: 'red' };
const bilanzSectionIcon: Record<BilanzSection, string> = { ek: '🏦', rs: '⏳', vb: '📄' };
const bilanzSectionLabel: Record<BilanzSection, string> = { ek: 'Eigenkapital', rs: 'Rückstellungen', vb: 'Verbindlichkeiten' };
const bilanzSectionSub: Record<BilanzSection, string> = {
  ek: 'Stammkapital, Rücklagen, Gewinn',
  rs: 'Ungewisse Verbindlichkeiten',
  vb: 'Sichere Schulden',
};

// ─── Mini-UI-Helfer ────────────────────────────────────────────────────

function PillBtn({
  label, active, onClick, color, small,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  color: ColorKey;
  small?: boolean;
}) {
  const c = palette[color];
  const sz = small ? 'text-[11px] px-2 py-1' : 'text-xs px-3 py-1.5';
  const cls = active
    ? `${c.chip} border ${c.border} font-bold`
    : 'bg-[#252840] border border-[#3d4168] text-[#9ca3af] hover:text-white';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${sz} rounded-lg ${cls} font-semibold transition-colors whitespace-nowrap`}
    >
      {label}
    </button>
  );
}

function ActionBtn({
  label, onClick, variant = 'primary',
}: {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'success';
}) {
  const bg = variant === 'success'
    ? 'bg-emerald-500 hover:bg-emerald-400'
    : 'bg-indigo-500 hover:bg-indigo-400';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`mt-3 px-6 py-2.5 rounded-xl ${bg} text-white font-bold text-sm transition-colors`}
    >
      {label}
    </button>
  );
}

function Feedback({ fb }: { fb: { ok: boolean; msg: string } | null }) {
  if (!fb) return null;
  return (
    <div
      className={`my-3 px-4 py-3 rounded-xl border text-sm leading-relaxed ${
        fb.ok
          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
          : 'bg-red-500/10 border-red-500/30 text-red-300'
      }`}
    >
      {fb.ok ? '✅ ' : '❌ '}{fb.msg}
    </div>
  );
}

// ─── Theorie-Block-Renderer ────────────────────────────────────────────

function Block({ block }: { block: ContentBlock }) {
  if (block.type === 'text') {
    return <p className="text-sm leading-relaxed text-[#d1d5db] mb-3">{block.value}</p>;
  }

  if (block.type === 'callout') {
    return (
      <div className="px-4 py-3 rounded-xl bg-indigo-500/10 border border-indigo-500/30 my-3 flex gap-2.5 items-start">
        <span className="text-lg shrink-0">{block.emoji}</span>
        <span className="text-sm leading-relaxed text-[#d1d5db]">{block.value}</span>
      </div>
    );
  }

  if (block.type === 'versus') {
    const renderSide = (s: VersusItem) => {
      const c = palette[s.color];
      return (
        <div className={`rounded-xl border ${c.border} ${c.bgSoft} p-4 text-center`}>
          <div className="text-3xl mb-1.5">{s.icon}</div>
          <div className={`text-base font-extrabold ${c.text}`}>{s.label}</div>
          <div className="text-xs text-[#9ca3af] mt-0.5">{s.sub}</div>
          <div className={`text-xs text-[#d1d5db] mt-2 px-2.5 py-1.5 rounded-lg ${c.chip}`}>{s.desc}</div>
        </div>
      );
    };
    return (
      <div className="my-4 grid grid-cols-[1fr_auto_1fr] gap-2 items-center">
        {renderSide(block.left)}
        <div className="font-extrabold text-base text-[#6b7280]">vs</div>
        {renderSide(block.right)}
      </div>
    );
  }

  if (block.type === 'cards') {
    return (
      <div className="my-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
        {block.items.map((c, j) => {
          const p = palette[c.color];
          return (
            <div
              key={j}
              className={`bg-[#1e2130] border border-[#2d3148] rounded-xl p-3 ${p.text}`}
              style={{ borderLeft: '4px solid currentColor' }}
            >
              <div className="text-lg mb-1">{c.icon}</div>
              <div className={`text-xs font-bold ${p.text} mb-1`}>{c.label}</div>
              <div className="text-xs text-[#d1d5db] leading-relaxed">{c.desc}</div>
            </div>
          );
        })}
      </div>
    );
  }

  if (block.type === 'bilanz') {
    return (
      <div className="my-4 rounded-xl overflow-hidden border-2 border-[#3d4168]">
        <div className="bg-[#252840] text-white py-2.5 px-4 font-extrabold text-sm text-center">
          📋 PASSIVSEITE DER BILANZ
        </div>
        {block.items.map((s, j) => {
          const p = palette[s.color];
          return (
            <div
              key={j}
              className={`p-3.5 ${j < block.items.length - 1 ? 'border-b border-[#2d3148]' : ''} ${j % 2 === 0 ? 'bg-[#1e2130]' : 'bg-[#1a1d27]'}`}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-lg">{s.icon}</span>
                <div>
                  <div className={`font-extrabold text-sm ${p.text}`}>{s.label}</div>
                  <div className="text-[11px] text-[#9ca3af]">{s.sub}</div>
                </div>
              </div>
              <div className="flex gap-1 flex-wrap">
                {s.includes.map((item, k) => (
                  <span key={k} className={`text-[11px] px-2 py-0.5 rounded-md ${p.chip} font-semibold`}>
                    {item}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  if (block.type === 'compareTable') {
    return (
      <div className="my-3 overflow-x-auto">
        <table className="w-full border-collapse bg-[#1e2130] rounded-xl overflow-hidden border border-[#2d3148] text-sm">
          <thead>
            <tr>
              {block.headers.map((h, j) => (
                <th
                  key={j}
                  className={`py-2.5 px-3 bg-[#252840] text-[#d1d5db] font-bold text-xs ${j === 0 ? 'text-left' : 'text-center'}`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((r, j) => (
              <tr key={j}>
                {r.map((cell, k) => (
                  <td
                    key={k}
                    className={`py-2.5 px-3 border-b border-[#2d3148] text-sm ${k === 0 ? 'font-bold text-white text-left' : 'text-[#d1d5db] text-center'} ${j % 2 === 0 ? 'bg-[#1e2130]' : 'bg-[#1a1d27]'}`}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (block.type === 'summary') {
    return (
      <div className="my-3">
        {block.items.map((item, j) => (
          <div key={j} className="flex gap-2.5 items-start mb-2">
            <div className="w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center text-[11px] font-extrabold shrink-0 mt-0.5">
              ✓
            </div>
            <span className="text-sm text-[#d1d5db] leading-relaxed">{item}</span>
          </div>
        ))}
      </div>
    );
  }

  return null;
}

// ─── Theorie-Ansicht ───────────────────────────────────────────────────

function TheoryView({
  page, idx, total, onNext, onPrev, onStart,
}: {
  page: TheoryPage;
  idx: number;
  total: number;
  onNext: () => void;
  onPrev: () => void;
  onStart: () => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <span className="text-3xl">{page.icon}</span>
        <h2 className="text-xl font-extrabold text-white leading-tight m-0">{page.title}</h2>
      </div>
      {page.content.map((b, i) => <Block key={i} block={b} />)}

      <div className="flex gap-2.5 mt-5">
        {idx > 0 && (
          <button
            type="button"
            onClick={onPrev}
            className="flex-1 py-3 rounded-xl border border-[#2d3148] bg-[#1e2130] hover:bg-[#252840] text-[#9ca3af] hover:text-white text-sm font-bold transition-colors"
          >
            ← Zurück
          </button>
        )}
        {idx === total - 1 ? (
          <button
            type="button"
            onClick={onStart}
            className="flex-[2] py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white text-sm font-bold transition-colors"
          >
            ✏️ Jetzt üben!
          </button>
        ) : (
          <button
            type="button"
            onClick={onNext}
            className="flex-[2] py-3 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white text-sm font-bold transition-colors"
          >
            Weiter →
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Praxis-Ansicht ────────────────────────────────────────────────────

const EXES: { id: 'tf' | 'bilanz' | 'props' | 'cases' | 'place'; n: number; label: string }[] = [
  { id: 'tf',     n: 1, label: 'Richtig/Falsch' },
  { id: 'bilanz', n: 2, label: 'Bilanz-Zuordnung' },
  { id: 'props',  n: 3, label: 'Eigenschaften' },
  { id: 'cases',  n: 4, label: 'Praxisfälle' },
  { id: 'place',  n: 5, label: 'Bilanz bauen' },
];

function PracticeView({ onBack }: { onBack: () => void }) {
  const [ex, setEx] = useState(0);
  const [fb, setFb] = useState<{ ok: boolean; msg: string } | null>(null);
  const [done, setDone] = useState<Record<string, boolean>>({});

  const [tf, setTf] = useState<Record<number, boolean>>({});
  const [bilanz, setBilanz] = useState<Record<number, BilanzSection>>({});
  const [props_, setProps_] = useState<Record<number, RlRs>>({});
  const [cases, setCases] = useState<Record<number, RlRs>>({});
  const [selected, setSelected] = useState<number | null>(null);
  const [placed, setPlaced] = useState<Record<number, BilanzSection>>({});

  // Einmaliges Shuffle für die Bilanz-Bau-Übung
  const [shuffled] = useState(() => [...EX_PLACE].map((s, i) => ({ ...s, origIdx: i })).sort(() => Math.random() - 0.5));

  const clr = () => setFb(null);
  const ok = (k: string) => setDone(p => ({ ...p, [k]: true }));
  const suc = (m: string) => setFb({ ok: true, msg: m });
  const err = (m: string) => setFb({ ok: false, msg: m });

  const check1 = () => {
    if (!EX_TRUEFALSE.every((_, i) => tf[i] !== undefined)) return err('Bitte alle Aussagen beantworten.');
    const w = EX_TRUEFALSE.filter((e, i) => tf[i] !== e.answer);
    if (w.length) return err(`${w.length} falsch.`);
    suc('Alle richtig!'); ok('tf');
  };
  const check2 = () => {
    if (!EX_BILANZ.every((_, i) => bilanz[i])) return err('Bitte alle Positionen zuordnen.');
    const w = EX_BILANZ.filter((e, i) => bilanz[i] !== e.section);
    if (w.length) return err(`${w.length} falsch: ${w.map(e => e.name).join(', ')}`);
    suc('Bilanz perfekt aufgebaut!'); ok('bilanz');
  };
  const check3 = () => {
    if (!EX_PROPS.every((_, i) => props_[i])) return err('Bitte alle Eigenschaften zuordnen.');
    const w = EX_PROPS.filter((e, i) => props_[i] !== e.answer);
    if (w.length) return err(`${w.length} falsch: ${w.map(e => `"${e.text}"`).join(', ')}`);
    suc('Alle Eigenschaften richtig!'); ok('props');
  };
  const check4 = () => {
    if (!EX_CASES.every((_, i) => cases[i])) return err('Bitte alle Fälle beantworten.');
    const w = EX_CASES.filter((e, i) => cases[i] !== e.answer);
    if (w.length) return err(`${w.length} falsch.`);
    suc('Alle Praxisfälle richtig!'); ok('cases');
  };
  const check5 = () => {
    const unplaced = shuffled.filter((_, i) => !placed[i]);
    if (unplaced.length) return err(`Noch ${unplaced.length} Posten nicht platziert.`);
    const w = shuffled.filter((s, i) => placed[i] !== EX_PLACE[s.origIdx].section);
    if (w.length) return err(`${w.length} Posten falsch platziert: ${w.map(s => s.name).join(', ')}`);
    suc('Bilanz perfekt aufgebaut!'); ok('place');
  };

  return (
    <div>
      {/* Übungs-Nav */}
      <div className="flex gap-1 mb-5 flex-wrap">
        {EXES.map((e, i) => {
          const active = ex === i;
          const completed = done[e.id];
          const cls = active
            ? 'bg-indigo-500 text-white shadow-md shadow-indigo-500/30'
            : completed
              ? 'bg-indigo-500/15 text-indigo-300'
              : 'bg-[#252840] text-[#6b7280]';
          return (
            <button
              key={e.id}
              type="button"
              onClick={() => { setEx(i); clr(); }}
              className={`flex-1 min-w-[60px] py-2 px-1 rounded-lg text-xs font-bold transition-colors ${cls}`}
            >
              {completed && !active ? '✓' : `${e.n}.`} <span className="hidden sm:inline">{e.label}</span>
            </button>
          );
        })}
      </div>

      {/* ═══ Übung 1: True/False ═══ */}
      {ex === 0 && (
        <div>
          <div className="mb-4">
            <div className="text-[10px] font-bold text-[#9ca3af] uppercase tracking-widest mb-1">Übung 1</div>
            <div className="text-xl font-extrabold text-white">Richtig oder Falsch?</div>
            <div className="text-xs text-[#9ca3af] mt-1">Stimmen diese Aussagen?</div>
          </div>
          {EX_TRUEFALSE.map((e, i) => (
            <Card key={i} className="mb-2">
              <div className="font-semibold text-sm mb-2 leading-relaxed text-[#d1d5db]">„{e.text}"</div>
              <div className="flex gap-1.5">
                <PillBtn label="✅ Richtig" active={tf[i] === true} color="emerald" onClick={() => { setTf(p => ({ ...p, [i]: true })); clr(); }} />
                <PillBtn label="❌ Falsch" active={tf[i] === false} color="red" onClick={() => { setTf(p => ({ ...p, [i]: false })); clr(); }} />
              </div>
              {done.tf && (
                <div className={`mt-2 px-2.5 py-1.5 rounded-md text-xs leading-relaxed ${tf[i] === e.answer ? 'bg-emerald-500/10 text-emerald-200' : 'bg-red-500/10 text-red-200'}`}>
                  {tf[i] === e.answer ? '✅' : '❌'} {e.why}
                </div>
              )}
            </Card>
          ))}
          <Feedback fb={fb} />
          {!done.tf
            ? <ActionBtn label="Überprüfen" onClick={check1} />
            : <ActionBtn label="Weiter →" onClick={() => { setEx(1); clr(); }} variant="success" />}
        </div>
      )}

      {/* ═══ Übung 2: Bilanz-Zuordnung ═══ */}
      {ex === 1 && (
        <div>
          <div className="mb-4">
            <div className="text-[10px] font-bold text-[#9ca3af] uppercase tracking-widest mb-1">Übung 2</div>
            <div className="text-xl font-extrabold text-white">Bilanz-Zuordnung</div>
            <div className="text-xs text-[#9ca3af] mt-1">Ordne jede Position dem richtigen Bilanzbereich zu.</div>
          </div>
          {/* Schema-Header */}
          <div className="rounded-xl overflow-hidden border-2 border-[#3d4168] mb-3.5">
            <div className="bg-[#252840] text-white py-2 px-4 font-extrabold text-xs text-center">📋 PASSIVSEITE</div>
            {(['ek', 'rs', 'vb'] as BilanzSection[]).map(secId => {
              const p = palette[bilanzSectionColor[secId]];
              return (
                <div key={secId} className={`py-2 px-3.5 border-b border-[#2d3148] flex items-center gap-2 ${p.bgSoft}`}>
                  <span className="text-base">{bilanzSectionIcon[secId]}</span>
                  <span className={`font-bold text-xs ${p.text}`}>{bilanzSectionLabel[secId]}</span>
                </div>
              );
            })}
          </div>
          {EX_BILANZ.map((e, i) => (
            <Card key={i} className="mb-2 flex justify-between items-center flex-wrap gap-1.5">
              <span className="font-semibold text-sm text-[#d1d5db]">{e.name}</span>
              <div className="flex gap-1 flex-wrap">
                {(['ek', 'rs', 'vb'] as BilanzSection[]).map(secId => (
                  <PillBtn
                    key={secId}
                    label={`${bilanzSectionIcon[secId]} ${bilanzSectionLabel[secId]}`}
                    active={bilanz[i] === secId}
                    color={bilanzSectionColor[secId]}
                    onClick={() => { setBilanz(p => ({ ...p, [i]: secId })); clr(); }}
                    small
                  />
                ))}
              </div>
            </Card>
          ))}
          <Feedback fb={fb} />
          {!done.bilanz ? (
            <ActionBtn label="Überprüfen" onClick={check2} />
          ) : (
            <div>
              {/* Ergebnis-Bilanz */}
              <div className="rounded-xl overflow-hidden border-2 border-emerald-500/40 my-3.5">
                <div className="bg-[#252840] text-emerald-300 py-2 px-4 font-extrabold text-xs text-center">✅ Deine Bilanz</div>
                {(['ek', 'rs', 'vb'] as BilanzSection[]).map(secId => {
                  const p = palette[bilanzSectionColor[secId]];
                  return (
                    <div key={secId} className={`p-3 border-b border-[#2d3148] ${p.bgSoft}`}>
                      <div className={`font-bold text-xs ${p.text} mb-1.5`}>
                        {bilanzSectionIcon[secId]} {bilanzSectionLabel[secId]}
                      </div>
                      <div className="flex gap-1 flex-wrap">
                        {EX_BILANZ.filter(e => e.section === secId).map((e, j) => (
                          <span key={j} className={`text-[11px] px-2 py-0.5 rounded-md ${p.chip} font-semibold`}>{e.name}</span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              <ActionBtn label="Weiter →" onClick={() => { setEx(2); clr(); }} variant="success" />
            </div>
          )}
        </div>
      )}

      {/* ═══ Übung 3: Eigenschaften ═══ */}
      {ex === 2 && (
        <div>
          <div className="mb-4">
            <div className="text-[10px] font-bold text-[#9ca3af] uppercase tracking-widest mb-1">Übung 3</div>
            <div className="text-xl font-extrabold text-white">Wem gehört die Eigenschaft?</div>
            <div className="text-xs text-[#9ca3af] mt-1">Gilt das für Rücklagen oder Rückstellungen?</div>
          </div>
          {EX_PROPS.map((e, i) => (
            <Card key={i} className="mb-2 flex justify-between items-center flex-wrap gap-2">
              <span className="font-semibold text-sm flex-1 text-[#d1d5db]">„{e.text}"</span>
              <div className="flex gap-1">
                <PillBtn label="🏦 Rücklage" active={props_[i] === 'rl'} color="blue" onClick={() => { setProps_(p => ({ ...p, [i]: 'rl' })); clr(); }} small />
                <PillBtn label="⏳ Rückstellung" active={props_[i] === 'rs'} color="amber" onClick={() => { setProps_(p => ({ ...p, [i]: 'rs' })); clr(); }} small />
              </div>
            </Card>
          ))}
          <Feedback fb={fb} />
          {!done.props
            ? <ActionBtn label="Überprüfen" onClick={check3} />
            : <ActionBtn label="Weiter →" onClick={() => { setEx(3); clr(); }} variant="success" />}
        </div>
      )}

      {/* ═══ Übung 4: Praxisfälle ═══ */}
      {ex === 3 && (
        <div>
          <div className="mb-4">
            <div className="text-[10px] font-bold text-[#9ca3af] uppercase tracking-widest mb-1">Übung 4</div>
            <div className="text-xl font-extrabold text-white">Praxisfälle</div>
            <div className="text-xs text-[#9ca3af] mt-1">Was wird hier gebildet?</div>
          </div>
          {EX_CASES.map((e, i) => (
            <Card key={i} className="mb-2.5">
              <div className="text-sm leading-relaxed text-[#d1d5db] mb-2.5">{e.text}</div>
              <div className="flex gap-1.5 flex-wrap">
                <PillBtn label="🏦 Rücklage bilden" active={cases[i] === 'rl'} color="blue" onClick={() => { setCases(p => ({ ...p, [i]: 'rl' })); clr(); }} />
                <PillBtn label="⏳ Rückstellung bilden" active={cases[i] === 'rs'} color="amber" onClick={() => { setCases(p => ({ ...p, [i]: 'rs' })); clr(); }} />
              </div>
              {done.cases && (
                <div className={`mt-2.5 px-3 py-2 rounded-md text-xs leading-relaxed ${cases[i] === e.answer ? 'bg-emerald-500/10 text-emerald-200' : 'bg-red-500/10 text-red-200'}`}>
                  <strong>{cases[i] === e.answer ? '✅' : '❌'} {e.what}</strong> – {e.why}
                </div>
              )}
            </Card>
          ))}
          <Feedback fb={fb} />
          {!done.cases
            ? <ActionBtn label="Überprüfen" onClick={check4} />
            : <ActionBtn label="Weiter →" onClick={() => { setEx(4); clr(); }} variant="success" />}
        </div>
      )}

      {/* ═══ Übung 5: Bilanz bauen (Click-to-Place) ═══ */}
      {ex === 4 && (() => {
        const unplaced = shuffled.map((s, i) => ({ ...s, i })).filter(({ i }) => !placed[i]);
        const placedIn = (secId: BilanzSection) =>
          shuffled.map((s, i) => ({ ...s, i })).filter(({ i }) => placed[i] === secId);
        const hasSelection = selected !== null;

        return (
          <div>
            <div className="mb-4">
              <div className="text-[10px] font-bold text-[#9ca3af] uppercase tracking-widest mb-1">Übung 5</div>
              <div className="text-xl font-extrabold text-white">Bilanz bauen</div>
              <div className="text-xs text-[#9ca3af] mt-1">
                {hasSelection
                  ? 'Klicke auf den richtigen Bilanzbereich →'
                  : 'Wähle einen Posten aus, dann platziere ihn in der Bilanz.'}
              </div>
            </div>

            {/* Bilanz mit Drop-Zonen */}
            <div className="rounded-xl overflow-hidden border-2 border-[#3d4168] mb-4">
              <div className="bg-[#252840] text-white py-2.5 px-4 font-extrabold text-sm text-center">
                📋 PASSIVSEITE DER BILANZ
              </div>
              {(['ek', 'rs', 'vb'] as BilanzSection[]).map(secId => {
                const items = placedIn(secId);
                const p = palette[bilanzSectionColor[secId]];
                return (
                  <div
                    key={secId}
                    onClick={() => {
                      if (selected !== null) {
                        setPlaced(prev => ({ ...prev, [selected]: secId }));
                        setSelected(null);
                        clr();
                      }
                    }}
                    className={`p-3.5 border-b border-[#2d3148] transition-colors min-h-[60px] ${
                      hasSelection
                        ? `${p.bgSoft} cursor-pointer border border-dashed ${p.border}`
                        : 'bg-[#1e2130]'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-lg">{bilanzSectionIcon[secId]}</span>
                      <div>
                        <div className={`font-extrabold text-sm ${p.text}`}>{bilanzSectionLabel[secId]}</div>
                        <div className="text-[11px] text-[#9ca3af]">{bilanzSectionSub[secId]}</div>
                      </div>
                      {hasSelection && (
                        <span className={`ml-auto text-[10px] ${p.text} font-bold ${p.chip} px-2 py-0.5 rounded-md`}>
                          ↓ Hier ablegen
                        </span>
                      )}
                    </div>
                    {items.length > 0 && (
                      <div className="flex gap-1 flex-wrap mt-1">
                        {items.map(item => (
                          <span
                            key={item.i}
                            onClick={(e) => {
                              e.stopPropagation();
                              setPlaced(prev => {
                                const n = { ...prev };
                                delete n[item.i];
                                return n;
                              });
                            }}
                            className={`text-[11px] px-2 py-1 rounded-md ${p.chip} font-semibold cursor-pointer flex items-center gap-1`}
                          >
                            {item.icon} {item.name}
                            <span className="font-mono text-[10px] opacity-90">{item.amount}€</span>
                            <span className="text-[10px] opacity-50">✕</span>
                          </span>
                        ))}
                      </div>
                    )}
                    {items.length === 0 && !hasSelection && (
                      <div className="text-[11px] text-[#6b7280] italic">Noch leer</div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Pool unplatzierter Posten */}
            {unplaced.length > 0 && (
              <div>
                <div className="text-[11px] font-bold text-[#9ca3af] uppercase tracking-wider mb-2">
                  Posten zum Platzieren ({unplaced.length} übrig)
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  {unplaced.map(item => {
                    const isSel = selected === item.i;
                    return (
                      <button
                        key={item.i}
                        type="button"
                        onClick={() => { setSelected(isSel ? null : item.i); clr(); }}
                        className={`px-2.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                          isSel
                            ? 'border-2 border-indigo-500 bg-indigo-500/20 text-white shadow-md shadow-indigo-500/30'
                            : 'border border-[#2d3148] bg-[#1e2130] text-[#d1d5db] hover:bg-[#252840]'
                        }`}
                      >
                        <span>{item.icon}</span>
                        {item.name}
                        <span className="font-mono text-[10px] text-[#9ca3af]">{item.amount}€</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <Feedback fb={fb} />
            {!done.place ? (
              <ActionBtn label="Überprüfen" onClick={check5} />
            ) : (
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 mt-3.5 text-center">
                <div className="text-3xl mb-1.5">🎉</div>
                <div className="font-extrabold text-base text-white">Alle 5 Übungen geschafft!</div>
                <div className="text-xs text-[#9ca3af] mt-1">
                  Du weißt genau, wo Rücklagen und Rückstellungen in der Bilanz stehen.
                </div>
              </div>
            )}
          </div>
        );
      })()}

      <button
        type="button"
        onClick={onBack}
        className="w-full py-2.5 rounded-lg border border-indigo-500/30 bg-transparent text-[#9ca3af] hover:text-white text-xs transition-colors mt-4"
      >
        📖 Zurück zur Theorie
      </button>
    </div>
  );
}

// ─── Hauptkomponente ───────────────────────────────────────────────────

export default function RLRSKurs({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<'theory' | 'practice'>('theory');
  const [tp, setTp] = useState(0);

  return (
    <ExerciseShell
      title="Rücklagen & Rückstellungen"
      subtitle="Bilanzierung – Eigenkapital vs. Fremdkapital"
      onClose={onClose}
    >
      <div className="max-w-2xl mx-auto">
        {/* Mode toggle */}
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-[#2d3148]">
          <div>
            <div className="text-[10px] font-extrabold text-indigo-400 uppercase tracking-[0.2em]">
              Rücklagen & Rückstellungen
            </div>
            <div className="text-[11px] text-[#6b7280] mt-0.5">
              {mode === 'theory' ? `Lektion ${tp + 1}/${theory.length}` : 'Übungsmodus'}
            </div>
          </div>
          <div className="flex rounded-lg overflow-hidden border border-indigo-500/30">
            <button
              type="button"
              onClick={() => setMode('theory')}
              className={`px-3 py-1.5 text-xs font-bold transition-colors ${
                mode === 'theory' ? 'bg-indigo-500 text-white' : 'bg-transparent text-[#9ca3af] hover:text-white'
              }`}
            >
              📖 Theorie
            </button>
            <button
              type="button"
              onClick={() => setMode('practice')}
              className={`px-3 py-1.5 text-xs font-bold transition-colors ${
                mode === 'practice' ? 'bg-indigo-500 text-white' : 'bg-transparent text-[#9ca3af] hover:text-white'
              }`}
            >
              ✏️ Üben
            </button>
          </div>
        </div>

        {/* Klickbare Progress-Dots (nur in Theorie) */}
        {mode === 'theory' && (
          <div className="flex gap-1 mb-5">
            {theory.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setTp(i)}
                className={`flex-1 h-1.5 rounded-full transition-colors ${
                  i === tp
                    ? 'bg-indigo-500'
                    : i < tp
                      ? 'bg-emerald-500/50'
                      : 'bg-[#252840]'
                }`}
                aria-label={`Lektion ${i + 1}`}
              />
            ))}
          </div>
        )}

        {mode === 'theory' ? (
          <TheoryView
            page={theory[tp]}
            idx={tp}
            total={theory.length}
            onNext={() => setTp(p => Math.min(p + 1, theory.length - 1))}
            onPrev={() => setTp(p => Math.max(p - 1, 0))}
            onStart={() => setMode('practice')}
          />
        ) : (
          <PracticeView onBack={() => setMode('theory')} />
        )}

        <div className="text-center text-[10px] text-[#6b7280] mt-5 pb-4">
          FH Wien · Rechnungswesen · Bilanzierung
        </div>
      </div>
    </ExerciseShell>
  );
}
