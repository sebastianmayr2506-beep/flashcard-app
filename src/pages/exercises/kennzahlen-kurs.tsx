// Unternehmenskennzahlen Kurs
// 6 Theorie-Lektionen + 4 verschiedene Praxis-Mechaniken zu den
// klassischen Finanzkennzahlen (Rentabilität, Stabilität, Liquidität,
// Effizienz).
//
// Praxis besteht aus 4 unabhängigen Übungen (eigene States, eigene
// Restart-Logik, eigene Scores):
//   1. Formel-Baukasten: Click-to-place Zähler + Nenner aus Tile-Pool
//   2. Interpretation: MC welche Aussage zur Formel passt
//   3. Berechnen: Konkrete Zahlen → Ergebnis eintippen
//   4. Krisendiagnose: Kennzahlen-Übersicht → gesund/warnung/krise
//
// Color-Coding pro Kategorie (semantisch konsistent durch Theorie + Praxis):
//   Rentabilität = amber, Stabilität = blue, Liquidität = cyan,
//   Effizienz = emerald

import { useState } from 'react';
import { ExerciseShell, Card } from './_shared';

// ─── Kennzahlen-Daten ──────────────────────────────────────────────────

type Category = 'Rentabilität' | 'Stabilität' | 'Liquidität' | 'Effizienz';
type CatColor = 'amber' | 'blue' | 'cyan' | 'emerald';
const CAT_COLOR: Record<Category, CatColor> = {
  'Rentabilität': 'amber',
  'Stabilität': 'blue',
  'Liquidität': 'cyan',
  'Effizienz': 'emerald',
};

interface Kennzahl {
  name: string;
  full: string;
  cat: Category;
  icon: string;
  tmpl: 'div' | 'sub';
  A: string;
  B: string;
  x100: boolean;
  tiles: string[];
  interp: string;
  wrong: string[];
  richtwert: string;
  why: string;
  calc?: { A_val: number; B_val: number; label: string; result: number; noX100?: boolean };
}

const KZ: Kennzahl[] = [
  { name: 'GKR', full: 'Gesamtkapitalrentabilität', cat: 'Rentabilität', icon: '📈',
    tmpl: 'div', A: 'Gewinn + FK-Zinsen', B: 'GK', x100: true,
    tiles: ['Gewinn + FK-Zinsen', 'Gewinn', 'GK', 'EK', 'FK', 'Umsatz', 'UV'],
    interp: 'Wie rentabel ist das gesamte eingesetzte Kapital (EK + FK)?',
    wrong: ['Rendite für Eigentümer', 'Zahlungsfähigkeit in 30 Tagen', 'Anteil FK am GK'],
    richtwert: '> 10 %',
    why: 'Zinsen werden addiert, weil sie die Vergütung für FK-Geber sind – Teil der Gesamtrendite.',
    calc: { A_val: 60000, B_val: 500000, label: 'Gewinn 50.000€, FK-Zinsen 10.000€, GK 500.000€', result: 12 },
  },
  { name: 'EKR', full: 'Eigenkapitalrentabilität', cat: 'Rentabilität', icon: '📈',
    tmpl: 'div', A: 'Gewinn', B: 'EK', x100: true,
    tiles: ['Gewinn', 'Gewinn + FK-Zinsen', 'EK', 'GK', 'FK', 'Umsatz'],
    interp: 'Rendite aus Sicht der Eigentümer',
    wrong: ['Rendite des Gesamtkapitals', 'Schuldendeckung in Jahren', 'Anteil EK am GK'],
    richtwert: '> Marktzinssatz',
    why: 'Nur Gewinn (kein Zins), nur EK – Sicht der Eigentümer.',
    calc: { A_val: 40000, B_val: 200000, label: 'Gewinn 40.000€, EK 200.000€', result: 20 },
  },
  { name: 'Umsatzrentabilität', full: 'Umsatzrentabilität', cat: 'Rentabilität', icon: '📈',
    tmpl: 'div', A: 'Gewinn', B: 'Umsatz', x100: true,
    tiles: ['Gewinn', 'Umsatz', 'GK', 'EK', 'Gewinn + FK-Zinsen', 'UV'],
    interp: 'Wie viel Gewinn bleibt pro 100 € Umsatz?',
    wrong: ['Rendite des Gesamtkapitals', 'Anteil EK am GK', 'Lagerdrehung pro Jahr'],
    richtwert: 'branchenabhängig',
    why: 'Je höher, desto profitabler ist der Umsatz.',
    calc: { A_val: 30000, B_val: 600000, label: 'Gewinn 30.000€, Umsatz 600.000€', result: 5 },
  },
  { name: 'EK-Quote', full: 'Eigenkapitalquote', cat: 'Stabilität', icon: '🛡️',
    tmpl: 'div', A: 'EK', B: 'GK', x100: true,
    tiles: ['EK', 'FK', 'GK', 'Gewinn', 'Umsatz', 'UV', 'AV'],
    interp: 'Anteil des Eigenkapitals am Gesamtkapital',
    wrong: ['Rendite der Eigentümer', 'Puffer für kurzfr. Schulden', 'Wie oft Lager umgeschlagen'],
    richtwert: 'mind. 30 %',
    why: 'Unter 8% → Reorganisationsbedarf nach URG!',
    calc: { A_val: 400000, B_val: 1000000, label: 'EK 400.000€, GK 1.000.000€', result: 40 },
  },
  { name: 'FK-Quote', full: 'Fremdkapitalquote', cat: 'Stabilität', icon: '🛡️',
    tmpl: 'div', A: 'FK', B: 'GK', x100: true,
    tiles: ['FK', 'EK', 'GK', 'Gewinn', 'Umsatz', 'UV'],
    interp: 'Anteil des Fremdkapitals am Gesamtkapital',
    wrong: ['Rendite der Fremdkapitalgeber', 'Anteil EK am GK', 'Sofortige Zahlungsfähigkeit'],
    richtwert: 'EK-Quote + FK-Quote = 100%',
    why: 'FK-Quote = 100% − EK-Quote.',
    calc: { A_val: 600000, B_val: 1000000, label: 'FK 600.000€, GK 1.000.000€', result: 60 },
  },
  { name: 'Verschuldungsgrad', full: 'Verschuldungsgrad', cat: 'Stabilität', icon: '⚖️',
    tmpl: 'div', A: 'FK', B: 'EK', x100: false,
    tiles: ['FK', 'EK', 'GK', 'Gewinn', 'Cashflow', 'Umsatz'],
    interp: 'Wie viel Fremdkapital kommt auf 1 € Eigenkapital?',
    wrong: ['Rendite aus EK-Sicht', 'Anteil FK am GK', 'Jahre bis Schulden getilgt'],
    richtwert: '< 2',
    why: 'Je niedriger, desto weniger von Gläubigern abhängig.',
    calc: { A_val: 600000, B_val: 400000, label: 'FK 600.000€, EK 400.000€', result: 1.5 },
  },
  { name: 'Fikt. Schuldentilgungsd.', full: 'Fiktive Schuldentilgungsdauer', cat: 'Stabilität', icon: '⏱️',
    tmpl: 'div', A: 'Nettoverbindlichkeiten', B: 'Cashflow', x100: false,
    tiles: ['Nettoverbindlichkeiten', 'Cashflow', 'GK', 'FK', 'EK', 'Gewinn', 'Umsatz'],
    interp: 'Wie viele Jahre braucht das Unternehmen, um alle Schulden aus dem Cashflow zu tilgen?',
    wrong: ['Rentabilität der Schulden', 'Anteil FK am GK', 'Lagerdrehung'],
    richtwert: '< 5 Jahre gut / > 15 Jahre = URG-kritisch',
    why: 'Cashflow, nicht Gewinn! Günstige Kennzahl für Kreditwürdigkeitsprüfung.',
    calc: { A_val: 500000, B_val: 100000, label: 'Nettoverbindlichkeiten 500.000€, Cashflow 100.000€', result: 5 },
  },
  { name: 'Liquidität 1. Grad', full: 'Liquidität 1. Grades (Cash Ratio)', cat: 'Liquidität', icon: '💵',
    tmpl: 'div', A: 'Flüssige Mittel', B: 'kurzfr. VB', x100: true,
    tiles: ['Flüssige Mittel', 'FM + Forderungen', 'UV', 'kurzfr. VB', 'GK', 'FK', 'Vorräte'],
    interp: 'Sofortige Zahlungsfähigkeit aus Kasse/Bank',
    wrong: ['Mittelfristige Zahlungsfähigkeit', 'Anteil EK am GK', 'Rendite des Umsatzes'],
    richtwert: 'ca. 20 %',
    why: 'Zu hoch = Kapital liegt unnötig brach.',
    calc: { A_val: 50000, B_val: 250000, label: 'Flüssige Mittel 50.000€, kurzfr. VB 250.000€', result: 20 },
  },
  { name: 'Liquidität 2. Grad', full: 'Liquidität 2. Grades (Quick Ratio)', cat: 'Liquidität', icon: '💧',
    tmpl: 'div', A: 'FM + Forderungen', B: 'kurzfr. VB', x100: true,
    tiles: ['FM + Forderungen', 'Flüssige Mittel', 'UV', 'kurzfr. VB', 'EK', 'GK', 'Vorräte'],
    interp: 'Kurzfristige Zahlungsfähigkeit ohne Vorräte',
    wrong: ['Nur sofortige Zahlungsfähigkeit', 'Zahlungsfähigkeit mit Vorräten', 'Rentabilität'],
    richtwert: 'ca. 100 % (Acid Test)',
    why: 'Vorräte brauchen Zeit zum Verkauf – daher hier nicht enthalten.',
    calc: { A_val: 250000, B_val: 250000, label: 'FM 50.000€ + Forderungen 200.000€, kurzfr. VB 250.000€', result: 100 },
  },
  { name: 'Liquidität 3. Grad', full: 'Liquidität 3. Grades (Current Ratio)', cat: 'Liquidität', icon: '🌊',
    tmpl: 'div', A: 'UV', B: 'kurzfr. VB', x100: true,
    tiles: ['UV', 'FM + Forderungen', 'AV', 'kurzfr. VB', 'GK', 'EK', 'Flüssige Mittel'],
    interp: 'Mittelfristige Zahlungsfähigkeit (gesamtes Umlaufvermögen)',
    wrong: ['Nur sofortige Zahlungsfähigkeit', 'Anteil UV am GK', 'Rendite des Kapitals'],
    richtwert: 'ca. 200 % (Rule of Two)',
    why: 'Alle kurzfristigen Assets (inkl. Vorräte) werden herangezogen.',
    calc: { A_val: 500000, B_val: 250000, label: 'UV 500.000€, kurzfr. VB 250.000€', result: 200 },
  },
  { name: 'Net Working Capital', full: 'Net Working Capital (NWC)', cat: 'Liquidität', icon: '🔒',
    tmpl: 'sub', A: 'UV', B: 'kurzfr. VB', x100: false,
    tiles: ['UV', 'FM + Forderungen', 'AV', 'kurzfr. VB', 'GK', 'EK', 'FK'],
    interp: 'Liquiditätspuffer: Was bleibt vom UV nach Abzug kurzfr. Schulden?',
    wrong: ['Verhältnis EK zu FK', 'Wie oft Lager umgedreht', 'Rendite des Umsatzes'],
    richtwert: '> 0 (negativ = Liquiditätsgefahr!)',
    why: 'NWC > 0 → sicher. NWC < 0 → Alarm!',
    calc: { A_val: 500000, B_val: 300000, label: 'UV 500.000€, kurzfr. VB 300.000€', result: 200000, noX100: true },
  },
  { name: 'Umschlagshäufigkeit', full: 'Umschlagshäufigkeit (Lagerumschlag)', cat: 'Effizienz', icon: '🔄',
    tmpl: 'div', A: 'Umsatz (EK-Preise)', B: 'Ø Lagerbestand', x100: false,
    tiles: ['Umsatz (EK-Preise)', 'Umsatz', 'Ø Lagerbestand', 'GK', 'UV', 'kurzfr. VB', 'AV'],
    interp: 'Wie oft wird das Lager pro Jahr komplett umgeschlagen?',
    wrong: ['Anteil UV am GK', 'Rendite des Umsatzes', 'Kurzfristige Zahlungsfähigkeit'],
    richtwert: 'je höher, desto besser',
    why: 'Hohe UH = wenig Kapital gebunden. Supermarkt: ~52×, Möbelhaus: ~3×.',
    calc: { A_val: 600000, B_val: 100000, label: 'Umsatz (EK) 600.000€, Ø Lagerbestand 100.000€', result: 6, noX100: true },
  },
  { name: 'Anlageintensität', full: 'Anlageintensität', cat: 'Effizienz', icon: '🏭',
    tmpl: 'div', A: 'AV', B: 'GK', x100: true,
    tiles: ['AV', 'UV', 'GK', 'EK', 'FK', 'Gewinn', 'Umsatz'],
    interp: 'Anteil des Anlagevermögens am Gesamtvermögen',
    wrong: ['Anteil UV am GK', 'Rendite des AV', 'Zahlungsfähigkeit'],
    richtwert: 'branchenabhängig (Industrie > Handel)',
    why: 'Hohe Anlageintensität = kapitalintensive Branche, weniger flexibel.',
    calc: { A_val: 700000, B_val: 1000000, label: 'AV 700.000€, GK 1.000.000€', result: 70 },
  },
];

interface CrisisCase {
  company: string;
  values: { label: string; value: string; bad: boolean; note: string }[];
  verdict: 'gesund' | 'warnung' | 'krise';
  label: string;
  why: string;
}

const CRISIS_CASES: CrisisCase[] = [
  { company: 'Alpha GmbH', values: [
    { label: 'EK-Quote', value: '6%', bad: true, note: 'Unter 8% → URG!' },
    { label: 'Fikt. Schuldentilgungsdauer', value: '18 Jahre', bad: true, note: 'Über 15 Jahre → URG!' },
    { label: 'Operativer Cashflow', value: '−50.000 €', bad: true, note: 'Negativ!' },
    { label: 'Liquidität 3. Grad', value: '80%', bad: true, note: 'Unter 100% = Alarm!' },
    { label: 'Umsatzrentabilität', value: '−2%', bad: true, note: 'Verlustbetrieb' },
  ], verdict: 'krise', label: '🚨 Akute Krise', why: '5 kritische Warnsignale: EK-Quote unter URG-Grenze, extreme Schuldentilgungsdauer, negativer CF, schlechte Liquidität, Verlust.' },
  { company: 'Beta AG', values: [
    { label: 'EK-Quote', value: '42%', bad: false, note: 'Gut (>30%)' },
    { label: 'Verschuldungsgrad', value: '1,4', bad: false, note: 'Unter 2 – okay' },
    { label: 'GKR', value: '14%', bad: false, note: 'Solide' },
    { label: 'Liquidität 3. Grad', value: '210%', bad: false, note: 'Über 200% – gut' },
    { label: 'Cashflow', value: 'positiv', bad: false, note: 'Gesund' },
  ], verdict: 'gesund', label: '✅ Finanziell gesund', why: 'Alle Kennzahlen im grünen Bereich.' },
  { company: 'Gamma KG', values: [
    { label: 'EK-Quote', value: '18%', bad: false, note: 'Über 8%, aber unter 30%' },
    { label: 'Fikt. Schuldentilgungsdauer', value: '8 Jahre', bad: true, note: 'Über 5 Jahre – Warnung' },
    { label: 'Liquidität 2. Grad', value: '75%', bad: true, note: 'Unter 100%' },
    { label: 'Umsatzrentabilität', value: '2%', bad: false, note: 'Niedrig aber positiv' },
    { label: 'Operativer Cashflow', value: 'positiv', bad: false, note: 'OK' },
  ], verdict: 'warnung', label: '⚠️ Warnsignale', why: '2 von 5 Kennzahlen kritisch. Kein Notfall, aber Handlungsbedarf bei Liquidität und Verschuldung.' },
];

// ─── Theorie ───────────────────────────────────────────────────────────

type TheoryBlock =
  | { type: 'text'; value: string }
  | { type: 'callout'; emoji: string; value: string }
  | { type: 'cats' }
  | { type: 'kz_group'; cat: Category }
  | { type: 'pyramid' }
  | { type: 'ex_overview' };

const THEORY: { title: string; icon: string; content: TheoryBlock[] }[] = [
  { title: 'Wozu Kennzahlen?', icon: '🔍', content: [
    { type: 'text', value: 'Kennzahlen verdichten komplexe Finanzinformationen auf vergleichbare Zahlen. Banken, Investoren und Manager nutzen sie täglich, um die finanzielle Gesundheit eines Unternehmens zu beurteilen.' },
    { type: 'cats' },
    { type: 'callout', emoji: '🎯', value: 'Merke: Keine Kennzahl steht allein! Immer mehrere Kategorien zusammen betrachten.' },
  ]},
  { title: 'Rentabilitätskennzahlen', icon: '📈', content: [
    { type: 'text', value: 'Rentabilitätskennzahlen messen, wie profitabel das eingesetzte Kapital ist.' },
    { type: 'kz_group', cat: 'Rentabilität' },
    { type: 'callout', emoji: '💡', value: "Bei der GKR werden FK-Zinsen zum Gewinn addiert – denn Zinsen sind die ‚Vergütung‘ für FK-Geber und Teil der Gesamtrendite des Kapitals." },
  ]},
  { title: 'Stabilitätskennzahlen', icon: '🛡️', content: [
    { type: 'text', value: 'Stabilitätskennzahlen messen die finanzielle Unabhängigkeit und Widerstandsfähigkeit. Zentral für Bankgespräche und das URG (Unternehmensreorganisationsgesetz).' },
    { type: 'kz_group', cat: 'Stabilität' },
    { type: 'callout', emoji: '⚠️', value: 'URG-Grenzwerte: EK-Quote unter 8% ODER Fiktive Schuldentilgungsdauer über 15 Jahre → Reorganisationsbedarf!' },
  ]},
  { title: 'Liquiditätskennzahlen', icon: '💧', content: [
    { type: 'text', value: 'Liquiditätskennzahlen messen die Fähigkeit, kurzfristige Schulden zu bezahlen. Die 3 Grade bauen aufeinander auf.' },
    { type: 'pyramid' },
    { type: 'callout', emoji: '🚨', value: 'Alle drei Grade unter 100% → Insolvenzgefahr! NWC negativ → sofortiger Handlungsbedarf.' },
  ]},
  { title: 'Effizienz & weitere Kennzahlen', icon: '🔄', content: [
    { type: 'text', value: 'Effizienzkennzahlen zeigen, wie gut das Unternehmen seine Ressourcen nutzt.' },
    { type: 'kz_group', cat: 'Effizienz' },
    { type: 'callout', emoji: '🏪', value: 'Umschlagshäufigkeit: Supermarkt ~52× pro Jahr, Möbelhaus ~3×. Je höher, desto weniger Kapital liegt im Lager.' },
  ]},
  { title: 'Bereit zum Üben!', icon: '🚀', content: [
    { type: 'text', value: 'Du kennst jetzt alle Kennzahlen. Im Übungsteil:' },
    { type: 'ex_overview' },
  ]},
];

// ─── Color-Palette ─────────────────────────────────────────────────────

const palette: Record<CatColor, { text: string; bgSoft: string; border: string; bg: string }> = {
  amber:   { text: 'text-amber-400',   bgSoft: 'bg-amber-500/15',   border: 'border-amber-500/40',   bg: 'bg-amber-500' },
  blue:    { text: 'text-blue-400',    bgSoft: 'bg-blue-500/15',    border: 'border-blue-500/40',    bg: 'bg-blue-500' },
  cyan:    { text: 'text-cyan-400',    bgSoft: 'bg-cyan-500/15',    border: 'border-cyan-500/40',    bg: 'bg-cyan-500' },
  emerald: { text: 'text-emerald-400', bgSoft: 'bg-emerald-500/15', border: 'border-emerald-500/40', bg: 'bg-emerald-500' },
};

// ─── Mini-Helfer ───────────────────────────────────────────────────────

function Badge({ cat }: { cat: Category }) {
  const p = palette[CAT_COLOR[cat]];
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${p.bgSoft} ${p.text}`}>
      {cat}
    </span>
  );
}

function FormulaDisplay({ kz, size = 'normal' }: { kz: Kennzahl; size?: 'normal' | 'large' }) {
  const op = kz.tmpl === 'sub' ? '−' : '÷';
  const p = palette[CAT_COLOR[kz.cat]];
  const fs = size === 'large' ? 'text-base' : 'text-xs';
  return (
    <div className={`font-mono ${fs} inline-flex items-center gap-1.5 flex-wrap`}>
      <span className={`${p.bgSoft} px-2 py-0.5 rounded ${p.text} font-bold`}>{kz.A}</span>
      <span className="text-[#9ca3af] font-bold">{op}</span>
      <span className={`${p.bgSoft} px-2 py-0.5 rounded ${p.text} font-bold`}>{kz.B}</span>
      {kz.x100 && <span className="text-[#9ca3af]">× 100</span>}
    </div>
  );
}

// ─── Theorie-Block-Renderer ────────────────────────────────────────────

function Block({ block }: { block: TheoryBlock }) {
  if (block.type === 'text') {
    return <p className="text-sm leading-relaxed text-[#d1d5db] my-3">{block.value}</p>;
  }
  if (block.type === 'callout') {
    return (
      <div className="px-4 py-3 rounded-xl bg-indigo-500/10 border border-indigo-500/30 my-3.5 flex gap-2.5 items-start">
        <span className="text-lg shrink-0">{block.emoji}</span>
        <span className="text-sm leading-relaxed text-[#d1d5db]">{block.value}</span>
      </div>
    );
  }
  if (block.type === 'cats') {
    const items: { cat: Category; icon: string; desc: string; ex: string }[] = [
      { cat: 'Rentabilität', icon: '📈', desc: 'Wie profitabel ist das Kapital?', ex: 'GKR, EKR, Umsatzrentabilität' },
      { cat: 'Stabilität',   icon: '🛡️', desc: 'Wie unabhängig und stabil?',     ex: 'EK-Quote, Verschuldungsgrad, FSD' },
      { cat: 'Liquidität',   icon: '💧', desc: 'Kann man Schulden bezahlen?',    ex: '3 Grade, NWC' },
      { cat: 'Effizienz',    icon: '🔄', desc: 'Wie gut werden Ressourcen genutzt?', ex: 'Umschlag, Anlageintensität' },
    ];
    return (
      <div className="my-3.5 grid grid-cols-1 sm:grid-cols-2 gap-2">
        {items.map(it => {
          const p = palette[CAT_COLOR[it.cat]];
          return (
            <div
              key={it.cat}
              className={`bg-[#1e2130] border border-[#2d3148] rounded-xl p-3.5 ${p.text}`}
              style={{ borderLeft: '4px solid currentColor' }}
            >
              <div className="text-xl mb-1">{it.icon}</div>
              <div className={`font-extrabold text-sm ${p.text}`}>{it.cat}</div>
              <div className="text-xs text-[#d1d5db] my-1">{it.desc}</div>
              <div className="text-[11px] text-[#9ca3af] italic">{it.ex}</div>
            </div>
          );
        })}
      </div>
    );
  }
  if (block.type === 'kz_group') {
    const items = KZ.filter(k => k.cat === block.cat);
    return (
      <div className="my-3.5">
        {items.map((k, j) => (
          <Card key={j} className="mb-2">
            <div className="flex justify-between items-start mb-2 flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xl">{k.icon}</span>
                <div>
                  <div className="font-extrabold text-sm text-white">{k.full}</div>
                  <div className="text-[11px] text-[#9ca3af]">{k.name}</div>
                </div>
              </div>
              <span className="text-[10px] bg-amber-500/15 text-amber-400 px-2 py-0.5 rounded font-bold">
                Richtwert: {k.richtwert}
              </span>
            </div>
            <FormulaDisplay kz={k} />
            <div className="text-xs text-[#9ca3af] mt-2">{k.interp}</div>
            {k.why && (
              <div className="text-[11px] text-indigo-300 mt-1.5 bg-indigo-500/10 px-2 py-1 rounded">
                💡 {k.why}
              </div>
            )}
          </Card>
        ))}
      </div>
    );
  }
  if (block.type === 'pyramid') {
    const layers = [
      { label: 'Liq. 3. Grad', sub: 'UV ÷ kurzfr. VB × 100', richtwert: '200%', note: 'Breite Basis: alles Umlaufvermögen', color: 'cyan' as CatColor, w: '100%' },
      { label: 'Liq. 2. Grad', sub: '(FM + Ford.) ÷ kurzfr. VB × 100', richtwert: '100%', note: 'Ohne Vorräte', color: 'cyan' as CatColor, w: '75%' },
      { label: 'Liq. 1. Grad', sub: 'Flüssige Mittel ÷ kurzfr. VB × 100', richtwert: '20%', note: 'Nur Kasse/Bank', color: 'blue' as CatColor, w: '50%' },
    ];
    return (
      <div className="my-3.5">
        {layers.map((l, j) => {
          const p = palette[l.color];
          return (
            <div
              key={j}
              className={`${p.bg} mx-auto mb-2 rounded-xl px-4 py-2.5 text-white`}
              style={{ width: l.w }}
            >
              <div className="font-extrabold text-xs">
                {l.label}{' '}
                <span className="font-normal text-[11px] opacity-80">– Richtwert {l.richtwert}</span>
              </div>
              <div className="font-mono text-[11px] my-0.5 opacity-90">{l.sub}</div>
              <div className="text-[10px] opacity-75">{l.note}</div>
            </div>
          );
        })}
        <div className="text-center text-[11px] text-[#9ca3af] mt-1">
          + Net Working Capital: UV − kurzfr. VB (Richtwert: &gt; 0)
        </div>
      </div>
    );
  }
  if (block.type === 'ex_overview') {
    const exs = [
      { n: '1', icon: '🧱', label: 'Formel-Baukasten', desc: 'Baue jede Formel aus Bausteinen zusammen' },
      { n: '2', icon: '💬', label: 'Was sagt das aus?', desc: 'Interpretiere die Kennzahl richtig' },
      { n: '3', icon: '🔢', label: 'Berechnen', desc: 'Rechne mit echten Zahlen' },
      { n: '4', icon: '🚨', label: 'Krisendiagnose', desc: 'Erkenne ob ein Unternehmen in der Krise ist' },
    ];
    return (
      <div className="my-3.5">
        {exs.map(e => (
          <Card key={e.n} className="flex gap-3 items-center mb-2 py-3">
            <span className="text-2xl">{e.icon}</span>
            <div>
              <div className="font-bold text-sm text-white">{e.label}</div>
              <div className="text-xs text-[#9ca3af]">{e.desc}</div>
            </div>
          </Card>
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
  page: typeof THEORY[number];
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
            🧱 Jetzt üben!
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

// ─── EX 1: Formel-Baukasten ────────────────────────────────────────────

function FormulaBuilder({
  onDone, onNext, onRestart, prevScore,
}: {
  onDone: (s: number) => void;
  onNext: () => void;
  onRestart: () => void;
  prevScore?: number;
}) {
  const [idx, setIdx] = useState(0);
  const [slotA, setSlotA] = useState<string | null>(null);
  const [slotB, setSlotB] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [correct, setCorrect] = useState<boolean | null>(null);
  const [progress, setProgress] = useState<(boolean | undefined)[]>([]);
  const [finished, setFinished] = useState(false);
  const [finalScore, setFinalScore] = useState<number | null>(prevScore ?? null);
  const [maxIdx, setMaxIdx] = useState(0);
  const [saved, setSaved] = useState<Record<number, { slotA: string | null; slotB: string | null; checked: boolean; correct: boolean | null }>>({});

  const kz = KZ[idx];
  const op = kz.tmpl === 'sub' ? '−' : '÷';
  const col = palette[CAT_COLOR[kz.cat]];
  // Tile-Reihenfolge stabil pro Kennzahl (einmal gemischt)
  const [tileOrder] = useState(() =>
    KZ.map(k => Array.from(new Set([k.A, k.B, ...k.tiles])).sort(() => Math.random() - 0.5))
  );
  const allTiles = tileOrder[idx];
  const usedTiles = [slotA, slotB].filter(Boolean) as string[];
  const poolTiles = allTiles.filter(t => !usedTiles.includes(t));

  const navTo = (newIdx: number) => {
    setSaved(p => ({ ...p, [idx]: { slotA, slotB, checked, correct } }));
    const s = saved[newIdx];
    setSlotA(s?.slotA ?? null);
    setSlotB(s?.slotB ?? null);
    setChecked(s?.checked ?? false);
    setCorrect(s?.correct ?? null);
    setIdx(newIdx);
  };

  const clickTile = (t: string) => {
    if (checked) return;
    if (!slotA) setSlotA(t);
    else if (!slotB) setSlotB(t);
  };

  const check = () => {
    const ok = slotA === kz.A && slotB === kz.B;
    setCorrect(ok);
    setChecked(true);
    setProgress(p => { const n = [...p]; n[idx] = ok; return n; });
  };

  const next = () => {
    if (idx < KZ.length - 1) {
      setSaved(p => ({ ...p, [idx]: { slotA, slotB, checked, correct } }));
      const newIdx = idx + 1;
      const s = saved[newIdx];
      setSlotA(s?.slotA ?? null);
      setSlotB(s?.slotB ?? null);
      setChecked(s?.checked ?? false);
      setCorrect(s?.correct ?? null);
      setIdx(newIdx);
      setMaxIdx(m => Math.max(m, newIdx));
    } else {
      const s = progress.filter(Boolean).length;
      setFinalScore(s);
      setFinished(true);
      onDone(s);
    }
  };

  if (finished) {
    return (
      <div className="text-center py-6">
        <div className="text-4xl mb-2">🧱</div>
        <div className="font-extrabold text-xl text-white">Formel-Baukasten fertig!</div>
        <div className="text-sm text-[#9ca3af] mt-1">{finalScore}/{KZ.length} Formeln richtig</div>
        <div className="flex gap-2 justify-center mt-4 flex-wrap">
          <button type="button" onClick={onRestart} className="px-5 py-2.5 rounded-xl border border-[#2d3148] bg-[#1e2130] hover:bg-[#252840] text-[#9ca3af] hover:text-white text-sm font-bold transition-colors">
            🔄 Nochmal üben
          </button>
          <button type="button" onClick={onNext} className="px-5 py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white text-sm font-bold transition-colors">
            Weiter zu Übung 2 →
          </button>
        </div>
      </div>
    );
  }

  const SlotChip = ({ value, onClear, placeholder }: { value: string | null; onClear: () => void; placeholder: string }) => (
    <button
      type="button"
      onClick={onClear}
      disabled={!value || checked}
      className={`min-w-[8rem] text-center px-3 py-1.5 rounded-lg border-2 font-mono text-sm transition-all ${
        value
          ? `${col.bgSoft} ${col.border} ${col.text} font-bold`
          : 'border-dashed border-[#3d4168] text-[#6b7280] bg-transparent'
      }`}
    >
      {value || placeholder}
      {value && !checked && <span className="ml-1.5 opacity-50 text-[11px]">✕</span>}
    </button>
  );

  return (
    <div>
      {/* Counter + Prev/Next */}
      <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => navTo(idx - 1)} disabled={idx === 0}
            className="px-2.5 py-1 rounded border border-[#2d3148] disabled:opacity-30 text-[#9ca3af] hover:text-white text-sm font-bold disabled:cursor-not-allowed">
            ←
          </button>
          <span className="text-xs font-bold text-[#9ca3af] uppercase tracking-wider">{idx + 1} / {KZ.length}</span>
          <button type="button" onClick={() => navTo(idx + 1)} disabled={idx >= maxIdx}
            className="px-2.5 py-1 rounded border border-[#2d3148] disabled:opacity-30 text-[#9ca3af] hover:text-white text-sm font-bold disabled:cursor-not-allowed">
            →
          </button>
        </div>
        <Badge cat={kz.cat} />
      </div>

      <div className="mb-4">
        <div className="text-lg font-extrabold text-white">{kz.icon} {kz.full}</div>
        <div className="text-xs text-[#9ca3af]">{kz.name}</div>
      </div>

      {/* Formula slots */}
      <div className="bg-[#0c0e14] border border-[#2d3148] rounded-xl p-5 mb-4">
        <div className="text-[10px] font-bold text-[#6b7280] uppercase tracking-widest mb-3">
          Formel zusammenbauen:
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <SlotChip value={slotA} onClear={() => setSlotA(null)} placeholder="Zähler wählen…" />
          <span className="text-[#d1d5db] font-bold text-lg">{op}</span>
          <SlotChip value={slotB} onClear={() => setSlotB(null)} placeholder="Nenner wählen…" />
          {kz.x100 && <span className="text-[#9ca3af] font-semibold">× 100</span>}
        </div>
      </div>

      {/* Tile pool */}
      {!checked && (
        <div>
          <div className="text-[10px] font-bold text-[#6b7280] uppercase tracking-widest mb-2">
            Bausteine:
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {poolTiles.map((t, i) => (
              <button
                key={i}
                type="button"
                onClick={() => clickTile(t)}
                className={`px-3 py-1.5 rounded-lg border-[1.5px] border-[#2d3148] hover:${col.border} bg-[#1e2130] hover:${col.bgSoft} text-[#d1d5db] font-mono text-xs transition-colors`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Feedback */}
      {checked && (
        <div className={`rounded-xl p-3.5 my-3 border ${correct ? 'bg-emerald-500/10 border-emerald-500/40' : 'bg-red-500/10 border-red-500/40'}`}>
          <div className="font-extrabold text-sm mb-1.5 text-white">
            {correct ? '✅ Richtig!' : `❌ Falsch. Richtige Formel: ${kz.A} ${op} ${kz.B}${kz.x100 ? ' × 100' : ''}`}
          </div>
          <div className="text-xs text-[#d1d5db] mb-1">📊 {kz.interp}</div>
          <div className="text-[11px] text-[#9ca3af]">Richtwert: <strong className="text-white">{kz.richtwert}</strong></div>
          {kz.why && <div className="text-[11px] text-indigo-300 mt-1">💡 {kz.why}</div>}
        </div>
      )}

      {/* Clickable progress */}
      <div className="flex gap-1 my-3">
        {KZ.map((_, i) => {
          const visited = i <= maxIdx;
          const c =
            i === idx ? col.bg :
            progress[i] === true ? 'bg-emerald-500' :
            progress[i] === false ? 'bg-red-500' :
            'bg-[#2d3148]';
          return (
            <button
              key={i}
              type="button"
              onClick={() => visited && navTo(i)}
              disabled={!visited}
              className={`flex-1 h-1 rounded-full ${c} ${visited ? 'cursor-pointer' : 'cursor-not-allowed opacity-40'}`}
              aria-label={`Kennzahl ${i + 1}`}
            />
          );
        })}
      </div>

      {!checked ? (
        <button
          type="button"
          onClick={check}
          disabled={!slotA || !slotB}
          className={`px-6 py-3 rounded-xl font-bold text-sm transition-colors mt-1 ${
            slotA && slotB ? `${col.bg} hover:opacity-90 text-white` : 'bg-[#252840] text-[#6b7280] cursor-not-allowed'
          }`}
        >
          Prüfen
        </button>
      ) : (
        <button
          type="button"
          onClick={next}
          className="px-6 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-bold text-sm transition-colors mt-1"
        >
          {idx < KZ.length - 1 ? 'Nächste Kennzahl →' : 'Abschließen 🎉'}
        </button>
      )}
    </div>
  );
}

// ─── EX 2: Interpretation-Quiz ─────────────────────────────────────────

function InterpretationQuiz({
  onDone, onNext, onRestart, prevScore,
}: {
  onDone: (s: number) => void;
  onNext: () => void;
  onRestart: () => void;
  prevScore?: number;
}) {
  const [shuffledQ] = useState(() => [...KZ].sort(() => Math.random() - 0.5).slice(0, 8));
  const [answerSets] = useState(() =>
    shuffledQ.map(kz => [kz.interp, ...kz.wrong].sort(() => Math.random() - 0.5))
  );
  const [idx, setIdx] = useState(0);
  const [sel, setSel] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [score, setScore] = useState(0);
  const [finished, setFinished] = useState(false);
  const [finalScore, setFinalScore] = useState<number | null>(prevScore ?? null);

  const kz = shuffledQ[idx];
  const answers = answerSets[idx];

  const check = (a: string) => {
    if (checked) return;
    setSel(a);
    setChecked(true);
    if (a === kz.interp) setScore(s => s + 1);
  };

  const next = () => {
    if (idx < shuffledQ.length - 1) {
      setIdx(i => i + 1);
      setSel(null);
      setChecked(false);
    } else {
      const s = score + (sel === kz.interp ? 1 : 0);
      setFinalScore(s);
      setFinished(true);
      onDone(s);
    }
  };

  if (finished) {
    return (
      <div className="text-center py-6">
        <div className="text-4xl mb-2">💬</div>
        <div className="font-extrabold text-xl text-white">Interpretation fertig!</div>
        <div className="text-sm text-[#9ca3af] mt-1">{finalScore}/8 richtig</div>
        <div className="flex gap-2 justify-center mt-4 flex-wrap">
          <button type="button" onClick={onRestart} className="px-5 py-2.5 rounded-xl border border-[#2d3148] bg-[#1e2130] hover:bg-[#252840] text-[#9ca3af] hover:text-white text-sm font-bold transition-colors">
            🔄 Nochmal üben
          </button>
          <button type="button" onClick={onNext} className="px-5 py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white text-sm font-bold transition-colors">
            Weiter zu Übung 3 →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <div className="text-xs font-bold text-[#9ca3af] uppercase tracking-wider">
          {idx + 1} / {shuffledQ.length}
        </div>
        <Badge cat={kz.cat} />
      </div>
      <div className="text-base font-extrabold text-white mb-2">Was sagt diese Formel aus?</div>
      <div className="bg-[#0c0e14] border border-[#2d3148] rounded-xl p-4 mb-4 text-center">
        <FormulaDisplay kz={kz} size="large" />
        <div className="text-xs text-[#9ca3af] mt-2 font-mono">{kz.full}</div>
      </div>
      <div className="flex flex-col gap-2">
        {answers.map((a, i) => {
          const isCorrect = a === kz.interp;
          const isSel = sel === a;
          let cls = 'bg-[#1e2130] border-[#2d3148] text-[#d1d5db] hover:bg-[#252840]';
          if (checked && isCorrect) cls = 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300 font-bold';
          if (checked && isSel && !isCorrect) cls = 'bg-red-500/10 border-red-500/40 text-red-300';
          return (
            <button
              key={i}
              type="button"
              onClick={() => check(a)}
              disabled={checked}
              className={`px-4 py-3 rounded-xl border-2 text-sm text-left transition-colors ${cls} ${checked ? 'cursor-default' : 'cursor-pointer'}`}
            >
              {checked && isCorrect && '✅ '}{checked && isSel && !isCorrect && '❌ '}{a}
            </button>
          );
        })}
      </div>
      {checked && (
        <button
          type="button"
          onClick={next}
          className="mt-3 px-6 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-bold text-sm transition-colors"
        >
          {idx < shuffledQ.length - 1 ? 'Weiter →' : 'Abschließen 🎉'}
        </button>
      )}
    </div>
  );
}

// ─── EX 3: Berechnen ───────────────────────────────────────────────────

function CalculateEx({
  onDone, onNext, onRestart, prevScore,
}: {
  onDone: (s: number) => void;
  onNext: () => void;
  onRestart: () => void;
  prevScore?: number;
}) {
  const kzWithCalc = KZ.filter(k => k.calc) as (Kennzahl & { calc: NonNullable<Kennzahl['calc']> })[];
  const [idx, setIdx] = useState(0);
  const [input, setInput] = useState('');
  const [checked, setChecked] = useState(false);
  const [correct, setCorrect] = useState<boolean | null>(null);
  const [score, setScore] = useState(0);
  const [finished, setFinished] = useState(false);
  const [finalScore, setFinalScore] = useState<number | null>(prevScore ?? null);

  const kz = kzWithCalc[idx];
  const op = kz.tmpl === 'sub' ? '−' : '÷';
  const col = palette[CAT_COLOR[kz.cat]];
  const isNoX100 = !!kz.calc.noX100;
  const expected = kz.calc.result;
  const tolerance = expected < 10 ? 0.1 : 1;

  const check = () => {
    const val = parseFloat(input.replace(',', '.'));
    const ok = !isNaN(val) && Math.abs(val - expected) <= tolerance;
    setCorrect(ok);
    setChecked(true);
    if (ok) setScore(s => s + 1);
  };

  const next = () => {
    if (idx < kzWithCalc.length - 1) {
      setIdx(i => i + 1);
      setInput('');
      setChecked(false);
      setCorrect(null);
    } else {
      const s = score + (correct ? 1 : 0);
      setFinalScore(s);
      setFinished(true);
      onDone(s);
    }
  };

  if (finished) {
    return (
      <div className="text-center py-6">
        <div className="text-4xl mb-2">🔢</div>
        <div className="font-extrabold text-xl text-white">Berechnen fertig!</div>
        <div className="text-sm text-[#9ca3af] mt-1">{finalScore}/{kzWithCalc.length} richtig</div>
        <div className="flex gap-2 justify-center mt-4 flex-wrap">
          <button type="button" onClick={onRestart} className="px-5 py-2.5 rounded-xl border border-[#2d3148] bg-[#1e2130] hover:bg-[#252840] text-[#9ca3af] hover:text-white text-sm font-bold transition-colors">
            🔄 Nochmal üben
          </button>
          <button type="button" onClick={onNext} className="px-5 py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white text-sm font-bold transition-colors">
            Weiter zu Übung 4 →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <div className="text-xs font-bold text-[#9ca3af] uppercase tracking-wider">
          {idx + 1} / {kzWithCalc.length}
        </div>
        <Badge cat={kz.cat} />
      </div>
      <div className="text-base font-extrabold text-white mb-3">🔢 {kz.full} berechnen</div>
      <div className="bg-[#1e2130] border border-[#2d3148] rounded-xl px-4 py-3 mb-3.5 text-sm leading-relaxed">
        <strong className="text-white">Gegeben:</strong><br />
        <span className="text-[#d1d5db]">{kz.calc.label}</span>
      </div>
      <div className="bg-[#0c0e14] border border-[#2d3148] rounded-xl px-4 py-3 mb-3.5 font-mono text-sm text-[#d1d5db]">
        {kz.full} = <span className={col.text}>{kz.A}</span> {op} <span className={col.text}>{kz.B}</span>
        {!isNoX100 && kz.x100 ? ' × 100' : ''} = ?
      </div>
      <div className="flex gap-2.5 items-center mb-3">
        <input
          type="number"
          inputMode="decimal"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !checked && check()}
          placeholder="Ergebnis eingeben…"
          disabled={checked}
          className={`flex-1 px-3.5 py-2.5 rounded-lg border-2 font-mono text-base bg-[#1e2130] text-white placeholder:text-[#6b7280] focus:outline-none ${
            checked
              ? correct
                ? 'border-emerald-500/40 bg-emerald-500/10'
                : 'border-red-500/40 bg-red-500/10'
              : 'border-[#2d3148] focus:border-indigo-500'
          }`}
        />
        {!isNoX100 && kz.x100 && <span className="font-mono text-[#9ca3af]">%</span>}
      </div>
      {checked && (
        <div className={`rounded-xl p-3 mb-3 border text-sm ${correct ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300' : 'bg-red-500/10 border-red-500/40 text-red-300'}`}>
          {correct ? `✅ Richtig! ${expected}${kz.x100 && !isNoX100 ? '%' : ''}` : `❌ Richtige Antwort: ${expected}${kz.x100 && !isNoX100 ? '%' : ''}`}
          <div className="text-[11px] text-[#9ca3af] mt-1">Richtwert: {kz.richtwert}</div>
        </div>
      )}
      {!checked ? (
        <button
          type="button"
          onClick={check}
          disabled={!input}
          className={`px-6 py-3 rounded-xl font-bold text-sm transition-colors ${
            input ? `${col.bg} hover:opacity-90 text-white` : 'bg-[#252840] text-[#6b7280] cursor-not-allowed'
          }`}
        >
          Prüfen
        </button>
      ) : (
        <button
          type="button"
          onClick={next}
          className="px-6 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-bold text-sm transition-colors"
        >
          {idx < kzWithCalc.length - 1 ? 'Weiter →' : 'Abschließen 🎉'}
        </button>
      )}
    </div>
  );
}

// ─── EX 4: Krisendiagnose ──────────────────────────────────────────────

function CrisisEx({
  onDone, onRestart, prevScore,
}: {
  onDone: (s: number) => void;
  onRestart: () => void;
  prevScore?: number;
}) {
  const [idx, setIdx] = useState(0);
  const [sel, setSel] = useState<CrisisCase['verdict'] | null>(null);
  const [checked, setChecked] = useState(false);
  const [score, setScore] = useState(0);
  const [finished, setFinished] = useState(false);
  const [finalScore, setFinalScore] = useState<number | null>(prevScore ?? null);
  const c = CRISIS_CASES[idx];

  const verdicts: { id: CrisisCase['verdict']; label: string; color: 'emerald' | 'amber' | 'red' }[] = [
    { id: 'gesund',  label: '✅ Finanziell gesund', color: 'emerald' },
    { id: 'warnung', label: '⚠️ Warnsignale',      color: 'amber'   },
    { id: 'krise',   label: '🚨 Akute Krise',      color: 'red'     },
  ];

  const check = (v: CrisisCase['verdict']) => {
    if (checked) return;
    setSel(v);
    setChecked(true);
    if (v === c.verdict) setScore(s => s + 1);
  };

  const next = () => {
    if (idx < CRISIS_CASES.length - 1) {
      setIdx(i => i + 1);
      setSel(null);
      setChecked(false);
    } else {
      const s = score + (sel === c.verdict ? 1 : 0);
      setFinalScore(s);
      setFinished(true);
      onDone(s);
    }
  };

  if (finished) {
    return (
      <div className="text-center py-6">
        <div className="text-4xl mb-2">🚨</div>
        <div className="font-extrabold text-xl text-white">Krisendiagnose fertig!</div>
        <div className="text-sm text-[#9ca3af] mt-1">{finalScore}/3 richtig</div>
        <div className="flex gap-2 justify-center mt-4 flex-wrap">
          <button type="button" onClick={onRestart} className="px-5 py-2.5 rounded-xl border border-[#2d3148] bg-[#1e2130] hover:bg-[#252840] text-[#9ca3af] hover:text-white text-sm font-bold transition-colors">
            🔄 Nochmal üben
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="text-xs font-bold text-[#9ca3af] uppercase tracking-wider mb-3">
        {idx + 1} / {CRISIS_CASES.length}
      </div>
      <div className="text-base font-extrabold text-white mb-3">
        🏢 {c.company}: Gesund, Warnung oder Krise?
      </div>
      <div className="rounded-xl overflow-hidden border border-[#2d3148] mb-4">
        <div className="bg-[#252840] text-white px-3.5 py-2 font-bold text-xs">
          Kennzahlenübersicht
        </div>
        {c.values.map((v, i) => (
          <div
            key={i}
            className={`px-3.5 py-2.5 flex justify-between items-center flex-wrap gap-2 ${
              i % 2 === 0 ? 'bg-[#1e2130]' : 'bg-[#1a1d27]'
            } ${i < c.values.length - 1 ? 'border-b border-[#2d3148]' : ''}`}
          >
            <span className="text-sm font-semibold text-[#d1d5db]">{v.label}</span>
            <div className="flex gap-2 items-center">
              <span className={`font-mono font-bold text-sm ${v.bad ? 'text-red-400' : 'text-emerald-400'}`}>
                {v.value}
              </span>
              {checked && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${v.bad ? 'bg-red-500/15 text-red-300' : 'bg-emerald-500/15 text-emerald-300'}`}>
                  {v.note}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="text-sm font-bold mb-2 text-white">Deine Einschätzung:</div>
      <div className="flex flex-col gap-2 mb-3.5">
        {verdicts.map(v => {
          const isSel = sel === v.id;
          const isCorrect = v.id === c.verdict;
          let cls = 'bg-[#1e2130] border-[#2d3148] text-[#d1d5db] hover:bg-[#252840]';
          if (checked && isCorrect) cls = 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300';
          if (checked && isSel && !isCorrect) cls = 'bg-red-500/10 border-red-500/40 text-red-300';
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => check(v.id)}
              disabled={checked}
              className={`px-4 py-3 rounded-xl border-2 text-sm font-bold text-left transition-colors ${cls} ${checked ? 'cursor-default' : 'cursor-pointer'}`}
            >
              {v.label}
            </button>
          );
        })}
      </div>
      {checked && (
        <div className={`rounded-xl p-3.5 mb-3 border ${sel === c.verdict ? 'bg-emerald-500/10 border-emerald-500/40' : 'bg-red-500/10 border-red-500/40'}`}>
          <div className="font-extrabold text-sm mb-1 text-white">{c.label}</div>
          <div className="text-xs text-[#d1d5db]">{c.why}</div>
        </div>
      )}
      {checked && (
        <button
          type="button"
          onClick={next}
          className="px-6 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-bold text-sm transition-colors"
        >
          {idx < CRISIS_CASES.length - 1 ? 'Nächster Fall →' : 'Abschließen 🎉'}
        </button>
      )}
    </div>
  );
}

// ─── Praxis-Ansicht (Tab-Nav über 4 Übungen) ───────────────────────────

function PracticeView({ onBack }: { onBack: () => void }) {
  const [ex, setEx] = useState(0);
  const [scores, setScores] = useState<Record<string, number>>({});
  // key-Bump zwingt React zum Remount → Restart der Übung
  const [keys, setKeys] = useState<Record<string, number>>({ build: 0, interp: 0, calc: 0, crisis: 0 });

  const done = (id: string, s: number) => setScores(p => ({ ...p, [id]: s }));
  const restart = (id: string) => setKeys(p => ({ ...p, [id]: (p[id] || 0) + 1 }));

  const EXES = [
    { id: 'build',  n: 1, icon: '🧱', label: 'Formel-Baukasten', max: KZ.length },
    { id: 'interp', n: 2, icon: '💬', label: 'Interpretation',   max: 8 },
    { id: 'calc',   n: 3, icon: '🔢', label: 'Berechnen',        max: KZ.filter(k => k.calc).length },
    { id: 'crisis', n: 4, icon: '🚨', label: 'Krisendiagnose',   max: 3 },
  ];

  const allDone = EXES.every(e => scores[e.id] !== undefined);

  return (
    <div>
      {/* Tab nav */}
      <div className="flex gap-1 mb-5 flex-wrap">
        {EXES.map((e, i) => {
          const active = ex === i;
          const completed = scores[e.id] !== undefined;
          const s = scores[e.id];
          const cls = active
            ? 'bg-indigo-500 text-white border-indigo-500'
            : completed
              ? 'bg-indigo-500/15 text-indigo-300 border-transparent'
              : 'bg-[#252840] text-[#6b7280] border-transparent';
          return (
            <button
              key={e.id}
              type="button"
              onClick={() => setEx(i)}
              className={`flex-1 min-w-[4rem] py-2 px-1 rounded-lg border-2 text-[11px] font-bold leading-tight transition-colors ${cls}`}
            >
              <div className="text-base">{e.icon}</div>
              {e.n}. {e.label}
              {completed && <div className="text-[10px] mt-0.5 opacity-80">{s}/{e.max}</div>}
            </button>
          );
        })}
      </div>

      {ex === 0 && (
        <FormulaBuilder
          key={keys.build}
          onDone={s => done('build', s)}
          onNext={() => setEx(1)}
          onRestart={() => restart('build')}
          prevScore={scores.build}
        />
      )}
      {ex === 1 && (
        <InterpretationQuiz
          key={keys.interp}
          onDone={s => done('interp', s)}
          onNext={() => setEx(2)}
          onRestart={() => restart('interp')}
          prevScore={scores.interp}
        />
      )}
      {ex === 2 && (
        <CalculateEx
          key={keys.calc}
          onDone={s => done('calc', s)}
          onNext={() => setEx(3)}
          onRestart={() => restart('calc')}
          prevScore={scores.calc}
        />
      )}
      {ex === 3 && (
        <CrisisEx
          key={keys.crisis}
          onDone={s => done('crisis', s)}
          onRestart={() => restart('crisis')}
          prevScore={scores.crisis}
        />
      )}

      {allDone && (
        <div className="bg-emerald-500/10 border border-emerald-500/40 rounded-xl p-4 mt-4 text-center">
          <div className="text-3xl mb-1">🏆</div>
          <div className="font-extrabold text-base text-white">Alle Übungen abgeschlossen!</div>
          <div className="flex gap-1.5 justify-center flex-wrap mt-3">
            {EXES.map(e => (
              <div key={e.id} className="bg-[#1e2130] rounded-lg px-3 py-1.5 text-xs font-bold text-[#d1d5db]">
                {e.icon} {scores[e.id]}/{e.max}
              </div>
            ))}
          </div>
        </div>
      )}

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

export default function KennzahlenKurs({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<'theory' | 'practice'>('theory');
  const [tp, setTp] = useState(0);

  return (
    <ExerciseShell
      title="Unternehmenskennzahlen"
      subtitle="Finanzmanagement"
      onClose={onClose}
    >
      <div className="max-w-2xl mx-auto">
        {/* Top bar */}
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-[#2d3148]">
          <div>
            <div className="text-[10px] font-extrabold text-indigo-400 uppercase tracking-[0.2em]">
              Unternehmenskennzahlen
            </div>
            <div className="text-[11px] text-[#6b7280] mt-0.5">
              {mode === 'theory' ? `Lektion ${tp + 1}/${THEORY.length}` : 'Übungsmodus'}
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
            {THEORY.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setTp(i)}
                className={`flex-1 h-1.5 rounded-full transition-colors ${
                  i === tp ? 'bg-indigo-500' : i < tp ? 'bg-emerald-500/50' : 'bg-[#252840]'
                }`}
                aria-label={`Lektion ${i + 1}`}
              />
            ))}
          </div>
        )}

        {mode === 'theory' ? (
          <TheoryView
            page={THEORY[tp]}
            idx={tp}
            total={THEORY.length}
            onNext={() => setTp(p => Math.min(p + 1, THEORY.length - 1))}
            onPrev={() => setTp(p => Math.max(p - 1, 0))}
            onStart={() => setMode('practice')}
          />
        ) : (
          <PracticeView onBack={() => setMode('theory')} />
        )}

        <div className="text-center text-[10px] text-[#6b7280] mt-5 pb-4">
          FH Wien · Finanzmanagement · Unternehmenskennzahlen
        </div>
      </div>
    </ExerciseShell>
  );
}
