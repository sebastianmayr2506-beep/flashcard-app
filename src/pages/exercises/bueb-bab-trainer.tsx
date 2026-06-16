// BÜB & BAB Kurs (vormals BÜB-Trainer v3, jetzt mit Theorie-Sektion)
// Tischlerei Berger KG, März — 8 Theorie-Lektionen + 9 Praxis-Phasen.
//
// Die Praxis-Logik ist identisch zur früheren v3 des reinen Trainers
// (Klassifizierung → BÜB → BAB → Kostenträger). Neu drum herum:
//   • Mode-Toggle Theorie/Üben
//   • 8 Theorie-Lektionen mit visuellen Blöcken (flow, cards, steps,
//     formula, comparison, twoCol, ksCards, summary)
//   • Klickbare Progress-Dots in Theorie
//
// Konventionen siehe EXERCISE_GUIDE.md.

import { useState } from 'react';
import {
  ExerciseShell, StepNav, type StepNavItem, StepHeader, InfoBox, FeedbackBox, HintBox,
  NumIn, ToggleBtn, PrimaryBtn, Card, fmtEur, numFromInput,
} from './_shared';

// ─── Daten ─────────────────────────────────────────────────────────────
interface FibuItem {
  id: number;
  name: string;
  amount: number;
  type: 'grundkosten' | 'neutral' | 'anderskosten';
  kalkValue?: number;
  reason?: 'betriebsfremd' | 'außerordentlich' | 'periodenfremd';
}

const FIBU: FibuItem[] = [
  { id: 1, name: 'Materialverbrauch', amount: 70000, type: 'grundkosten' },
  { id: 2, name: 'Fertigungslöhne', amount: 40000, type: 'grundkosten' },
  { id: 3, name: 'Gehälter Verwaltung', amount: 15000, type: 'grundkosten' },
  { id: 4, name: 'Gehälter Vertrieb', amount: 7000, type: 'grundkosten' },
  { id: 5, name: 'Hallenmiete', amount: 10000, type: 'grundkosten' },
  { id: 6, name: 'Energie / Strom', amount: 6000, type: 'grundkosten' },
  { id: 7, name: 'Buchm. Abschreibung', amount: 5000, type: 'anderskosten', kalkValue: 9000 },
  { id: 8, name: 'FK-Zinsen', amount: 2000, type: 'anderskosten', kalkValue: 5000 },
  { id: 9, name: 'Spende Rotes Kreuz', amount: 3000, type: 'neutral', reason: 'betriebsfremd' },
  { id: 10, name: 'Sturmschaden (einmalig)', amount: 4000, type: 'neutral', reason: 'außerordentlich' },
  { id: 11, name: 'Nachzahlung SV Vorjahr', amount: 2000, type: 'neutral', reason: 'periodenfremd' },
  { id: 12, name: 'Kursverlust Wertpapiere', amount: 1000, type: 'neutral', reason: 'betriebsfremd' },
];

const ZUSATZ = [
  { id: 'z1', name: 'Kalk. Unternehmerlohn', amount: 5000 },
  { id: 'z2', name: 'Kalk. Miete (eigene Halle)', amount: 3000 },
];

const KORE = 170000;
const TOTAL_FIBU = FIBU.reduce((s, f) => s + f.amount, 0);
const MEK_T = 55000, FEK_T = 40000;
const MEK_TI = 33000, MEK_RE = 22000;
const FEK_TI = 24000, FEK_RE = 16000;
const EK_T = MEK_T + FEK_T;
const GK_T = KORE - EK_T;

type KsKey = 'material' | 'fertigung' | 'verwaltung' | 'vertrieb';
const KSN: KsKey[] = ['material', 'fertigung', 'verwaltung', 'vertrieb'];
const KSL: Record<KsKey, string> = { material: 'Material', fertigung: 'Fertigung', verwaltung: 'Verwaltung', vertrieb: 'Vertrieb' };

type BasisKey = 'flaeche' | 'verbrauch' | 'anlagenwert' | 'kapitalbindung' | 'taetigkeit';
const BASES: { id: BasisKey; label: string; icon: string }[] = [
  { id: 'flaeche',       label: 'Fläche (m²)',      icon: '📐' },
  { id: 'verbrauch',     label: 'Verbrauch (kWh)',  icon: '⚡' },
  { id: 'anlagenwert',   label: 'Anlagenwert (€)',  icon: '🏭' },
  { id: 'kapitalbindung',label: 'Kapitalbindung (€)', icon: '💰' },
  { id: 'taetigkeit',    label: 'Tätigkeitsanteil', icon: '👤' },
];

interface GkItem {
  id: string;
  name: string;
  amount: number;
  isDirekt: boolean;
  target?: KsKey;
  basis?: BasisKey;
  dist: Record<KsKey, number>;
}

const GK_ITEMS: GkItem[] = [
  { id: 'g1', name: 'Hilfsstoffe (Material-GK)', amount: 15000, isDirekt: true, target: 'material', dist: { material: 15000, fertigung: 0, verwaltung: 0, vertrieb: 0 } },
  { id: 'g2', name: 'Gehälter Verwaltung', amount: 15000, isDirekt: true, target: 'verwaltung', dist: { material: 0, fertigung: 0, verwaltung: 15000, vertrieb: 0 } },
  { id: 'g3', name: 'Gehälter Vertrieb', amount: 7000, isDirekt: true, target: 'vertrieb', dist: { material: 0, fertigung: 0, verwaltung: 0, vertrieb: 7000 } },
  { id: 'g4', name: 'Hallenmiete', amount: 10000, isDirekt: false, basis: 'flaeche', dist: { material: 1000, fertigung: 6000, verwaltung: 2000, vertrieb: 1000 } },
  { id: 'g5', name: 'Energie / Strom', amount: 6000, isDirekt: false, basis: 'verbrauch', dist: { material: 600, fertigung: 3600, verwaltung: 600, vertrieb: 1200 } },
  { id: 'g6', name: 'Kalk. Abschreibung', amount: 9000, isDirekt: false, basis: 'anlagenwert', dist: { material: 900, fertigung: 5400, verwaltung: 1800, vertrieb: 900 } },
  { id: 'g7', name: 'Kalk. Zinsen', amount: 5000, isDirekt: false, basis: 'kapitalbindung', dist: { material: 500, fertigung: 3000, verwaltung: 500, vertrieb: 1000 } },
  { id: 'g8', name: 'Kalk. Unternehmerlohn', amount: 5000, isDirekt: false, basis: 'taetigkeit', dist: { material: 0, fertigung: 1000, verwaltung: 3000, vertrieb: 1000 } },
  { id: 'g9', name: 'Kalk. Miete (Lager)', amount: 3000, isDirekt: true, target: 'material', dist: { material: 3000, fertigung: 0, verwaltung: 0, vertrieb: 0 } },
];

const cKS: Record<KsKey, number> = { material: 0, fertigung: 0, verwaltung: 0, vertrieb: 0 };
GK_ITEMS.forEach(g => KSN.forEach(k => { cKS[k] += g.dist[k]; }));
const MGK = cKS.material, FGK = cKS.fertigung, VwGK = cKS.verwaltung, VtGK = cKS.vertrieb;
const HK_VAL = MEK_T + MGK + FEK_T + FGK;
const pct = (a: number, b: number) => Math.round((a / b) * 10000) / 100;
const MGK_P = pct(MGK, MEK_T), FGK_P = pct(FGK, FEK_T);
const VwGK_P = pct(VwGK, HK_VAL), VtGK_P = pct(VtGK, HK_VAL);

const closeEur = (a: number, b: number) => Math.abs(a - b) <= Math.max(Math.abs(b) * 0.005, 200);
const closePct = (a: number, b: number) => Math.abs(a - b) < 1.5;

const STEPS: StepNavItem[] = [
  { id: 'p1', n: 1, label: 'Klassifizierung',  group: 'büb' },
  { id: 'p2', n: 2, label: 'Neutral begründen', group: 'büb' },
  { id: 'p3', n: 3, label: 'Anderskosten',      group: 'büb' },
  { id: 'p4', n: 4, label: 'Zusatzkosten',      group: 'büb' },
  { id: 'p5', n: 5, label: 'BÜB-Ergebnis',      group: 'büb' },
  { id: 'p6', n: 6, label: 'EK / GK',           group: 'bab' },
  { id: 'p7', n: 7, label: 'GK verteilen',      group: 'bab' },
  { id: 'p8', n: 8, label: 'Zuschlagssätze',    group: 'bab' },
  { id: 'p9', n: 9, label: 'Kostenträger',      group: 'bab' },
];
type StepId = typeof STEPS[number]['id'];

// ─── Theorie-Daten ─────────────────────────────────────────────────────

type ColorKey = 'indigo' | 'blue' | 'emerald' | 'red' | 'amber' | 'purple';

type TheoryBlock =
  | { type: 'text'; value: string }
  | { type: 'callout'; emoji: string; value: string }
  | { type: 'flow'; steps: { label: string; desc: string; icon: string }[] }
  | { type: 'cards'; items: { label: string; desc: string; example: string; color: ColorKey; icon: string }[] }
  | { type: 'steps'; items: { n: string; title: string; desc: string; sign: '+' | '−' | '±'; color: ColorKey }[] }
  | { type: 'formula'; lines: string[] }
  | { type: 'comparison'; items: { label: string; buchm: string; kalk: string; icon: string }[] }
  | { type: 'twoCol'; left: TwoColCol; right: TwoColCol }
  | { type: 'ksCards'; items: { label: string; icon: string; desc: string; basis: string }[] }
  | { type: 'summary'; items: string[] };

interface TwoColCol {
  title: string;
  color: ColorKey;
  icon: string;
  desc: string;
  items: string[];
}

interface TheoryPage {
  title: string;
  icon: string;
  content: TheoryBlock[];
}

const theoryPages: TheoryPage[] = [
  {
    title: 'Der Weg zum echten Preis', icon: '🗺️',
    content: [
      { type: 'text', value: 'Stell dir vor, du baust Tische. Du willst wissen: Was kostet mich ein Tisch WIRKLICH? Die Buchhaltung (FIBU) kennt nur Aufwände nach Steuerrecht – das ist nicht die ganze Wahrheit.' },
      {
        type: 'flow', steps: [
          { label: 'FIBU-Aufwand',  desc: 'Was laut Gesetz aufgewendet wurde',           icon: '📋' },
          { label: 'BÜB',           desc: 'Korrektur: Was hat der Betrieb wirklich gekostet?', icon: '🔧' },
          { label: 'KoRe-Kosten',   desc: 'Betriebswirtschaftlich echte Kosten',         icon: '💰' },
          { label: 'BAB',           desc: 'Verteilung auf Abteilungen',                  icon: '📊' },
          { label: 'Selbstkosten',  desc: 'Was kostet ein Produkt wirklich?',            icon: '🏷️' },
        ],
      },
      { type: 'callout', emoji: '⚠️', value: 'Wer einfach FIBU-Aufwände als Kosten nimmt, kalkuliert falsch – und verkauft vielleicht unter den echten Kosten!' },
    ],
  },
  {
    title: 'Die 4 Kostenarten', icon: '🧩',
    content: [
      { type: 'text', value: 'Im BÜB begegnest du vier Arten von Positionen. Jede wird anders behandelt:' },
      {
        type: 'cards', items: [
          { label: 'Grundkosten',       desc: 'Aufwand = Kosten, identisch. Einfach 1:1 übernehmen.',     example: 'Hallenmiete, Energie, Gehälter',                     color: 'blue',    icon: '✅' },
          { label: 'Neutraler Aufwand', desc: 'Hat nichts mit dem Betrieb zu tun. Muss raus!',            example: 'Spenden, Brandschaden, Steuernachzahlung Vorjahr',   color: 'red',     icon: '🚫' },
          { label: 'Anderskosten',      desc: 'Existiert in FIBU, aber wir bewerten anders.',             example: 'Buchm. AfA → Kalk. AfA, FK-Zinsen → Kalk. Zinsen',   color: 'amber',   icon: '🔄' },
          { label: 'Zusatzkosten',      desc: 'In der FIBU gar nicht vorhanden. Muss dazu!',              example: 'Kalk. Unternehmerlohn, Kalk. Miete eigener Gebäude', color: 'emerald', icon: '➕' },
        ],
      },
      { type: 'callout', emoji: '💡', value: 'Anderskosten + Zusatzkosten = Kalkulatorische Kosten. Sie zeigen die betriebswirtschaftliche Realität.' },
    ],
  },
  {
    title: 'Die 3 Korrekturen im BÜB', icon: '🔧',
    content: [
      { type: 'text', value: 'Der BÜB macht drei Korrekturen am FIBU-Aufwand:' },
      {
        type: 'steps', items: [
          { n: '1', title: 'Neutralen Aufwand herausnehmen', desc: 'Betriebsfremd (Spende), außerordentlich (Brandschaden) oder periodenfremd (Steuernachzahlung Vorjahr) – alles raus!', sign: '−', color: 'red' },
          { n: '2', title: 'Anderskosten ersetzen', desc: 'Buchm. Werte durch kalk. Werte austauschen. Z.B. steuerliche AfA → AfA auf Wiederbeschaffungswert. Die Differenz wird verrechnet.', sign: '±', color: 'amber' },
          { n: '3', title: 'Zusatzkosten hinzufügen', desc: 'Kosten, die in der FIBU nicht existieren: Kalk. Unternehmerlohn, kalk. Miete, kalk. Wagnisse, kalk. EK-Zinsen.', sign: '+', color: 'emerald' },
        ],
      },
      { type: 'formula', lines: ['FIBU-Aufwand', '− Neutrale Aufwände', '± Anderskosten-Differenz', '+ Zusatzkosten', '────────────────────', '= Kosten laut KoRe'] },
    ],
  },
  {
    title: 'Warum kalkulatorische Kosten?', icon: '🤔',
    content: [
      { type: 'text', value: 'Die Buchhaltung folgt dem Steuerrecht. Aber intern wollen wir wissen, was der Betrieb WIRKLICH kostet:' },
      {
        type: 'comparison', items: [
          { label: 'Kalk. AfA',    buchm: 'Steuerl. AfA auf Anschaffungskosten',     kalk: 'AfA auf Wiederbeschaffungswert – was kostet die Maschine HEUTE?',                icon: '🏭' },
          { label: 'Kalk. Zinsen', buchm: 'Nur Fremdkapitalzinsen',                  kalk: 'Zinsen auf gesamtes betriebsnotw. Kapital (EK hat Opportunitätskosten!)',         icon: '💰' },
          { label: 'Kalk. U-Lohn', buchm: 'Kein Aufwand (Chef = Eigentümer)',        kalk: 'Was müsste man einem angestellten Geschäftsführer zahlen?',                       icon: '👤' },
          { label: 'Kalk. Miete',  buchm: 'Kein Aufwand (eigenes Gebäude)',          kalk: 'Was könnte man durch Vermietung verdienen?',                                       icon: '🏠' },
        ],
      },
    ],
  },
  {
    title: 'BAB: Gemeinkosten verteilen', icon: '📊',
    content: [
      { type: 'text', value: 'Nach dem BÜB haben wir die echten Kosten. Jetzt die Frage: Wie viel davon steckt in jedem Produkt?' },
      {
        type: 'twoCol',
        left: {
          title: 'Einzelkosten', color: 'blue', icon: '🎯', desc: 'Direkt einem Produkt zuordenbar',
          items: ['Materialeinzelkosten (MEK) – z.B. Holz für Tisch X', 'Fertigungseinzelkosten (FEK) – z.B. Lohn für Tisch X'],
        },
        right: {
          title: 'Gemeinkosten', color: 'purple', icon: '🌐', desc: 'Fallen für den ganzen Betrieb an',
          items: ['Hilfsstoffe (Leim, Schrauben)', 'Hallenmiete, Energie', 'Gehälter Verwaltung/Vertrieb', 'Kalk. AfA, Zinsen, etc.'],
        },
      },
      { type: 'callout', emoji: '📌', value: 'Einzelkosten → direkt zum Produkt. Gemeinkosten → müssen über den BAB auf 4 Kostenstellen verteilt werden.' },
    ],
  },
  {
    title: 'Die 4 Kostenstellen', icon: '🏢',
    content: [
      { type: 'text', value: 'Jede Abteilung ist eine Kostenstelle. Gemeinkosten werden zuerst auf diese Kostenstellen verteilt:' },
      {
        type: 'ksCards', items: [
          { label: 'Material',    icon: '📦', desc: 'Einkauf, Lager, Hilfsstoffe',           basis: 'Bezugsgröße: MEK' },
          { label: 'Fertigung',   icon: '⚙️', desc: 'Produktion, Maschinen, Werkstatt',     basis: 'Bezugsgröße: FEK' },
          { label: 'Verwaltung',  icon: '🏛️', desc: 'Buchhaltung, HR, Geschäftsführung',    basis: 'Bezugsgröße: HK' },
          { label: 'Vertrieb',    icon: '📣', desc: 'Verkauf, Marketing, Versand',          basis: 'Bezugsgröße: HK' },
        ],
      },
      { type: 'text', value: 'Die Verteilung passiert entweder direkt (Gehälter Verwaltung → 100% Verwaltung) oder über einen Verteilungsschlüssel (Miete → nach m² pro Abteilung).' },
    ],
  },
  {
    title: 'Vom BAB zu Selbstkosten', icon: '🏷️',
    content: [
      { type: 'text', value: 'Am Ende des BAB stehen die Gemeinkostenzuschlagssätze. Damit rechnest du die Selbstkosten je Produkt:' },
      {
        type: 'formula', lines: [
          '  MEK (direkt zugeordnet)',
          '+ MGK (MEK × MGK-Zuschlag%)',
          '+ FEK (direkt zugeordnet)',
          '+ FGK (FEK × FGK-Zuschlag%)',
          '────────────────────────────',
          '= HERSTELLKOSTEN (HK)',
          '+ VwGK (HK × VwGK-Zuschlag%)',
          '+ VtGK (HK × VtGK-Zuschlag%)',
          '────────────────────────────',
          '= SELBSTKOSTEN',
        ],
      },
      { type: 'callout', emoji: '🎯', value: 'Die Selbstkosten sind die Preisuntergrenze – darunter macht das Unternehmen Verlust.' },
    ],
  },
  {
    title: 'Bereit zum Üben!', icon: '🚀',
    content: [
      { type: 'text', value: 'Du kennst jetzt alle Bausteine. Hier nochmal die Kurzfassung:' },
      {
        type: 'summary', items: [
          'BÜB überführt FIBU-Aufwände in echte betriebswirtschaftliche Kosten',
          '3 Korrekturen: Neutral raus, Anderskosten ersetzen, Zusatzkosten dazu',
          'BAB verteilt Gemeinkosten auf Kostenstellen (Material, Fertigung, Verwaltung, Vertrieb)',
          'Direkte Kosten → 100% zu einer Kostenstelle, sonst Verteilungsschlüssel',
          'Zuschlagssätze = Gemeinkosten ÷ Bezugsgröße × 100',
          'Selbstkosten = HK + VwGK + VtGK → Preisuntergrenze!',
        ],
      },
      { type: 'callout', emoji: '💪', value: 'Im Übungsteil rechnest du jetzt ein komplettes Beispiel durch – vom FIBU-Aufwand bis zu den Selbstkosten pro Produkt.' },
    ],
  },
];

// ─── Color-Palette ─────────────────────────────────────────────────────

const palette: Record<ColorKey, { text: string; bgSoft: string; border: string; bg: string }> = {
  indigo:  { text: 'text-indigo-400',  bgSoft: 'bg-indigo-500/10',  border: 'border-indigo-500/40',  bg: 'bg-indigo-500' },
  blue:    { text: 'text-blue-400',    bgSoft: 'bg-blue-500/10',    border: 'border-blue-500/40',    bg: 'bg-blue-500' },
  emerald: { text: 'text-emerald-400', bgSoft: 'bg-emerald-500/10', border: 'border-emerald-500/40', bg: 'bg-emerald-500' },
  red:     { text: 'text-red-400',     bgSoft: 'bg-red-500/10',     border: 'border-red-500/40',     bg: 'bg-red-500' },
  amber:   { text: 'text-amber-400',   bgSoft: 'bg-amber-500/10',   border: 'border-amber-500/40',   bg: 'bg-amber-500' },
  purple:  { text: 'text-purple-400',  bgSoft: 'bg-purple-500/10',  border: 'border-purple-500/40',  bg: 'bg-purple-500' },
};

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

  if (block.type === 'flow') {
    return (
      <div className="my-4">
        {block.steps.map((s, j) => (
          <div key={j}>
            <Card className="flex items-center gap-3 py-2.5 my-1">
              <span className="text-2xl">{s.icon}</span>
              <div>
                <div className="font-bold text-sm text-white">{s.label}</div>
                <div className="text-xs text-[#9ca3af]">{s.desc}</div>
              </div>
            </Card>
            {j < block.steps.length - 1 && (
              <div className="text-center text-[#6b7280] text-base">↓</div>
            )}
          </div>
        ))}
      </div>
    );
  }

  if (block.type === 'cards') {
    return (
      <div className="my-3.5 grid grid-cols-1 sm:grid-cols-2 gap-2">
        {block.items.map((c, j) => {
          const p = palette[c.color];
          return (
            <div
              key={j}
              className={`bg-[#1e2130] border border-[#2d3148] rounded-xl p-3.5 ${p.text}`}
              style={{ borderLeft: '4px solid currentColor' }}
            >
              <div className="text-lg mb-1">{c.icon}</div>
              <div className={`font-extrabold text-xs ${p.text} mb-1`}>{c.label}</div>
              <div className="text-xs text-[#d1d5db] leading-relaxed mb-1.5">{c.desc}</div>
              <div className="text-[11px] text-[#9ca3af] italic">{c.example}</div>
            </div>
          );
        })}
      </div>
    );
  }

  if (block.type === 'steps') {
    return (
      <div className="my-3.5">
        {block.items.map((s, j) => {
          const p = palette[s.color];
          return (
            <div key={j} className="flex gap-3 mb-2.5 items-start">
              <div className={`w-9 h-9 rounded-full ${p.bg} text-white flex items-center justify-center font-extrabold text-base shrink-0`}>
                {s.sign}
              </div>
              <div className="flex-1">
                <div className="font-bold text-sm text-white">{s.title}</div>
                <div className="text-xs text-[#9ca3af] leading-relaxed mt-0.5">{s.desc}</div>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  if (block.type === 'formula') {
    return (
      <div className="bg-[#0c0e14] border border-[#2d3148] rounded-xl px-5 py-4 my-3.5 font-mono text-sm leading-loose overflow-x-auto">
        {block.lines.map((l, j) => {
          const color = l.startsWith('=') || l.startsWith('─')
            ? 'text-amber-400'
            : l.startsWith('+')
              ? 'text-emerald-400'
              : l.startsWith('−')
                ? 'text-red-400'
                : 'text-[#d1d5db]';
          return <div key={j} className={`${color} whitespace-pre`}>{l}</div>;
        })}
      </div>
    );
  }

  if (block.type === 'comparison') {
    return (
      <div className="my-3.5">
        {block.items.map((c, j) => (
          <Card key={j} className="flex gap-2.5 mb-2 items-start">
            <span className="text-xl shrink-0">{c.icon}</span>
            <div className="flex-1">
              <div className="font-bold text-sm text-white mb-1">{c.label}</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                <div className="text-xs text-red-300 bg-red-500/10 px-2 py-1 rounded-md">
                  <strong>FIBU:</strong> {c.buchm}
                </div>
                <div className="text-xs text-emerald-300 bg-emerald-500/10 px-2 py-1 rounded-md">
                  <strong>KoRe:</strong> {c.kalk}
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    );
  }

  if (block.type === 'twoCol') {
    const renderCol = (col: TwoColCol) => {
      const p = palette[col.color];
      return (
        <div className={`bg-[#1e2130] border ${p.border} rounded-xl p-3.5`}>
          <div className="text-xl mb-1">{col.icon}</div>
          <div className={`font-extrabold text-sm ${p.text}`}>{col.title}</div>
          <div className="text-xs text-[#9ca3af] mb-2">{col.desc}</div>
          {col.items.map((item, k) => (
            <div
              key={k}
              className={`text-xs text-[#d1d5db] leading-relaxed pl-2 mb-1 ${p.border}`}
              style={{ borderLeft: '2px solid currentColor' }}
            >
              {item}
            </div>
          ))}
        </div>
      );
    };
    return (
      <div className="my-3.5 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {renderCol(block.left)}
        {renderCol(block.right)}
      </div>
    );
  }

  if (block.type === 'ksCards') {
    return (
      <div className="my-3.5 grid grid-cols-2 gap-2">
        {block.items.map((c, j) => (
          <Card key={j} className="text-center">
            <div className="text-3xl mb-1">{c.icon}</div>
            <div className="font-extrabold text-sm text-white">{c.label}</div>
            <div className="text-xs text-[#9ca3af] mt-0.5">{c.desc}</div>
            <div className="text-[11px] text-indigo-400 font-bold mt-1.5 bg-indigo-500/15 px-2 py-0.5 rounded-md inline-block">
              {c.basis}
            </div>
          </Card>
        ))}
      </div>
    );
  }

  if (block.type === 'summary') {
    return (
      <div className="my-3.5">
        {block.items.map((item, j) => (
          <div key={j} className="flex gap-2.5 items-start mb-2">
            <div className="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center font-extrabold text-xs shrink-0 mt-0.5">
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
  page, pageIndex, totalPages, onNext, onPrev, onStartPractice,
}: {
  page: TheoryPage;
  pageIndex: number;
  totalPages: number;
  onNext: () => void;
  onPrev: () => void;
  onStartPractice: () => void;
}) {
  const isLast = pageIndex === totalPages - 1;
  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <span className="text-3xl">{page.icon}</span>
        <h2 className="text-xl font-extrabold text-white leading-tight m-0">{page.title}</h2>
      </div>
      {page.content.map((b, i) => <Block key={i} block={b} />)}

      <div className="flex gap-2.5 mt-5">
        {pageIndex > 0 && (
          <button
            type="button"
            onClick={onPrev}
            className="flex-1 py-3 rounded-xl border border-[#2d3148] bg-[#1e2130] hover:bg-[#252840] text-[#9ca3af] hover:text-white text-sm font-bold transition-colors"
          >
            ← Zurück
          </button>
        )}
        {isLast ? (
          <button
            type="button"
            onClick={onStartPractice}
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

// ─── Praxis-Helfer ─────────────────────────────────────────────────────

function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full border-collapse bg-[#1e2130] border border-[#2d3148] rounded-xl overflow-hidden text-sm">
        {children}
      </table>
    </div>
  );
}

const thCls = 'px-3 py-2.5 bg-[#252840] text-[#d1d5db] font-bold text-[10px] uppercase tracking-wider whitespace-nowrap text-left';
const tdCls = (i: number) => `px-3 py-2.5 border-b border-[#2d3148] text-sm ${i % 2 === 0 ? 'bg-[#1e2130]' : 'bg-[#1a1d27]'}`;

function SumRow({
  label, prefix, value, onChange, sign,
}: {
  label: string;
  prefix?: '+' | '−';
  value: string | number | undefined;
  onChange: (v: string) => void;
  sign?: 'pos' | 'neg';
}) {
  return (
    <Card className="mt-3 flex justify-between items-center gap-3 flex-wrap">
      <span className="font-bold text-white text-sm">{label}</span>
      <div className="flex items-center gap-1.5">
        {prefix && (
          <span className={`font-bold text-sm ${sign === 'neg' ? 'text-red-400' : 'text-emerald-400'}`}>{prefix}</span>
        )}
        <NumIn value={value} onChange={onChange} width="w-28" />
      </div>
    </Card>
  );
}

// ─── Praxis-Ansicht (alte v3-Logik, leicht umorganisiert) ──────────────

function PracticeView({ onBackToTheory }: { onBackToTheory: () => void }) {
  const [step, setStep] = useState<StepId>('p1');
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [fb, setFb] = useState<{ ok: boolean; msg: string } | null>(null);

  const [types, setTypes] = useState<Record<number, string>>({});
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [nSum, setNSum] = useState('');
  const [kV, setKV] = useState<Record<number, string>>({});
  const [dV, setDV] = useState<Record<number, string>>({});
  const [dSum, setDSum] = useState('');
  const [zV, setZV] = useState<Record<string, string>>({});
  const [zSum, setZSum] = useState('');
  const [koreA, setKoreA] = useState('');
  const [ekA, setEkA] = useState('');
  const [gkA, setGkA] = useState('');
  const [babType, setBabType] = useState<Record<string, 'direkt' | 'schlüssel'>>({});
  const [babTarget, setBabTarget] = useState<Record<string, KsKey>>({});
  const [babBasis, setBabBasis] = useState<Record<string, BasisKey>>({});
  const [hkA, setHkA] = useState('');
  const [zsA, setZsA] = useState<Record<string, string>>({});
  const [ktA, setKtA] = useState<Record<string, string>>({});

  const go = (id: StepId) => { setStep(id); setFb(null); };
  const ok = (k: string) => setDone(p => ({ ...p, [k]: true }));
  const clr = () => setFb(null);
  const err = (m: string) => setFb({ ok: false, msg: m });
  const suc = (m: string) => setFb({ ok: true, msg: m });

  const cKT = (mek: number, fek: number) => {
    const mg = Math.round(mek * MGK_P / 100);
    const fg = Math.round(fek * FGK_P / 100);
    const hk = mek + mg + fek + fg;
    const vw = Math.round(hk * VwGK_P / 100);
    const vt = Math.round(hk * VtGK_P / 100);
    return { mgk: mg, fgk: fg, hk, vwgk: vw, vtgk: vt, sk: hk + vw + vt };
  };
  const tK = cKT(MEK_TI, FEK_TI);
  const rK = cKT(MEK_RE, FEK_RE);

  const c1 = () => {
    if (!FIBU.every(f => types[f.id])) return err('Bitte alle Positionen zuordnen.');
    const w = FIBU.filter(f => types[f.id] !== f.type);
    if (w.length) return err(`${w.length} falsch: ${w.map(x => x.name).join(', ')}`);
    suc('Alle Positionen richtig!'); ok('p1');
  };
  const c2 = () => {
    const it = FIBU.filter(f => f.type === 'neutral');
    if (!it.every(f => reasons[f.id])) return err('Bitte alle Begründungen wählen.');
    const w = it.filter(f => reasons[f.id] !== f.reason);
    if (w.length) return err(`Falsch: ${w.map(x => x.name).join(', ')}`);
    const s = it.reduce((a, f) => a + f.amount, 0);
    if (numFromInput(nSum) !== s) return err(`Begründungen stimmen, Summe falsch. Richtig: ${fmtEur(s)}`);
    suc(`Neutraler Aufwand: −${fmtEur(s)}`); ok('p2');
  };
  const c3 = () => {
    const it = FIBU.filter(f => f.type === 'anderskosten');
    for (const f of it) {
      if (numFromInput(kV[f.id]) !== f.kalkValue) return err(`${f.name}: Kalk. Wert falsch. Richtig: ${fmtEur(f.kalkValue!)}`);
      if (numFromInput(dV[f.id]) !== (f.kalkValue! - f.amount)) return err(`${f.name}: Differenz falsch. Richtig: ${fmtEur(f.kalkValue! - f.amount)}`);
    }
    const s = it.reduce((a, f) => a + (f.kalkValue! - f.amount), 0);
    if (numFromInput(dSum) !== s) return err(`Gesamtdifferenz falsch. Richtig: ${fmtEur(s)}`);
    suc(`Anderskosten-Differenz: +${fmtEur(s)}`); ok('p3');
  };
  const c4 = () => {
    const w = ZUSATZ.filter(z => numFromInput(zV[z.id]) !== z.amount);
    if (w.length) return err(`Falsch: ${w.map(z => z.name).join(', ')}`);
    const s = ZUSATZ.reduce((a, z) => a + z.amount, 0);
    if (numFromInput(zSum) !== s) return err(`Summe falsch. Richtig: ${fmtEur(s)}`);
    suc(`Zusatzkosten: +${fmtEur(s)}`); ok('p4');
  };
  const c5 = () => {
    if (numFromInput(koreA) !== KORE) return err(`${fmtEur(numFromInput(koreA))} ist falsch. Richtig: ${fmtEur(KORE)}`);
    suc(`${fmtEur(KORE)} – BÜB abgeschlossen!`); ok('p5');
  };
  const c6 = () => {
    if (numFromInput(ekA) !== EK_T) return err(`Einzelkosten falsch. Richtig: ${fmtEur(EK_T)}`);
    if (numFromInput(gkA) !== GK_T) return err(`EK stimmt! GK falsch. Richtig: ${fmtEur(GK_T)}`);
    suc(`EK: ${fmtEur(EK_T)}, GK: ${fmtEur(GK_T)}`); ok('p6');
  };
  const c7 = () => {
    const errs: string[] = [];
    GK_ITEMS.forEach(g => {
      const typ = babType[g.id];
      if (!typ) { errs.push(`${g.name}: Methode fehlt`); return; }
      if (g.isDirekt && typ !== 'direkt') { errs.push(`${g.name}: Sollte direkt sein`); return; }
      if (!g.isDirekt && typ !== 'schlüssel') { errs.push(`${g.name}: Braucht Schlüssel`); return; }
      if (g.isDirekt) {
        if (babTarget[g.id] !== g.target) errs.push(`${g.name}: Falsche KS`);
      } else {
        if (babBasis[g.id] !== g.basis) errs.push(`${g.name}: Falscher Schlüssel`);
      }
    });
    if (errs.length) return err(errs.slice(0, 4).join(' · ') + (errs.length > 4 ? ` · +${errs.length - 4} weitere` : ''));
    suc(`Richtig! Mat: ${fmtEur(MGK)} | Fert: ${fmtEur(FGK)} | Verw: ${fmtEur(VwGK)} | Vertr: ${fmtEur(VtGK)}`);
    ok('p7');
  };
  const c8 = () => {
    if (!closeEur(numFromInput(hkA), HK_VAL)) return err(`Herstellkosten falsch. Richtig: ${fmtEur(HK_VAL)}`);
    const w: string[] = [];
    const fP = (n: number) => n.toFixed(2).replace('.', ',') + ' %';
    ([['mgk', MGK_P, 'MGK'], ['fgk', FGK_P, 'FGK'], ['vwgk', VwGK_P, 'VwGK'], ['vtgk', VtGK_P, 'VtGK']] as const).forEach(([k, c, l]) => {
      const v = parseFloat(String(zsA[k] || '').replace(',', '.'));
      if (isNaN(v) || !closePct(v, c)) w.push(`${l} (=${fP(c)})`);
    });
    if (w.length) return err(`HK stimmt! Zuschlagssätze falsch: ${w.join(', ')}`);
    suc('Alle Zuschlagssätze korrekt!'); ok('p8');
  };
  const c9 = () => {
    const fs: [string, number][] = [
      ['t_mgk', tK.mgk], ['t_fgk', tK.fgk], ['t_hk', tK.hk], ['t_vwgk', tK.vwgk], ['t_vtgk', tK.vtgk], ['t_sk', tK.sk],
      ['r_mgk', rK.mgk], ['r_fgk', rK.fgk], ['r_hk', rK.hk], ['r_vwgk', rK.vwgk], ['r_vtgk', rK.vtgk], ['r_sk', rK.sk],
    ];
    const w = fs.filter(([k, v]) => !closeEur(numFromInput(ktA[k]), v));
    if (w.length) return err(`${w.length} Werte falsch. ${w.slice(0, 3).map(([, v]) => fmtEur(v)).join(', ')}`);
    suc(`Tische: ${fmtEur(tK.sk)} | Regale: ${fmtEur(rK.sk)}`); ok('p9');
  };

  const next = (nextId: StepId, label = 'Weiter →') => (
    <PrimaryBtn label={label} onClick={() => go(nextId)} color="emerald" />
  );

  function GKCard({ g }: { g: GkItem }) {
    const typ = babType[g.id];
    const tgt = babTarget[g.id];
    const bas = babBasis[g.id];

    return (
      <Card className="mb-2.5">
        <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
          <span className="font-bold text-white text-sm">{g.name}</span>
          <span className="font-mono text-[#d1d5db] text-sm">{fmtEur(g.amount)}</span>
        </div>

        <div className="mb-2.5">
          <div className="text-[10px] font-bold text-[#9ca3af] uppercase tracking-wider mb-1.5">
            ① Wie verteilen?
          </div>
          <div className="flex gap-1.5 flex-wrap">
            <ToggleBtn
              label="Direkt → eine Kostenstelle"
              active={typ === 'direkt'}
              color="blue"
              onClick={() => { setBabType(p => ({ ...p, [g.id]: 'direkt' })); clr(); }}
            />
            <ToggleBtn
              label="Verteilungsschlüssel nötig"
              active={typ === 'schlüssel'}
              color="purple"
              onClick={() => { setBabType(p => ({ ...p, [g.id]: 'schlüssel' })); clr(); }}
            />
          </div>
        </div>

        {typ === 'direkt' && (
          <div className="pl-4 border-l-[3px] border-blue-500">
            <div className="text-[10px] font-bold text-[#9ca3af] uppercase tracking-wider mb-1.5">
              ② Welche Kostenstelle?
            </div>
            <div className="flex gap-1 flex-wrap">
              {KSN.map(k => (
                <ToggleBtn
                  key={k}
                  label={KSL[k]}
                  active={tgt === k}
                  color="emerald"
                  onClick={() => { setBabTarget(p => ({ ...p, [g.id]: k })); clr(); }}
                />
              ))}
            </div>
          </div>
        )}

        {typ === 'schlüssel' && (
          <div className="pl-4 border-l-[3px] border-purple-500">
            <div className="text-[10px] font-bold text-[#9ca3af] uppercase tracking-wider mb-1.5">
              ② Nach welchem Schlüssel?
            </div>
            <div className="text-xs text-[#9ca3af] mb-1.5">
              Was bestimmt logisch, wie viel jede Abteilung von diesen Kosten verursacht?
            </div>
            <div className="flex gap-1 flex-wrap">
              {BASES.map(b => (
                <ToggleBtn
                  key={b.id}
                  label={`${b.icon} ${b.label}`}
                  active={bas === b.id}
                  color="purple"
                  onClick={() => { setBabBasis(p => ({ ...p, [g.id]: b.id })); clr(); }}
                />
              ))}
            </div>
          </div>
        )}
      </Card>
    );
  }

  return (
    <div>
      <StepNav
        steps={STEPS}
        current={step}
        done={done}
        onSelect={(id) => go(id as StepId)}
        groupLabels={{ left: 'BÜB', right: 'BAB + Kostenträger', splitAt: 5 }}
      />

      {/* P1 */}
      {step === 'p1' && (
        <div>
          <StepHeader step="1" title="Kostenarten klassifizieren" sub="Ordne jede Position zu." />
          <HintBox>
            <strong>Grundkosten:</strong> Aufwand = Kosten<br />
            <strong>Neutral:</strong> gehört nicht in KoRe<br />
            <strong>Anderskosten:</strong> wird anders bewertet
          </HintBox>
          <Table>
            <thead>
              <tr>
                <th className={thCls}>Position</th>
                <th className={`${thCls} text-right`}>Betrag</th>
                <th className={`${thCls} text-center`}>Zuordnung</th>
              </tr>
            </thead>
            <tbody>
              {FIBU.map((f, i) => (
                <tr key={f.id}>
                  <td className={tdCls(i)}>{f.name}</td>
                  <td className={`${tdCls(i)} text-right font-mono`}>{fmtEur(f.amount)}</td>
                  <td className={`${tdCls(i)} text-center`}>
                    <div className="flex gap-1 justify-center flex-wrap">
                      {([
                        ['Grundkosten', 'grundkosten', 'blue'],
                        ['Neutral', 'neutral', 'red'],
                        ['Anderskosten', 'anderskosten', 'amber'],
                      ] as const).map(([label, val, color]) => (
                        <ToggleBtn
                          key={val}
                          label={label}
                          active={types[f.id] === val}
                          color={color}
                          onClick={() => { setTypes(p => ({ ...p, [f.id]: val })); clr(); }}
                        />
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
              <tr className="bg-[#252840]">
                <td className="px-3 py-2.5 text-white font-bold">GESAMT FIBU</td>
                <td className="px-3 py-2.5 text-right font-mono text-amber-400 font-bold">{fmtEur(TOTAL_FIBU)}</td>
                <td />
              </tr>
            </tbody>
          </Table>
          <FeedbackBox feedback={fb} />
          {!done.p1 ? <PrimaryBtn label="Überprüfen" onClick={c1} /> : next('p2')}
        </div>
      )}

      {/* P2 */}
      {step === 'p2' && (
        <div>
          <StepHeader step="2" title="Neutrale Aufwände begründen" sub="Begründung + Summe berechnen." />
          <Table>
            <thead>
              <tr>
                <th className={thCls}>Position</th>
                <th className={`${thCls} text-right`}>Betrag</th>
                <th className={`${thCls} text-center`}>Begründung</th>
              </tr>
            </thead>
            <tbody>
              {FIBU.filter(f => f.type === 'neutral').map((f, i) => (
                <tr key={f.id}>
                  <td className={tdCls(i)}>{f.name}</td>
                  <td className={`${tdCls(i)} text-right font-mono text-red-400`}>−{fmtEur(f.amount)}</td>
                  <td className={`${tdCls(i)} text-center`}>
                    <div className="flex gap-1 justify-center flex-wrap">
                      {(['betriebsfremd', 'außerordentlich', 'periodenfremd'] as const).map(r => (
                        <ToggleBtn
                          key={r}
                          label={r}
                          active={reasons[f.id] === r}
                          color="red"
                          onClick={() => { setReasons(p => ({ ...p, [f.id]: r })); clr(); }}
                        />
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          <SumRow label="Summe neutraler Aufwand:" prefix="−" sign="neg" value={nSum} onChange={v => { setNSum(v); clr(); }} />
          <FeedbackBox feedback={fb} />
          {!done.p2 ? <PrimaryBtn label="Überprüfen" onClick={c2} /> : next('p3')}
        </div>
      )}

      {/* P3 */}
      {step === 'p3' && (
        <div>
          <StepHeader step="3" title="Anderskosten-Differenz" sub="Kalk. Wert + Differenz + Summe selbst berechnen." />
          <InfoBox>
            <strong>Zusatzinfos:</strong><br />
            • Kalk. AfA (Wiederbeschaffungswert): <strong>9.000 €</strong><br />
            • Kalk. Zinsen (ges. betriebsnotw. Kapital): <strong>5.000 €</strong>
          </InfoBox>
          <Table>
            <thead>
              <tr>
                <th className={thCls}>Position</th>
                <th className={`${thCls} text-right`}>Buchm.</th>
                <th className={`${thCls} text-center`}>Kalk. Wert</th>
                <th className={`${thCls} text-center`}>Differenz</th>
              </tr>
            </thead>
            <tbody>
              {FIBU.filter(f => f.type === 'anderskosten').map((f, i) => (
                <tr key={f.id}>
                  <td className={tdCls(i)}>{f.name}</td>
                  <td className={`${tdCls(i)} text-right font-mono`}>{fmtEur(f.amount)}</td>
                  <td className={`${tdCls(i)} text-center`}>
                    <NumIn value={kV[f.id]} onChange={v => { setKV(p => ({ ...p, [f.id]: v })); clr(); }} />
                  </td>
                  <td className={`${tdCls(i)} text-center`}>
                    <div className="flex items-center justify-center gap-1">
                      <span className="text-emerald-400 font-bold text-sm">+</span>
                      <NumIn value={dV[f.id]} onChange={v => { setDV(p => ({ ...p, [f.id]: v })); clr(); }} width="w-20" />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          <SumRow label="Gesamte Anderskosten-Differenz:" prefix="+" sign="pos" value={dSum} onChange={v => { setDSum(v); clr(); }} />
          <FeedbackBox feedback={fb} />
          {!done.p3 ? <PrimaryBtn label="Überprüfen" onClick={c3} /> : next('p4')}
        </div>
      )}

      {/* P4 */}
      {step === 'p4' && (
        <div>
          <StepHeader step="4" title="Kalkulatorische Zusatzkosten" sub="Beträge + Summe berechnen." />
          <InfoBox>
            <strong>Zusatzinfos:</strong><br />
            • Unternehmer arbeitet mit → Unternehmerlohn: <strong>5.000 €</strong><br />
            • Eigene Lagerhalle → kalk. Miete: <strong>3.000 €</strong>
          </InfoBox>
          <Table>
            <thead>
              <tr>
                <th className={thCls}>Position</th>
                <th className={`${thCls} text-right`}>In FIBU</th>
                <th className={`${thCls} text-center`}>Kalk. Kosten</th>
              </tr>
            </thead>
            <tbody>
              {ZUSATZ.map((z, i) => (
                <tr key={z.id}>
                  <td className={tdCls(i)}>{z.name}</td>
                  <td className={`${tdCls(i)} text-right font-mono text-[#6b7280]`}>0 €</td>
                  <td className={`${tdCls(i)} text-center`}>
                    <NumIn value={zV[z.id]} onChange={v => { setZV(p => ({ ...p, [z.id]: v })); clr(); }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          <SumRow label="Summe Zusatzkosten:" prefix="+" sign="pos" value={zSum} onChange={v => { setZSum(v); clr(); }} />
          <FeedbackBox feedback={fb} />
          {!done.p4 ? <PrimaryBtn label="Überprüfen" onClick={c4} /> : next('p5')}
        </div>
      )}

      {/* P5 */}
      {step === 'p5' && (
        <div>
          <StepHeader step="5" title="BÜB-Ergebnis" sub="Kosten laut Kostenrechnung berechnen." />
          <Card>
            <div className="font-mono text-sm leading-loose space-y-1">
              {([
                ['FIBU-Aufwand', fmtEur(TOTAL_FIBU), 'text-white'],
                ['− Neutraler Aufwand', `−${fmtEur(10000)}`, 'text-red-400'],
                ['+ Anderskosten-Diff.', `+${fmtEur(7000)}`, 'text-amber-400'],
                ['+ Zusatzkosten', `+${fmtEur(8000)}`, 'text-emerald-400'],
              ] as const).map(([l, v, c]) => (
                <div key={l} className={`flex justify-between ${c}`}>
                  <span>{l}</span><span>{v}</span>
                </div>
              ))}
              <div className="border-t-2 border-[#2d3148] mt-2 pt-2 flex justify-between items-center">
                <span className="font-bold text-white">= Kosten laut KoRe</span>
                <NumIn value={koreA} onChange={v => { setKoreA(v); clr(); }} width="w-32" />
              </div>
            </div>
          </Card>
          <FeedbackBox feedback={fb} />
          {!done.p5 ? <PrimaryBtn label="Überprüfen" onClick={c5} /> : next('p6', 'Weiter zum BAB →')}
        </div>
      )}

      {/* P6 */}
      {step === 'p6' && (
        <div>
          <StepHeader step="6" title="Einzel- & Gemeinkosten" sub="EK und GK selbst berechnen." />
          <div className="my-3 px-4 py-3 rounded-xl border bg-emerald-500/10 border-emerald-500/30 text-emerald-200 text-sm">
            ✅ BÜB fertig! Kosten laut KoRe: <strong>{fmtEur(KORE)}</strong>
          </div>
          <InfoBox>
            <strong>Einzelkosten:</strong><br />
            Tische: MEK {fmtEur(MEK_TI)} + FEK {fmtEur(FEK_TI)} | Regale: MEK {fmtEur(MEK_RE)} + FEK {fmtEur(FEK_RE)}
          </InfoBox>
          <Card>
            <div className="flex justify-between items-center flex-wrap gap-2 mb-4">
              <div>
                <div className="font-bold text-white text-sm">Gesamte Einzelkosten</div>
                <div className="text-xs text-[#9ca3af]">MEK + FEK</div>
              </div>
              <NumIn value={ekA} onChange={v => { setEkA(v); clr(); }} width="w-32" />
            </div>
            <div className="border-t border-[#2d3148] pt-4 flex justify-between items-center flex-wrap gap-2">
              <div>
                <div className="font-bold text-white text-sm">Gemeinkosten</div>
                <div className="text-xs text-[#9ca3af]">KoRe − EK</div>
              </div>
              <NumIn value={gkA} onChange={v => { setGkA(v); clr(); }} width="w-32" />
            </div>
          </Card>
          <FeedbackBox feedback={fb} />
          {!done.p6 ? <PrimaryBtn label="Überprüfen" onClick={c6} /> : next('p7')}
        </div>
      )}

      {/* P7 */}
      {step === 'p7' && (
        <div>
          <StepHeader step="7" title="Gemeinkosten verteilen" sub={`${fmtEur(GK_T)} auf 4 Kostenstellen – entscheide selbst WIE.`} />
          <InfoBox>
            Für jede Kostenart entscheide:<br />
            <strong>①</strong> Kann man die Kosten <strong>direkt einer Abteilung</strong> zuordnen? Oder braucht man einen <strong>Verteilungsschlüssel</strong>?<br />
            <strong>②</strong> Wenn direkt: Welche Kostenstelle? Wenn Schlüssel: <strong>nach welchem Kriterium</strong> verteilt man sinnvoll?
          </InfoBox>
          <HintBox label="💡 Welcher Schlüssel passt wozu?">
            <strong>📐 Fläche (m²):</strong> Kosten, die von der genutzten Fläche abhängen<br />
            <strong>⚡ Verbrauch (kWh):</strong> Kosten, die vom tatsächlichen Energieverbrauch abhängen<br />
            <strong>🏭 Anlagenwert:</strong> Kosten, die mit dem Wert der Maschinen/Anlagen zusammenhängen<br />
            <strong>💰 Kapitalbindung:</strong> Kosten, die vom gebundenen Kapital je Abteilung abhängen<br />
            <strong>👤 Tätigkeitsanteil:</strong> Wenn keine messbare Größe existiert → Schätzung nach Arbeitszeit
          </HintBox>
          {GK_ITEMS.map(g => <GKCard key={g.id} g={g} />)}
          <FeedbackBox feedback={fb} />
          {!done.p7 ? (
            <PrimaryBtn label="Überprüfen" onClick={c7} />
          ) : (
            <div>
              <Card className="mt-3.5">
                <div className="text-xs font-bold mb-2.5 text-white">Ergebnis der Verteilung:</div>
                <div className="overflow-x-auto -mx-1">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr>
                        <th className={thCls}>Kostenart</th>
                        {KSN.map(k => (
                          <th key={k} className={`${thCls} text-right`}>{KSL[k]}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {GK_ITEMS.map((g, i) => (
                        <tr key={g.id}>
                          <td className={tdCls(i)}>{g.name}</td>
                          {KSN.map(k => (
                            <td
                              key={k}
                              className={`${tdCls(i)} text-right font-mono ${g.dist[k] === 0 ? 'text-[#4b5563]' : 'text-[#d1d5db]'}`}
                            >
                              {g.dist[k] === 0 ? '–' : fmtEur(g.dist[k])}
                            </td>
                          ))}
                        </tr>
                      ))}
                      <tr className="bg-[#252840]">
                        <td className="px-3 py-2.5 text-white font-bold">SUMME</td>
                        {KSN.map(k => (
                          <td key={k} className="px-3 py-2.5 text-right font-mono text-amber-400 font-bold">
                            {fmtEur(cKS[k])}
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </Card>
              {next('p8')}
            </div>
          )}
        </div>
      )}

      {/* P8 */}
      {step === 'p8' && (
        <div>
          <StepHeader step="8" title="Herstellkosten & Zuschlagssätze" sub="HK berechnen, dann Zuschlagssätze." />
          <HintBox label="📐 Formeln anzeigen">
            <strong>HK</strong> = MEK + MGK + FEK + FGK<br /><br />
            <strong>MGK%</strong> = Mat-GK ÷ MEK × 100<br />
            <strong>FGK%</strong> = Fert-GK ÷ FEK × 100<br />
            <strong>VwGK%</strong> = Verw-GK ÷ HK × 100<br />
            <strong>VtGK%</strong> = Vertr-GK ÷ HK × 100
          </HintBox>
          <InfoBox>
            <strong>BAB-Ergebnisse:</strong><br />
            MEK = {fmtEur(MEK_T)} | FEK = {fmtEur(FEK_T)}<br />
            Mat-GK = {fmtEur(MGK)} | Fert-GK = {fmtEur(FGK)} | Verw-GK = {fmtEur(VwGK)} | Vertr-GK = {fmtEur(VtGK)}
          </InfoBox>
          <Card>
            <div className="flex justify-between items-center mb-4 pb-4 border-b-2 border-[#2d3148] flex-wrap gap-2">
              <div>
                <div className="font-bold text-white">Herstellkosten (HK)</div>
                <div className="text-xs text-[#9ca3af]">MEK + MGK + FEK + FGK</div>
              </div>
              <NumIn value={hkA} onChange={v => { setHkA(v); clr(); }} width="w-32" />
            </div>
            {[
              { k: 'mgk', l: 'Material-GK-Zuschlag' },
              { k: 'fgk', l: 'Fertigungs-GK-Zuschlag' },
              { k: 'vwgk', l: 'Verwaltungs-GK-Zuschlag' },
              { k: 'vtgk', l: 'Vertriebs-GK-Zuschlag' },
            ].map((z, i) => (
              <div
                key={z.k}
                className={`flex justify-between items-center py-3 flex-wrap gap-2 ${i < 3 ? 'border-b border-[#2d3148]' : ''}`}
              >
                <span className="font-bold text-white text-sm">{z.l}</span>
                <div className="flex items-center gap-1">
                  <NumIn value={zsA[z.k]} onChange={v => { setZsA(p => ({ ...p, [z.k]: v })); clr(); }} width="w-20" />
                  <span className="font-bold text-[#d1d5db]">%</span>
                </div>
              </div>
            ))}
          </Card>
          <FeedbackBox feedback={fb} />
          {!done.p8 ? <PrimaryBtn label="Überprüfen" onClick={c8} /> : next('p9')}
        </div>
      )}

      {/* P9 */}
      {step === 'p9' && (
        <div>
          <StepHeader step="9" title="Kostenträgerrechnung" sub="Selbstkosten berechnen." />
          <HintBox label="📐 Zuschlagssätze anzeigen">
            MGK: {MGK_P}% | FGK: {FGK_P}% | VwGK: {VwGK_P}% | VtGK: {VtGK_P}%
          </HintBox>
          {[
            { t: '🪑 Tische', mek: MEK_TI, fek: FEK_TI, p: 't' },
            { t: '📚 Regale', mek: MEK_RE, fek: FEK_RE, p: 'r' },
          ].map(pr => (
            <Card key={pr.p} className="mb-3">
              <div className="font-bold text-white text-base mb-3">{pr.t}</div>
              <table className="w-full border-collapse text-sm">
                <tbody>
                  {([
                    { l: 'MEK', f: fmtEur(pr.mek) },
                    { l: `+ MGK (${MGK_P}%)`, k: 'mgk' },
                    { l: 'FEK', f: fmtEur(pr.fek) },
                    { l: `+ FGK (${FGK_P}%)`, k: 'fgk' },
                    { l: '= Herstellkosten', k: 'hk', b: true },
                    { l: `+ VwGK (${VwGK_P}%)`, k: 'vwgk' },
                    { l: `+ VtGK (${VtGK_P}%)`, k: 'vtgk' },
                    { l: '= Selbstkosten', k: 'sk', b: true, fin: true },
                  ] as Array<{ l: string; f?: string; k?: string; b?: boolean; fin?: boolean }>).map((r, i) => (
                    <tr key={i} className={r.fin ? 'bg-emerald-500/10' : r.b ? 'bg-[#252840]' : ''}>
                      <td className={`px-3 py-2 border-b border-[#2d3148] ${r.b ? 'font-bold text-white' : 'text-[#d1d5db]'} ${r.fin ? 'text-base' : ''}`}>
                        {r.l}
                      </td>
                      <td className="px-3 py-2 border-b border-[#2d3148] text-right">
                        {r.f ? (
                          <span className="font-mono text-[#d1d5db]">{r.f}</span>
                        ) : (
                          <NumIn
                            value={ktA[`${pr.p}_${r.k}`]}
                            onChange={v => { setKtA(p => ({ ...p, [`${pr.p}_${r.k}`]: v })); clr(); }}
                            width="w-28"
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ))}
          <FeedbackBox feedback={fb} />
          {!done.p9 ? (
            <PrimaryBtn label="Überprüfen" onClick={c9} />
          ) : (
            <div className="my-3 px-4 py-3 rounded-xl border bg-emerald-500/10 border-emerald-500/30 text-emerald-200 text-sm leading-relaxed">
              🎉 <strong>Geschafft!</strong> BÜB → BAB → Kostenträger komplett!<br /><br />
              Tische: <strong>{fmtEur(tK.sk)}</strong> | Regale: <strong>{fmtEur(rK.sk)}</strong> | Kontrolle: <strong>{fmtEur(tK.sk + rK.sk)} = {fmtEur(KORE)}</strong> ✓
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={onBackToTheory}
        className="w-full py-2.5 rounded-lg border border-indigo-500/30 bg-transparent text-[#9ca3af] hover:text-white text-xs transition-colors mt-4"
      >
        📖 Zurück zur Theorie
      </button>
    </div>
  );
}

// ─── Hauptkomponente ───────────────────────────────────────────────────

export default function BuebBabKurs({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<'theory' | 'practice'>('theory');
  const [tp, setTp] = useState(0);

  return (
    <ExerciseShell
      title="BÜB & BAB Kurs"
      subtitle="Tischlerei Berger KG – März"
      onClose={onClose}
    >
      <div className="max-w-2xl mx-auto">
        {/* Mode toggle */}
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-[#2d3148]">
          <div>
            <div className="text-[10px] font-extrabold text-indigo-400 uppercase tracking-[0.2em]">
              BÜB & BAB Kurs
            </div>
            <div className="text-[11px] text-[#6b7280] mt-0.5">
              {mode === 'theory' ? `Lektion ${tp + 1}/${theoryPages.length}` : 'Übungsmodus'}
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
            {theoryPages.map((_, i) => (
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
            page={theoryPages[tp]}
            pageIndex={tp}
            totalPages={theoryPages.length}
            onNext={() => setTp(p => Math.min(p + 1, theoryPages.length - 1))}
            onPrev={() => setTp(p => Math.max(p - 1, 0))}
            onStartPractice={() => setMode('practice')}
          />
        ) : (
          <PracticeView onBackToTheory={() => setMode('theory')} />
        )}

        <div className="text-center text-[10px] text-[#6b7280] mt-5 pb-4">
          FH Wien · Kostenrechnung · BÜB & BAB
        </div>
      </div>
    </ExerciseShell>
  );
}
