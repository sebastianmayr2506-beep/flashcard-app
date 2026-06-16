// Cash-Flow Kurs
// Kombiniert Theorie (7 Lektionen) + Praxis (5 Szenarien) zur
// Kapitalflussrechnung. Portiert aus cashflow-kurs.jsx (Light-Theme,
// Inline-Styles) auf Tailwind + Dark-Theme.
//
// Anders als der BÜB-Trainer hat dieser Kurs zwei Modi (Theorie / Üben)
// und eine starke semantische Farbcodierung: oCF = cyan, invCF = amber,
// fCF = emerald, Working-Capital ± = emerald/red. Die übungsspezifischen
// UI-Bausteine (ContentBlock, PracticeInput, PracticeSum) sind inline
// definiert; nur ExerciseShell + Card werden aus _shared.tsx reused.

import { useState } from 'react';
import { ExerciseShell, Card } from './_shared';

// ─── Theorie-Daten ─────────────────────────────────────────────────────

type ContentBlock =
  | { type: 'text'; value: string }
  | { type: 'callout'; emoji: string; value: string }
  | { type: 'comparison'; items: { label: string; icon: string; desc: string; color: ColorKey }[] }
  | { type: 'stack'; items: { label: string; abbr: string; desc: string; color: ColorKey; icon: string }[] }
  | { type: 'formula'; lines: string[] }
  | { type: 'formulaDetailed'; steps: { code: string; label: string; desc: string; sign: string }[] }
  | { type: 'example'; title: string; scenario: string; result: string }
  | { type: 'wcRule'; rules: { situation: string; meaning: string; effect: string; cfEffect: '+' | '−' | '±'; color: ColorKey }[] }
  | { type: 'assetSale'; title: string; buchwert: number; verkauf: number; diff: number }
  | { type: 'correction'; steps: string[] }
  | { type: 'summary'; items: string[] };

type ColorKey = 'cyan' | 'amber' | 'emerald' | 'red' | 'purple' | 'indigo';

interface TheoryPage {
  title: string;
  icon: string;
  content: ContentBlock[];
}

const theoryPages: TheoryPage[] = [
  {
    title: 'Was ist Cash-Flow?',
    icon: '💧',
    content: [
      { type: 'text', value: 'Stell dir ein Waschbecken vor: Wasser fließt rein (Einnahmen) und Wasser fließt raus (Ausgaben). Der Cash-Flow zeigt dir genau das – den echten Geldfluss in deinem Unternehmen.' },
      {
        type: 'comparison',
        items: [
          { label: 'Umsatz', icon: '🏷️', desc: 'Was du verkaufst – egal ob bezahlt oder nicht', color: 'amber' },
          { label: 'Gewinn', icon: '📊', desc: 'Umsatz minus alle Aufwände laut Buchhaltung', color: 'purple' },
          { label: 'Cash-Flow', icon: '💰', desc: 'Was wirklich an Geld rein- und rausfließt', color: 'emerald' },
        ],
      },
      { type: 'callout', emoji: '⚠️', value: 'Du kannst profitabel sein und trotzdem kein Geld haben! Z.B. wenn Kunden auf Rechnung kaufen und noch nicht bezahlt haben.' },
    ],
  },
  {
    title: 'Die drei Cash-Flows',
    icon: '🧩',
    content: [
      { type: 'text', value: 'Die Kapitalflussrechnung teilt den gesamten Geldfluss in drei Bereiche auf:' },
      {
        type: 'stack',
        items: [
          { label: 'Operativer CF', abbr: 'oCF', desc: 'Geld aus dem laufenden Geschäft. Verkaufe ich genug Würstel?', color: 'cyan', icon: '⚙️' },
          { label: 'Investitions-CF', abbr: 'invCF', desc: 'Geld für Anlagen. Habe ich Maschinen gekauft oder verkauft?', color: 'amber', icon: '🏗️' },
          { label: 'Finanzieller CF', abbr: 'finCF', desc: 'Geld aus Finanzierung. Kredite aufgenommen oder getilgt? Dividenden gezahlt?', color: 'purple', icon: '🏦' },
        ],
      },
      { type: 'formula', lines: ['oCF + invCF = fCF (Free Cash-Flow)', 'fCF + finCF = Δ LM (Zahlungsüberschuss)'] },
    ],
  },
  {
    title: 'Die oCF-Formel',
    icon: '📐',
    content: [
      { type: 'text', value: 'Wir starten beim Jahresüberschuss (JÜ) und korrigieren alles, was zwar den Gewinn beeinflusst hat, aber kein echtes Geld bewegt hat:' },
      {
        type: 'formulaDetailed',
        steps: [
          { code: 'JÜ', label: 'Jahresüberschuss', desc: 'Startpunkt aus der GuV', sign: '' },
          { code: '+ AfA', label: 'Abschreibungen', desc: 'Aufwand ohne Geldzahlung → addieren', sign: '+' },
          { code: '+/− RST', label: 'Rückstellungen', desc: 'Dotierung (+) oder Auflösung (−)', sign: '±' },
          { code: '+/− Abgang', label: 'Anlagenabgang', desc: 'Buchgewinn (−) / Buchverlust (+)', sign: '±' },
          { code: '+/− ΔWC', label: 'Working Capital', desc: 'Veränderung Forderungen & Verbindlichkeiten', sign: '±' },
          { code: '= oCF', label: 'Operativer CF', desc: 'Echtes Geld aus dem Geschäft', sign: '=' },
        ],
      },
    ],
  },
  {
    title: 'Nicht zahlungswirksam',
    icon: '👻',
    content: [
      { type: 'text', value: 'Manche Posten mindern den Gewinn, aber es fließt kein Geld. Deshalb rechnen wir sie im CF wieder dazu:' },
      { type: 'example', title: 'Abschreibung (AfA)', scenario: 'Du kaufst einen Ofen um 10.000 €. Die Zahlung passiert einmal beim Kauf (→ invCF). Aber die Buchhaltung verteilt den Aufwand über 5 Jahre: 2.000 € pro Jahr.', result: 'Die 2.000 € AfA pro Jahr mindern den Gewinn, aber es fließt kein Geld mehr. Also: im CF wieder addieren.' },
      { type: 'example', title: 'Rückstellungen (RST)', scenario: 'Du bildest eine Rückstellung über 5.000 € für einen möglichen Rechtsstreit. In der GuV ist das ein Aufwand.', result: 'Aber du hast noch nichts bezahlt! Das Geld liegt noch bei dir. Dotierung → addieren. Wird die Rückstellung aufgelöst → subtrahieren (Ertrag ohne Geldzufluss).' },
    ],
  },
  {
    title: 'Working Capital',
    icon: '🔄',
    content: [
      { type: 'text', value: 'Working Capital = Umlaufvermögen − kurzfristige Verbindlichkeiten. Es zeigt, wie viel Geld im laufenden Geschäft gebunden ist.' },
      {
        type: 'wcRule',
        rules: [
          { situation: 'Forderungen steigen', meaning: 'Kunden schulden dir mehr', effect: 'Geld fehlt dir', cfEffect: '−', color: 'red' },
          { situation: 'Forderungen sinken', meaning: 'Kunden haben bezahlt', effect: 'Geld kommt rein', cfEffect: '+', color: 'emerald' },
          { situation: 'Verbindlichkeiten steigen', meaning: 'Du schuldest Lieferanten mehr', effect: 'Geld bleibt bei dir', cfEffect: '+', color: 'emerald' },
          { situation: 'Verbindlichkeiten sinken', meaning: 'Du hast Lieferanten bezahlt', effect: 'Geld geht raus', cfEffect: '−', color: 'red' },
        ],
      },
      { type: 'callout', emoji: '💡', value: 'Eselsbrücke: Forderungen ↑ = schlecht (Geld fehlt). Verbindlichkeiten ↑ = gut (Geld noch da). Immer fragen: Wo ist das echte Geld?' },
    ],
  },
  {
    title: 'Der Anlagenverkauf',
    icon: '🔧',
    content: [
      { type: 'text', value: 'Das ist der trickreichste Teil! Wenn du eine Anlage verkaufst, steckt der Buchgewinn oder -verlust schon im JÜ. Aber der echte Geldfluss gehört in den invCF.' },
      { type: 'assetSale', title: 'Beispiel: Maschine verkauft', buchwert: 20000, verkauf: 25000, diff: 5000 },
      { type: 'text', value: 'Der Buchgewinn (5.000 €) steckt im JÜ → erhöht den oCF. Aber das ist kein operatives Geld! Deshalb:' },
      {
        type: 'correction',
        steps: [
          'Im oCF: Buchgewinn abziehen (−5.000) → operativer Bereich ist sauber',
          'Im invCF: Vollen Verkaufserlös zeigen (+25.000) → echter Geldfluss',
          'Netto-Effekt: −5.000 + 25.000 = +20.000 plus die 5.000 im JÜ = 25.000 ✅',
        ],
      },
      { type: 'callout', emoji: '🔁', value: 'Bei Buchverlust ist es umgekehrt: Verlust drückt JÜ runter → im oCF wieder addieren. Verkauf zum Buchwert? Dann Korrektur = 0.' },
    ],
  },
  {
    title: 'Der finanzielle Cash-Flow',
    icon: '🏦',
    content: [
      { type: 'text', value: 'Der finanzielle Cash-Flow (finCF) zeigt, wie das Unternehmen seine Finanzierung gestaltet – also Geldflüsse mit Eigenkapitalgebern und Fremdkapitalgebern.' },
      {
        type: 'stack',
        items: [
          { label: 'Einzahlungen', abbr: '+', desc: 'Kreditaufnahme, Ausgabe neuer Aktien, Kapitalerhöhung', color: 'emerald', icon: '📥' },
          { label: 'Auszahlungen', abbr: '−', desc: 'Kredittilgung, Dividendenzahlungen, Aktienrückkäufe', color: 'red', icon: '📤' },
        ],
      },
      {
        type: 'formulaDetailed',
        steps: [
          { code: '+ Kredit', label: 'Kreditaufnahme', desc: 'Frisches Geld von der Bank → Einzahlung', sign: '+' },
          { code: '− Tilgung', label: 'Kreditrückzahlung', desc: 'Schulden werden reduziert → Auszahlung', sign: '−' },
          { code: '+ EK', label: 'Kapitalerhöhung', desc: 'Neue Eigenkapitaleinlagen der Gesellschafter', sign: '+' },
          { code: '− Div.', label: 'Dividendenausschüttung', desc: 'Gewinnausschüttung an Eigentümer', sign: '−' },
          { code: '= finCF', label: 'Finanzieller CF', desc: 'Netto-Geldfluss aus Finanzierungstätigkeit', sign: '=' },
        ],
      },
      { type: 'callout', emoji: '💡', value: 'Zinszahlungen können je nach Methode im oCF oder finCF stehen – in Österreich meist im oCF. Dividenden gehören immer in den finCF!' },
    ],
  },
  {
    title: 'Gesamt: Δ LM',
    icon: '🔢',
    content: [
      { type: 'text', value: 'Jetzt fügen wir alles zusammen. Der Zahlungsüberschuss (Δ LM = Veränderung der liquiden Mittel) ist das Endergebnis der Kapitalflussrechnung.' },
      {
        type: 'formulaDetailed',
        steps: [
          { code: 'oCF', label: 'Operativer Cash-Flow', desc: 'Geld aus dem laufenden Geschäft', sign: '' },
          { code: '+ invCF', label: 'Investitions-CF', desc: 'Geld aus Investitionstätigkeit', sign: '+' },
          { code: '= fCF', label: 'Free Cash-Flow', desc: 'Operative Stärke nach Investitionen', sign: '=' },
          { code: '+ finCF', label: 'Finanzieller CF', desc: 'Geld aus Finanzierungstätigkeit', sign: '+' },
          { code: '= Δ LM', label: 'Zahlungsüberschuss', desc: 'Gesamtveränderung des Kassenbestands', sign: '=' },
        ],
      },
      { type: 'callout', emoji: '🔍', value: 'Probe: LM-Anfangsbestand + Δ LM = LM-Endbestand. Stimmt das mit der Bilanz überein? Wenn ja – die Kapitalflussrechnung ist korrekt!' },
      {
        type: 'wcRule',
        rules: [
          { situation: 'Δ LM positiv', meaning: 'Mehr Geld als Vorjahr', effect: 'Liquidität gestiegen', cfEffect: '+', color: 'emerald' },
          { situation: 'Δ LM negativ', meaning: 'Weniger Geld als Vorjahr', effect: 'Liquidität gesunken', cfEffect: '−', color: 'red' },
          { situation: 'fCF pos., Δ LM neg.', meaning: 'Kredite getilgt oder Dividenden gezahlt', effect: 'Gesunde Entschuldung möglich', cfEffect: '±', color: 'amber' },
          { situation: 'fCF neg., Δ LM pos.', meaning: 'Neue Kredite aufgenommen', effect: 'Investitionen fremdfinanziert', cfEffect: '±', color: 'purple' },
        ],
      },
    ],
  },
  {
    title: 'Bereit zum Üben!',
    icon: '🚀',
    content: [
      { type: 'text', value: 'Du kennst jetzt alle Bausteine. Hier nochmal die vollständige Kurzfassung:' },
      {
        type: 'summary',
        items: [
          'JÜ ist der Startpunkt – aber enthält nicht-zahlungswirksame Posten',
          'AfA und RST-Dotierung addieren (Aufwand ohne Geldzahlung)',
          'RST-Auflösung subtrahieren (Ertrag ohne Geldzufluss)',
          'Buchgewinn aus Anlagenverkauf abziehen, Buchverlust addieren',
          'Working Capital: Forderungen ↑ = minus, Verbindlichkeiten ↑ = plus',
          'invCF: Echte Geldflüsse aus Käufen und Verkäufen von Anlagen',
          'fCF = oCF + invCF → die echte wirtschaftliche Stärke',
          'finCF: Kredite, Tilgungen, Kapitalerhöhungen, Dividenden',
          'Δ LM = fCF + finCF → Gesamtveränderung der liquiden Mittel',
        ],
      },
      { type: 'callout', emoji: '🎯', value: 'Auf der nächsten Seite warten Übungsbeispiele – jetzt mit allen drei CFs und dem Gesamt-Zahlungsüberschuss. Achte auf die Vorzeichen!' },
    ],
  },
];

// ─── Praxis-Daten ──────────────────────────────────────────────────────

interface Scenario {
  id: number;
  difficulty: 'Einsteiger' | 'Mittel' | 'Fortgeschritten';
  diffColor: 'emerald' | 'amber' | 'red';
  title: string;
  text: string;
  fields: { label: string; hint: string; correct: number }[];
  ocf: number;
  invFields: { label: string; correct: number }[];
  invCF: number;
  fCF: number;
  finFields: { label: string; hint?: string; correct: number }[];
  finCF: number;
  deltaLM: number;
  tip: string;
}

const practiceScenarios: Scenario[] = [
  {
    id: 1, difficulty: 'Einsteiger', diffColor: 'emerald', title: 'Die Pizzeria',
    text: 'Eine Pizzeria hat einen Jahresüberschuss von 40.000 €. Die Abschreibungen auf den Pizzaofen betrugen 5.000 €. Es wurden langfristige Rückstellungen in Höhe von 2.000 € neu gebildet. Ein alter Lieferwagen (Buchwert 8.000 €) wurde um 8.000 € verkauft – also genau zum Buchwert. Die Forderungen sind um 1.000 € gesunken. Es wurde ein neuer Lieferwagen um 20.000 € gekauft. Die Pizzeria hat einen Kredit über 15.000 € aufgenommen und Dividenden von 5.000 € ausgeschüttet.',
    fields: [
      { label: 'JÜ', hint: 'Jahresüberschuss', correct: 40000 },
      { label: '+ AfA', hint: 'Nicht zahlungswirksam', correct: 5000 },
      { label: '+/− RST', hint: 'Dotierung oder Auflösung?', correct: 2000 },
      { label: '+/− Abgang', hint: 'Buchgewinn/-verlust?', correct: 0 },
      { label: '+/− Δ WC', hint: 'Forderungen ↓ = ?', correct: 1000 },
    ],
    ocf: 48000,
    invFields: [
      { label: 'Kauf Lieferwagen', correct: -20000 },
      { label: 'Verkauf Lieferwagen', correct: 8000 },
    ],
    invCF: -12000, fCF: 36000,
    finFields: [
      { label: 'Kreditaufnahme', hint: 'Neues Fremdkapital = ?', correct: 15000 },
      { label: 'Dividenden', hint: 'Ausschüttung = ?', correct: -5000 },
    ],
    finCF: 10000, deltaLM: 46000,
    tip: 'Verkauf genau zum Buchwert → kein Buchgewinn, kein Buchverlust → Korrektur = 0! finCF = Kredit − Dividenden = +10.000',
  },
  {
    id: 2, difficulty: 'Einsteiger', diffColor: 'emerald', title: 'Der Friseursalon',
    text: 'Ein Friseursalon weist einen Jahresüberschuss von 28.000 € aus. Abschreibungen auf Einrichtung: 6.000 €. Langfristige Rückstellungen wurden um 1.500 € aufgelöst. Ein alter Friseurstuhl (Buchwert 500 €) wurde um 200 € verkauft. Die Verbindlichkeiten sind um 3.000 € gestiegen. Es wurden neue Waschplätze um 12.000 € angeschafft. Ein laufender Kredit wurde um 8.000 € getilgt. Keine Dividenden.',
    fields: [
      { label: 'JÜ', hint: 'Jahresüberschuss', correct: 28000 },
      { label: '+ AfA', hint: 'Nicht zahlungswirksam', correct: 6000 },
      { label: '+/− RST', hint: 'Auflösung = ?', correct: -1500 },
      { label: '+/− Abgang', hint: 'Unter Buchwert verkauft!', correct: 300 },
      { label: '+/− Δ WC', hint: 'Verbindlichkeiten ↑ = ?', correct: 3000 },
    ],
    ocf: 35800,
    invFields: [
      { label: 'Kauf Waschplätze', correct: -12000 },
      { label: 'Verkauf Friseurstuhl', correct: 200 },
    ],
    invCF: -11800, fCF: 24000,
    finFields: [
      { label: 'Kredittilgung', hint: 'Rückzahlung = ?', correct: -8000 },
    ],
    finCF: -8000, deltaLM: 16000,
    tip: 'Buchverlust: BW 500, verkauft um 200 → Verlust 300 → addieren. Tilgung ist immer negativ im finCF.',
  },
  {
    id: 3, difficulty: 'Mittel', diffColor: 'amber', title: 'Die Autowerkstatt',
    text: 'Eine Autowerkstatt erzielt einen Jahresüberschuss von 65.000 €. Abschreibungen auf Hebebühnen und Werkzeug: 18.000 €. Rückstellungen wurden um 4.000 € dotiert. Eine Hebebühne (Buchwert 12.000 €) wurde um 17.000 € verkauft. Die Forderungen sind um 5.000 € gestiegen, die Verbindlichkeiten um 2.000 € gestiegen. Es wurde ein Diagnosegerät um 25.000 € und eine neue Hebebühne um 35.000 € gekauft. Die Bank gewährte einen neuen Investitionskredit über 30.000 €. Außerdem wurden Dividenden von 12.000 € ausgeschüttet.',
    fields: [
      { label: 'JÜ', hint: 'Jahresüberschuss', correct: 65000 },
      { label: '+ AfA', hint: 'Nicht zahlungswirksam', correct: 18000 },
      { label: '+/− RST', hint: 'Dotierung = ?', correct: 4000 },
      { label: '+/− Abgang', hint: 'Über Buchwert verkauft!', correct: -5000 },
      { label: '+/− Δ WC', hint: 'Beides bewegt sich!', correct: -3000 },
    ],
    ocf: 79000,
    invFields: [
      { label: 'Kauf Diagnosegerät', correct: -25000 },
      { label: 'Kauf Hebebühne', correct: -35000 },
      { label: 'Verkauf Hebebühne', correct: 17000 },
    ],
    invCF: -43000, fCF: 36000,
    finFields: [
      { label: 'Kreditaufnahme', hint: 'Investitionskredit = ?', correct: 30000 },
      { label: 'Dividenden', hint: 'Ausschüttung = ?', correct: -12000 },
    ],
    finCF: 18000, deltaLM: 54000,
    tip: 'WC: Forderungen ↑5k (−) + Verbindlichkeiten ↑2k (+) = −3.000. finCF: +30k Kredit − 12k Dividende = +18k.',
  },
  {
    id: 4, difficulty: 'Mittel', diffColor: 'amber', title: 'Das Architekturbüro',
    text: 'Ein Architekturbüro hat einen Jahresüberschuss von 95.000 €. Abschreibungen auf IT und Büromöbel: 11.000 €. Langfristige Rückstellungen wurden um 6.000 € aufgelöst. Ein 3D-Drucker (Buchwert 7.000 €) wurde um 3.000 € verkauft. Die Forderungen sind um 15.000 € gestiegen, die Verbindlichkeiten um 8.000 € gestiegen. Es wurde neue CAD-Software um 18.000 € lizenziert und Büromöbel um 9.000 € angeschafft. Ein neuer Gesellschafter legte 10.000 € Eigenkapital ein, und es wurde ein Kredit von 20.000 € getilgt.',
    fields: [
      { label: 'JÜ', hint: 'Jahresüberschuss', correct: 95000 },
      { label: '+ AfA', hint: 'Nicht zahlungswirksam', correct: 11000 },
      { label: '+/− RST', hint: 'Auflösung = ?', correct: -6000 },
      { label: '+/− Abgang', hint: 'Unter Buchwert verkauft!', correct: 4000 },
      { label: '+/− Δ WC', hint: 'Beides bewegt sich!', correct: -7000 },
    ],
    ocf: 97000,
    invFields: [
      { label: 'Kauf CAD-Software', correct: -18000 },
      { label: 'Kauf Büromöbel', correct: -9000 },
      { label: 'Verkauf 3D-Drucker', correct: 3000 },
    ],
    invCF: -24000, fCF: 73000,
    finFields: [
      { label: 'Kapitaleinlage', hint: 'Eigenkapital-Einzahlung = ?', correct: 10000 },
      { label: 'Kredittilgung', hint: 'Rückzahlung = ?', correct: -20000 },
    ],
    finCF: -10000, deltaLM: 63000,
    tip: 'Buchverlust: BW 7k − Verkauf 3k = 4k → addieren. WC: Ford ↑15k (−) + Verb ↑8k (+) = −7k. finCF: +10k EK − 20k Tilgung = −10k.',
  },
  {
    id: 5, difficulty: 'Fortgeschritten', diffColor: 'red', title: 'Die Brauerei',
    text: 'Eine Brauerei hat einen Jahresüberschuss von 120.000 €. Abschreibungen auf Brauanlagen und Lager: 35.000 €. Langfristige Rückstellungen wurden um 12.000 € dotiert. Ein alter Gabelstapler (Buchwert 9.000 €) wurde um 15.000 € verkauft. Außerdem wurde ein Lieferwagen (Buchwert 22.000 €) um 18.000 € verkauft. Die Forderungen sind um 10.000 € gesunken, die Verbindlichkeiten um 6.000 € gesunken. Es wurde eine neue Abfüllanlage um 200.000 € und neue Lagertanks um 50.000 € gekauft. Ein neuer Investitionskredit über 180.000 € wurde aufgenommen, und ein alter Kredit von 25.000 € wurde zurückgezahlt.',
    fields: [
      { label: 'JÜ', hint: 'Jahresüberschuss', correct: 120000 },
      { label: '+ AfA', hint: 'Nicht zahlungswirksam', correct: 35000 },
      { label: '+/− RST', hint: 'Dotierung = ?', correct: 12000 },
      { label: '+/− Abgang', hint: '2 Verkäufe! Netto?', correct: -2000 },
      { label: '+/− Δ WC', hint: 'Beides sinkt!', correct: 4000 },
    ],
    ocf: 169000,
    invFields: [
      { label: 'Kauf Abfüllanlage', correct: -200000 },
      { label: 'Kauf Lagertanks', correct: -50000 },
      { label: 'Verkauf Gabelstapler', correct: 15000 },
      { label: 'Verkauf Lieferwagen', correct: 18000 },
    ],
    invCF: -217000, fCF: -48000,
    finFields: [
      { label: 'Kreditaufnahme', hint: 'Investitionskredit = ?', correct: 180000 },
      { label: 'Kredittilgung', hint: 'Alter Kredit = ?', correct: -25000 },
    ],
    finCF: 155000, deltaLM: 107000,
    tip: 'Gabelstapler: +6k Buchgewinn. Lieferwagen: −4k Buchverlust. Netto: +2k → −2k Korrektur. WC: Ford ↓10k (+) + Verb ↓6k (−) = +4k. finCF: +180k − 25k = +155k.',
  },
];

// ─── Color-Palette-Helfer ─────────────────────────────────────────────

const colorPalette: Record<ColorKey, { text: string; bg: string; border: string; bgSoft: string }> = {
  cyan:    { text: 'text-cyan-400',    bg: 'bg-cyan-500',    border: 'border-cyan-500/30',    bgSoft: 'bg-cyan-500/10' },
  amber:   { text: 'text-amber-400',   bg: 'bg-amber-500',   border: 'border-amber-500/30',   bgSoft: 'bg-amber-500/10' },
  emerald: { text: 'text-emerald-400', bg: 'bg-emerald-500', border: 'border-emerald-500/30', bgSoft: 'bg-emerald-500/10' },
  red:     { text: 'text-red-400',     bg: 'bg-red-500',     border: 'border-red-500/30',     bgSoft: 'bg-red-500/10' },
  purple:  { text: 'text-purple-400',  bg: 'bg-purple-500',  border: 'border-purple-500/30',  bgSoft: 'bg-purple-500/10' },
  indigo:  { text: 'text-indigo-400',  bg: 'bg-indigo-500',  border: 'border-indigo-500/30',  bgSoft: 'bg-indigo-500/10' },
};

const fmtSigned = (n: number): string => (n > 0 ? '+' : '') + n.toLocaleString('de-DE');

// ─── ContentBlock Renderer ────────────────────────────────────────────

function Block({ block }: { block: ContentBlock }) {
  if (block.type === 'text') {
    return <p className="text-sm leading-relaxed text-[#d1d5db] mb-4">{block.value}</p>;
  }

  if (block.type === 'callout') {
    return (
      <div className="px-4 py-3.5 rounded-xl bg-indigo-500/10 border border-indigo-500/30 mb-4 flex gap-2.5 items-start">
        <span className="text-lg shrink-0">{block.emoji}</span>
        <p className="m-0 text-sm leading-relaxed text-[#d1d5db]">{block.value}</p>
      </div>
    );
  }

  if (block.type === 'comparison') {
    return (
      <div className="flex flex-col gap-2 mb-4">
        {block.items.map((item, i) => {
          const c = colorPalette[item.color];
          return (
            <div key={i} className={`px-3.5 py-3 rounded-lg ${c.bgSoft}`} style={{ borderLeft: `3px solid currentColor` }}>
              <div className={`flex items-center gap-2 mb-1 ${c.text}`}>
                <span className="text-base">{item.icon}</span>
                <span className="text-sm font-bold">{item.label}</span>
              </div>
              <span className="text-xs text-[#9ca3af]">{item.desc}</span>
            </div>
          );
        })}
      </div>
    );
  }

  if (block.type === 'stack') {
    return (
      <div className="flex flex-col gap-2 mb-4">
        {block.items.map((item, i) => {
          const c = colorPalette[item.color];
          return (
            <Card key={i}>
              <div className="flex items-center gap-2.5 mb-1.5">
                <span className="text-lg">{item.icon}</span>
                <div>
                  <span className={`text-sm font-bold ${c.text}`}>{item.label}</span>
                  <span className="text-xs text-[#6b7280] font-mono ml-2">{item.abbr}</span>
                </div>
              </div>
              <p className="m-0 text-xs text-[#9ca3af] leading-relaxed">{item.desc}</p>
            </Card>
          );
        })}
      </div>
    );
  }

  if (block.type === 'formula') {
    return (
      <div className="px-4 py-3.5 rounded-xl bg-purple-500/10 border border-purple-500/30 mb-4 text-center">
        {block.lines.map((line, i) => (
          <div key={i} className="text-base font-bold text-purple-300 font-mono py-1">{line}</div>
        ))}
      </div>
    );
  }

  if (block.type === 'formulaDetailed') {
    return (
      <div className="flex flex-col gap-1.5 mb-4">
        {block.steps.map((step, i) => {
          const isResult = step.sign === '=';
          return (
            <div
              key={i}
              className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg border ${
                isResult ? 'bg-cyan-500/10 border-cyan-500/30' : 'bg-[#1e2130] border-[#2d3148]'
              }`}
            >
              <span className={`text-sm font-bold font-mono min-w-[5rem] ${isResult ? 'text-cyan-400' : 'text-indigo-400'}`}>
                {step.code}
              </span>
              <div className="flex-1">
                <div className="text-sm font-semibold text-white">{step.label}</div>
                <div className="text-[11px] text-[#9ca3af]">{step.desc}</div>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  if (block.type === 'example') {
    return (
      <Card className="mb-3">
        <div className="text-sm font-bold text-indigo-400 mb-2">{block.title}</div>
        <p className="text-xs text-[#9ca3af] leading-relaxed m-0 mb-2">{block.scenario}</p>
        <div className="px-3 py-2.5 rounded-lg bg-emerald-500/10" style={{ borderLeft: '3px solid currentColor' }}>
          <p className="m-0 text-xs text-emerald-300 leading-relaxed font-semibold">→ {block.result}</p>
        </div>
      </Card>
    );
  }

  if (block.type === 'wcRule') {
    return (
      <div className="flex flex-col gap-1.5 mb-4">
        {block.rules.map((rule, i) => {
          const c = colorPalette[rule.color];
          return (
            <div key={i} className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg ${c.bgSoft} border ${c.border}`}>
              <span className={`text-lg font-extrabold ${c.text} font-mono min-w-[1.5rem] text-center`}>
                {rule.cfEffect}
              </span>
              <div className="flex-1">
                <div className="text-sm font-bold text-white">{rule.situation}</div>
                <div className="text-[11px] text-[#9ca3af]">{rule.meaning} → {rule.effect}</div>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  if (block.type === 'assetSale') {
    return (
      <Card className="mb-3">
        <div className="text-sm font-bold text-amber-400 mb-3">{block.title}</div>
        <div className="flex justify-around mb-2">
          <div className="text-center">
            <div className="text-[11px] text-[#9ca3af]">Buchwert</div>
            <div className="text-lg font-bold text-[#9ca3af] font-mono">{block.buchwert.toLocaleString('de-DE')} €</div>
          </div>
          <div className="text-xl text-[#6b7280] self-center">→</div>
          <div className="text-center">
            <div className="text-[11px] text-[#9ca3af]">Verkauf</div>
            <div className="text-lg font-bold text-emerald-400 font-mono">{block.verkauf.toLocaleString('de-DE')} €</div>
          </div>
          <div className="text-xl text-[#6b7280] self-center">=</div>
          <div className="text-center">
            <div className="text-[11px] text-[#9ca3af]">Buchgewinn</div>
            <div className="text-lg font-bold text-amber-400 font-mono">+{block.diff.toLocaleString('de-DE')} €</div>
          </div>
        </div>
      </Card>
    );
  }

  if (block.type === 'correction') {
    return (
      <div className="flex flex-col gap-1.5 mb-4">
        {block.steps.map((step, i) => (
          <div key={i} className="flex gap-2.5 items-start px-3.5 py-2.5 rounded-lg bg-[#1e2130] border border-[#2d3148]">
            <span className="w-6 h-6 rounded-full bg-indigo-500/15 text-indigo-400 flex items-center justify-center text-xs font-bold font-mono shrink-0 mt-0.5">
              {i + 1}
            </span>
            <span className="text-sm text-[#d1d5db] leading-relaxed">{step}</span>
          </div>
        ))}
      </div>
    );
  }

  if (block.type === 'summary') {
    return (
      <div className="flex flex-col gap-1 mb-4">
        {block.items.map((item, i) => (
          <div key={i} className={`flex gap-2.5 items-start px-3 py-2 rounded-lg ${i % 2 === 0 ? 'bg-[#1e2130]' : ''}`}>
            <span className="text-emerald-400 text-sm shrink-0">✓</span>
            <span className="text-sm text-[#d1d5db] leading-relaxed">{item}</span>
          </div>
        ))}
      </div>
    );
  }

  return null;
}

// ─── Praxis-Inputs ────────────────────────────────────────────────────

function PracticeInput({
  field, value, onChange, checked, showHint,
}: {
  field: { label: string; hint: string; correct: number };
  value: string;
  onChange: (v: string) => void;
  checked: boolean;
  showHint: boolean;
}) {
  const val = parseInt(value);
  const isCorrect = checked && val === field.correct;
  const isWrong = checked && value !== '' && val !== field.correct;

  return (
    <div
      className={`flex flex-col gap-1 px-3.5 py-2.5 rounded-lg border transition-colors ${
        checked
          ? isCorrect
            ? 'bg-emerald-500/10 border-emerald-500/40'
            : 'bg-red-500/10 border-red-500/40'
          : 'bg-[#1e2130] border-[#2d3148]'
      }`}
    >
      <div className="flex justify-between items-center">
        <span className="text-xs font-semibold text-[#9ca3af] font-mono">{field.label}</span>
        {showHint && <span className="text-[10px] text-[#6b7280] italic">{field.hint}</span>}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={checked}
          placeholder="z.B. -5000"
          className="flex-1 px-3 py-2 rounded-lg border border-[#3d4168] bg-[#252840] disabled:bg-transparent text-white text-lg font-mono font-semibold outline-none focus:border-indigo-500 placeholder:text-[#4b5563]"
        />
        {checked && <span className="text-lg shrink-0">{isCorrect ? '✅' : '❌'}</span>}
      </div>
      {(isWrong || (checked && value === '')) && (
        <div className="text-xs text-red-400 font-mono">
          Richtig: {fmtSigned(field.correct)} €
        </div>
      )}
    </div>
  );
}

function PracticeSum({
  label, value, checked, correct, color,
}: {
  label: string;
  value: number | '';
  checked: boolean;
  correct: number;
  color: ColorKey;
}) {
  const isCorrect = checked && value === correct;
  const isWrong = checked && value !== '' && value !== correct;
  const c = colorPalette[color];

  return (
    <div className={`px-3.5 py-3 rounded-lg ${c.bgSoft} border ${c.border}`}>
      <span className={`text-[11px] font-bold uppercase tracking-wider ${c.text}`}>{label}</span>
      <div className="flex items-center gap-2 mt-1">
        <span className={`flex-1 text-lg font-bold font-mono ${c.text}`}>
          {value !== '' ? fmtSigned(value as number) + ' €' : '–'}
        </span>
        {checked && <span className="text-lg">{isCorrect ? '✅' : '❌'}</span>}
      </div>
      {(isWrong || (checked && value === '')) && (
        <div className="text-xs text-red-400 font-mono mt-1">
          Richtig: {fmtSigned(correct)} €
        </div>
      )}
    </div>
  );
}

// ─── Theorie-Ansicht ──────────────────────────────────────────────────

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
  return (
    <div>
      <div className="flex items-center gap-3 mb-5">
        <span className="text-3xl">{page.icon}</span>
        <h2 className="m-0 text-xl font-extrabold text-white leading-tight">{page.title}</h2>
      </div>

      {page.content.map((block, i) => <Block key={i} block={block} />)}

      <div className="flex gap-2.5 mt-7">
        {pageIndex > 0 && (
          <button
            type="button"
            onClick={onPrev}
            className="flex-1 py-3 rounded-xl border border-indigo-500/30 bg-transparent text-indigo-400 text-sm font-bold hover:bg-indigo-500/10 transition-colors"
          >
            ← Zurück
          </button>
        )}
        {pageIndex < totalPages - 1 ? (
          <button
            type="button"
            onClick={onNext}
            className="flex-[2] py-3 rounded-xl border-none bg-gradient-to-br from-indigo-500 to-purple-500 hover:from-indigo-400 hover:to-purple-400 text-white text-sm font-bold transition-colors"
          >
            Weiter →
          </button>
        ) : (
          <button
            type="button"
            onClick={onStartPractice}
            className="flex-[2] py-3 rounded-xl border-none bg-gradient-to-br from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-[#0c1220] text-sm font-extrabold transition-colors"
          >
            Jetzt üben! 💪
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Praxis-Ansicht ───────────────────────────────────────────────────

function PracticeView({
  scenario, scenarioIndex, totalScenarios, onNext, onBackToTheory,
}: {
  scenario: Scenario;
  scenarioIndex: number;
  totalScenarios: number;
  onNext: () => void;
  onBackToTheory: () => void;
}) {
  const [ocfVals, setOcfVals] = useState<string[]>(() => Array(scenario.fields.length).fill(''));
  const [invVals, setInvVals] = useState<string[]>(() => Array(scenario.invFields.length).fill(''));
  const [finVals, setFinVals] = useState<string[]>(() => Array(scenario.finFields.length).fill(''));
  const [fCFVal, setFCFVal] = useState('');
  const [deltaLMVal, setDeltaLMVal] = useState('');
  const [checked, setChecked] = useState(false);
  const [score, setScore] = useState<{ correct: number; total: number } | null>(null);
  const [showHints, setShowHints] = useState(true);

  const calcSum = (vals: string[], len: number): number | '' => {
    const v = vals.slice(0, len);
    if (v.some(x => x === '')) return '';
    return v.reduce((s, x) => s + parseInt(x), 0);
  };

  const ocfSum = calcSum(ocfVals, scenario.fields.length);
  const invSum = calcSum(invVals, scenario.invFields.length);
  const finSum = calcSum(finVals, scenario.finFields.length);

  const allFilled = () =>
    scenario.fields.every((_, i) => ocfVals[i] !== '') &&
    scenario.invFields.every((_, i) => invVals[i] !== '') &&
    scenario.finFields.every((_, i) => finVals[i] !== '') &&
    fCFVal !== '' && deltaLMVal !== '';

  const handleCheck = () => {
    let c = 0;
    const t = scenario.fields.length + scenario.invFields.length + scenario.finFields.length + 5;
    scenario.fields.forEach((f, i) => { if (parseInt(ocfVals[i]) === f.correct) c++; });
    if (ocfSum === scenario.ocf) c++;
    scenario.invFields.forEach((f, i) => { if (parseInt(invVals[i]) === f.correct) c++; });
    if (invSum === scenario.invCF) c++;
    if (parseInt(fCFVal) === scenario.fCF) c++;
    scenario.finFields.forEach((f, i) => { if (parseInt(finVals[i]) === f.correct) c++; });
    if (finSum === scenario.finCF) c++;
    if (parseInt(deltaLMVal) === scenario.deltaLM) c++;
    setScore({ correct: c, total: t });
    setChecked(true);
  };

  const handleNext = () => {
    setOcfVals(Array(scenario.fields.length).fill(''));
    setInvVals(Array(scenario.invFields.length).fill(''));
    setFinVals(Array(scenario.finFields.length).fill(''));
    setFCFVal('');
    setDeltaLMVal('');
    setChecked(false);
    setScore(null);
    onNext();
  };

  const diffC = colorPalette[scenario.diffColor];
  const fCFCorrect = checked && parseInt(fCFVal) === scenario.fCF;
  const deltaLMCorrect = checked && parseInt(deltaLMVal) === scenario.deltaLM;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <span className={`text-[11px] font-bold ${diffC.text} px-2.5 py-1 rounded-full ${diffC.bgSoft} uppercase tracking-wider`}>
          {scenario.difficulty}
        </span>
        <span className="text-xs text-[#9ca3af] font-mono">{scenarioIndex + 1}/{totalScenarios}</span>
      </div>

      {/* Scenario text */}
      <Card className="mb-4">
        <div className="text-base font-bold text-white mb-2.5">📋 {scenario.title}</div>
        <p className="text-sm leading-relaxed text-[#d1d5db] m-0">{scenario.text}</p>
      </Card>

      {/* Hints toggle */}
      <div
        onClick={() => setShowHints(!showHints)}
        className="flex items-center justify-end gap-1.5 mb-3 cursor-pointer text-xs text-[#9ca3af] select-none"
      >
        <span>{showHints ? 'Hinweise aus' : 'Hinweise ein'}</span>
        <div className={`w-8 h-4 rounded-full relative transition-colors ${showHints ? 'bg-indigo-500' : 'bg-[#252840]'}`}>
          <div
            className="w-3 h-3 rounded-full bg-white absolute top-0.5 transition-all"
            style={{ left: showHints ? '1rem' : '0.125rem' }}
          />
        </div>
      </div>

      {/* oCF */}
      <div className="mb-4">
        <div className="text-[11px] font-bold text-cyan-400 uppercase tracking-widest mb-2 pl-0.5">
          ⚙️ Operativer Cash-Flow
        </div>
        <div className="flex flex-col gap-2">
          {scenario.fields.map((f, i) => (
            <PracticeInput
              key={i}
              field={f}
              value={ocfVals[i]}
              onChange={(v) => { const n = [...ocfVals]; n[i] = v; setOcfVals(n); }}
              checked={checked}
              showHint={showHints}
            />
          ))}
          <PracticeSum label="= oCF" value={ocfSum} checked={checked} correct={scenario.ocf} color="cyan" />
        </div>
      </div>

      {/* invCF */}
      <div className="mb-4">
        <div className="text-[11px] font-bold text-amber-400 uppercase tracking-widest mb-2 pl-0.5">
          🏗️ Investitions-Cash-Flow
        </div>
        <div className="flex flex-col gap-2">
          {scenario.invFields.map((f, i) => (
            <PracticeInput
              key={i}
              field={{ label: f.label, correct: f.correct, hint: '' }}
              value={invVals[i]}
              onChange={(v) => { const n = [...invVals]; n[i] = v; setInvVals(n); }}
              checked={checked}
              showHint={false}
            />
          ))}
          <PracticeSum label="= invCF" value={invSum} checked={checked} correct={scenario.invCF} color="amber" />
        </div>
      </div>

      {/* fCF */}
      <div className="mb-4">
        <div className="text-[11px] font-bold text-emerald-400 uppercase tracking-widest mb-2 pl-0.5">
          🎯 Free Cash-Flow
        </div>
        <div className="px-3.5 py-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
          <span className="text-[11px] font-bold text-emerald-400">= fCF (oCF + invCF)</span>
          <div className="flex items-center gap-2 mt-1.5">
            <input
              type="number"
              inputMode="numeric"
              value={fCFVal}
              onChange={(e) => setFCFVal(e.target.value)}
              disabled={checked}
              placeholder="Ergebnis"
              className="flex-1 px-3 py-2 rounded-lg border-none bg-[#252840] disabled:bg-transparent text-emerald-400 text-xl font-mono font-bold outline-none placeholder:text-[#4b5563]"
            />
            {checked && <span className="text-lg">{fCFCorrect ? '✅' : '❌'}</span>}
          </div>
          {checked && !fCFCorrect && (
            <div className="text-xs text-red-400 font-mono mt-1">
              Richtig: {fmtSigned(scenario.fCF)} €
            </div>
          )}
        </div>
      </div>

      {/* finCF */}
      <div className="mb-4">
        <div className="text-[11px] font-bold text-purple-400 uppercase tracking-widest mb-2 pl-0.5">
          🏦 Finanzieller Cash-Flow
        </div>
        <div className="flex flex-col gap-2">
          {scenario.finFields.map((f, i) => (
            <PracticeInput
              key={i}
              field={{ label: f.label, correct: f.correct, hint: f.hint || '' }}
              value={finVals[i]}
              onChange={(v) => { const n = [...finVals]; n[i] = v; setFinVals(n); }}
              checked={checked}
              showHint={showHints}
            />
          ))}
          <PracticeSum label="= finCF" value={finSum} checked={checked} correct={scenario.finCF} color="purple" />
        </div>
      </div>

      {/* Δ LM */}
      <div className="mb-5">
        <div className="text-[11px] font-bold text-indigo-400 uppercase tracking-widest mb-2 pl-0.5">
          📊 Δ LM (Zahlungsüberschuss)
        </div>
        <div className="px-3.5 py-3 rounded-lg bg-indigo-500/10 border border-indigo-500/30">
          <span className="text-[11px] font-bold text-indigo-400">= Δ LM (fCF + finCF)</span>
          <div className="flex items-center gap-2 mt-1.5">
            <input
              type="number"
              inputMode="numeric"
              value={deltaLMVal}
              onChange={(e) => setDeltaLMVal(e.target.value)}
              disabled={checked}
              placeholder="Ergebnis"
              className="flex-1 px-3 py-2 rounded-lg border-none bg-[#252840] disabled:bg-transparent text-indigo-400 text-xl font-mono font-bold outline-none placeholder:text-[#4b5563]"
            />
            {checked && <span className="text-lg">{deltaLMCorrect ? '✅' : '❌'}</span>}
          </div>
          {checked && !deltaLMCorrect && (
            <div className="text-xs text-red-400 font-mono mt-1">
              Richtig: {fmtSigned(scenario.deltaLM)} €
            </div>
          )}
        </div>
      </div>

      {/* Tip */}
      {checked && scenario.tip && (
        <div className="px-4 py-3.5 rounded-xl bg-indigo-500/10 border border-indigo-500/30 mb-4">
          <span className="text-[11px] font-bold text-indigo-400">💡 TIPP</span>
          <p className="m-0 mt-1.5 text-sm leading-relaxed text-[#d1d5db]">{scenario.tip}</p>
        </div>
      )}

      {/* Score */}
      {score && (
        <div
          className={`text-center px-4 py-4 mb-4 rounded-xl border ${
            score.correct === score.total
              ? 'bg-emerald-500/10 border-emerald-500/30'
              : score.correct >= score.total * 0.7
                ? 'bg-amber-500/10 border-amber-500/30'
                : 'bg-red-500/10 border-red-500/30'
          }`}
        >
          <div className="text-3xl mb-1">
            {score.correct === score.total ? '🏆' : score.correct >= score.total * 0.7 ? '👍' : '💪'}
          </div>
          <div className="text-xl font-bold font-mono text-white">
            {score.correct}/{score.total}
          </div>
          <div className="text-sm text-[#9ca3af] mt-1">
            {score.correct === score.total ? 'Perfekt!' : score.correct >= score.total * 0.7 ? 'Gut gemacht!' : 'Weiter üben!'}
          </div>
        </div>
      )}

      {/* Buttons */}
      <div className="flex gap-2.5 mb-3">
        {!checked ? (
          <button
            type="button"
            onClick={handleCheck}
            disabled={!allFilled()}
            className={`flex-1 py-3.5 rounded-xl border-none text-base font-bold transition-colors ${
              allFilled()
                ? 'bg-gradient-to-br from-indigo-500 to-purple-500 hover:from-indigo-400 hover:to-purple-400 text-white'
                : 'bg-[#252840] text-[#6b7280] cursor-not-allowed'
            }`}
          >
            Überprüfen
          </button>
        ) : (
          <button
            type="button"
            onClick={handleNext}
            className="flex-1 py-3.5 rounded-xl border-none bg-gradient-to-br from-indigo-500 to-purple-500 hover:from-indigo-400 hover:to-purple-400 text-white text-base font-bold transition-colors"
          >
            {scenarioIndex < totalScenarios - 1 ? 'Nächstes Beispiel →' : 'Fertig! 🎉'}
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={onBackToTheory}
        className="w-full py-2.5 rounded-lg border border-indigo-500/30 bg-transparent text-[#9ca3af] text-xs hover:text-white transition-colors"
      >
        📖 Zurück zur Theorie
      </button>
    </div>
  );
}

// ─── Hauptkomponente ──────────────────────────────────────────────────

export default function CashFlowKurs({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<'theory' | 'practice'>('theory');
  const [theoryPage, setTheoryPage] = useState(0);
  const [practiceIdx, setPracticeIdx] = useState(0);

  const totalSteps = mode === 'theory' ? theoryPages.length : practiceScenarios.length;
  const currentStep = mode === 'theory' ? theoryPage : practiceIdx;

  return (
    <ExerciseShell
      title="Cash-Flow Kurs"
      subtitle="Kapitalflussrechnung – Praktiker-Ansatz"
      onClose={onClose}
    >
      {/* Schmaler innerer Container, weil das Layout mobile-first ist. */}
      <div className="max-w-md mx-auto">
        {/* Mode toggle */}
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-[#2d3148]">
          <div>
            <div className="text-[10px] font-extrabold text-indigo-400 uppercase tracking-[0.2em]">
              Cash-Flow Kurs
            </div>
            <div className="text-[11px] text-[#6b7280] mt-0.5">
              {mode === 'theory' ? `Lektion ${theoryPage + 1}/${theoryPages.length}` : `Übung ${practiceIdx + 1}/${practiceScenarios.length}`}
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

        {/* Progress dots */}
        <div className="flex gap-1 mb-5">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div
              key={i}
              className={`flex-1 h-0.5 rounded-full transition-colors ${
                i === currentStep
                  ? 'bg-indigo-500'
                  : i < currentStep
                    ? 'bg-emerald-500/40'
                    : 'bg-[#252840]'
              }`}
            />
          ))}
        </div>

        {mode === 'theory' ? (
          <TheoryView
            page={theoryPages[theoryPage]}
            pageIndex={theoryPage}
            totalPages={theoryPages.length}
            onNext={() => setTheoryPage(p => Math.min(p + 1, theoryPages.length - 1))}
            onPrev={() => setTheoryPage(p => Math.max(p - 1, 0))}
            onStartPractice={() => { setMode('practice'); setPracticeIdx(0); }}
          />
        ) : (
          <PracticeView
            key={practiceIdx}
            scenario={practiceScenarios[practiceIdx]}
            scenarioIndex={practiceIdx}
            totalScenarios={practiceScenarios.length}
            onNext={() => setPracticeIdx(i => (i + 1) % practiceScenarios.length)}
            onBackToTheory={() => setMode('theory')}
          />
        )}

        <div className="text-center text-[10px] text-[#6b7280] mt-5 pb-4">
          FH Wien · Kapitalflussrechnung · Praktiker-Ansatz
        </div>
      </div>
    </ExerciseShell>
  );
}
