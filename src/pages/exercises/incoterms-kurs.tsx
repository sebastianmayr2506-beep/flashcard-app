import { useState, useMemo, useCallback } from 'react';
import { ExerciseShell, Card } from './_shared';
import type { ExerciseProps } from './index';

// ─────────────────────────────────────────────────────────────────────────
// TYPEN
// ─────────────────────────────────────────────────────────────────────────

type GroupKey = 'E' | 'F' | 'C' | 'D';

interface GroupInfo {
  name: string;
  color: string;
  desc: string;
  rule: string;
}

interface Incoterm {
  code: string;
  name: string;
  de: string;
  group: GroupKey;
  allTransport: boolean;
  risikoStage: number;
  kostenStage: number;
  exportzoll: string;
  importzoll: string;
  versicherung: string;
  merksatz: string;
  fallstrick: string;
  risikoText: string;
  kostenText: string;
  versicherungText: string;
  zollText: string;
  beispiel: string;
  matchText: string;
}

interface ComparisonPair {
  a: string;
  b: string;
  question: string;
  answer: string;
  explain: string;
}

// ─────────────────────────────────────────────────────────────────────────
// DATEN
// ─────────────────────────────────────────────────────────────────────────

const STAGES = [
  'Werk Verkäufer',
  'Abholung/LKW',
  'Exportabfertigung',
  'Verladung (an Bord)',
  'Haupttransport',
  'Entladehafen',
  'Importabfertigung',
  'Zustellung/LKW',
  'Werk Käufer',
];

const GROUPS: Record<GroupKey, GroupInfo> = {
  E: {
    name: 'E – Abholklausel',
    color: '#8b8d98',
    desc: 'Verkäufer stellt nur bereit, Käufer organisiert alles.',
    rule: 'Grundregel: Der Verkäufer stellt die Ware nur bereit, ab da macht der Käufer alles selbst — Verladen, Transport, Export, Import. Risiko und Kosten gehen sofort am Werk des Verkäufers über, beide am selben Punkt.',
  },
  F: {
    name: 'F – Haupttransport unbezahlt',
    color: '#4d8eff',
    desc: 'Verkäufer übergibt an Frachtführer, Käufer zahlt Haupttransport.',
    rule: 'Grundregel: Der Verkäufer liefert frei bis zu einem bestimmten Übergabepunkt. Ab genau diesem Punkt trägt der Käufer Risiko UND Kosten gemeinsam — bei F gehen beide immer am selben Punkt über, nie getrennt.',
  },
  C: {
    name: 'C – Haupttransport bezahlt',
    color: '#f5a623',
    desc: 'Verkäufer zahlt Haupttransport, Risiko geht aber schon früher über.',
    rule: 'Grundregel: Der Verkäufer zahlt die Fracht bis zum Bestimmungsort weiter — ABER das Risiko geht trotzdem schon früh über, wie bei F. Das ist die einzige Gruppe, in der Risiko und Kosten auseinanderfallen.',
  },
  D: {
    name: 'D – Ankunftsklausel',
    color: '#3ecf8e',
    desc: 'Verkäufer trägt Risiko & Kosten bis zum Bestimmungsort.',
    rule: 'Grundregel: Der Verkäufer liefert wirklich an. Risiko UND Kosten bleiben bis fast zum Schluss beim Verkäufer und gehen erst am Bestimmungsort beim Käufer über — beide gemeinsam, ganz spät.',
  },
};

const INCOTERMS: Incoterm[] = [
  {
    code: 'EXW', name: 'Ex Works', de: 'Ab Werk', group: 'E', allTransport: true,
    risikoStage: 0, kostenStage: 0, exportzoll: 'Käufer', importzoll: 'Käufer', versicherung: 'keine Pflicht',
    merksatz: 'Verkäufer stellt die Ware nur bereit – ab da macht der Käufer alles: Verladen, Transport, Export, Import.',
    fallstrick: 'Verkäufer muss die Ware nicht einmal verladen oder verzollen – maximale Käuferpflicht.',
    risikoText: 'Das Risiko geht über, sobald die Ware am Werksgelände des Verkäufers bereitgestellt ist – noch bevor sie überhaupt verladen wird. Holt der LKW des Käufers die Ware ab und beschädigt sie beim Verladen, trägt das schon der Käufer.',
    kostenText: 'Der Käufer zahlt buchstäblich alles ab dem Werkstor: Verladung, Inlandstransport, Export-Zollabwicklung, Haupttransport, Import-Zollabwicklung, Zustellung.',
    versicherungText: 'Keine Partei ist verpflichtet, eine Transportversicherung abzuschließen – wer sich absichern will, muss das selbst organisieren.',
    zollText: 'Der Käufer erledigt sowohl die Export- als auch die Importabfertigung. Der Verkäufer kümmert sich um nichts davon.',
    beispiel: 'Ein steirischer Maschinenbauer verkauft eine Fräsmaschine EXW Graz an einen Kunden in Polen. Der Kunde schickt seinen eigenen Spediteur, der die Maschine im Werk abholt, selbst verlädt, durch den österreichischen Zoll bringt und nach Polen transportiert. Geht beim Verladen im Werk etwas kaputt, ist das schon der Schaden des Käufers – obwohl die Ware das Werksgelände noch nicht verlassen hat.',
    matchText: 'Risiko und Kosten gehen schon am Werksgelände über – der Käufer organisiert und zahlt ab Werkstor alles selbst.',
  },
  {
    code: 'FCA', name: 'Free Carrier', de: 'Frei Frachtführer', group: 'F', allTransport: true,
    risikoStage: 1, kostenStage: 1, exportzoll: 'Verkäufer', importzoll: 'Käufer', versicherung: 'keine Pflicht',
    merksatz: 'Verkäufer übergibt die Ware verzollt an den vom Käufer benannten Frachtführer.',
    fallstrick: 'Im Gegensatz zu EXW übernimmt der Verkäufer die Exportabfertigung.',
    risikoText: 'Das Risiko geht über, sobald der Verkäufer die Ware dem vom Käufer benannten Frachtführer übergeben hat – das kann am Werksgelände des Verkäufers oder an einem anderen vereinbarten Ort sein.',
    kostenText: 'Der Verkäufer zahlt Verladung und Übergabe an den Frachtführer sowie die Exportabfertigung. Ab Übergabe zahlt der Käufer den gesamten Haupttransport.',
    versicherungText: 'Keine Partei ist verpflichtet, eine Transportversicherung abzuschließen.',
    zollText: 'Der Verkäufer übernimmt die Exportabfertigung – das ist der entscheidende Unterschied zu EXW. Die Importabfertigung bleibt beim Käufer.',
    beispiel: 'Ein Wiener Elektronikhändler verkauft FCA Wien-Lager an einen deutschen Großhändler. Der Verkäufer verzollt die Ware für den Export und übergibt sie an den vom Käufer beauftragten Spediteur direkt am Lager. Ab diesem Moment trägt der Käufer Risiko und Kosten des Transports nach Deutschland.',
    matchText: 'Risiko und Kosten gehen gemeinsam über, sobald Verkäufer die verzollte Ware an den vom Käufer benannten Frachtführer übergibt.',
  },
  {
    code: 'CPT', name: 'Carriage Paid To', de: 'Frachtfrei', group: 'C', allTransport: true,
    risikoStage: 1, kostenStage: 5, exportzoll: 'Verkäufer', importzoll: 'Käufer', versicherung: 'keine Pflicht',
    merksatz: 'Verkäufer zahlt den Haupttransport bis zum Zielort, das Risiko geht aber schon bei Übergabe an den ersten Frachtführer über.',
    fallstrick: 'Kosten- und Risikoübergang fallen auseinander! Käufer trägt das Transportrisiko, obwohl Verkäufer die Fracht zahlt.',
    risikoText: 'Das Risiko geht schon bei Übergabe an den ERSTEN Frachtführer auf den Käufer über – also relativ früh in der Lieferkette, meist noch im Land des Verkäufers.',
    kostenText: 'Der Verkäufer zahlt dagegen die Fracht bis zum vereinbarten Bestimmungsort weiter. Genau hier liegt die Besonderheit: Verkäufer zahlt länger, als er das Risiko trägt.',
    versicherungText: 'Keine Partei ist verpflichtet, eine Transportversicherung abzuschließen – das unterscheidet CPT von CIP.',
    zollText: 'Der Verkäufer übernimmt die Exportabfertigung, der Käufer die Importabfertigung.',
    beispiel: 'Eine Tiroler Möbelmanufaktur verkauft CPT Hamburg an einen Käufer dort. Der Verkäufer organisiert und zahlt den LKW-Transport bis Hamburg. Wird der LKW aber schon kurz nach der Abfahrt in Tirol in einen Unfall verwickelt, trägt trotzdem der Käufer den Schaden – das Risiko war ja schon bei Übergabe an den Frachtführer übergegangen, obwohl der Verkäufer die Fracht weiterzahlt.',
    matchText: 'Risiko geht schon bei Übergabe an den ersten Frachtführer über, Verkäufer zahlt die Fracht aber bis zum Bestimmungsort weiter – ohne Versicherungspflicht.',
  },
  {
    code: 'CIP', name: 'Carriage and Insurance Paid To', de: 'Frachtfrei versichert', group: 'C', allTransport: true,
    risikoStage: 1, kostenStage: 5, exportzoll: 'Verkäufer', importzoll: 'Käufer', versicherung: 'Verkäufer – Maximaldeckung (Institute Cargo Clauses A)',
    merksatz: 'Wie CPT, aber Verkäufer muss zusätzlich eine umfassende Transportversicherung abschließen.',
    fallstrick: 'CIP verlangt Maximaldeckung (Klausel A), CIF nur Minimaldeckung (Klausel C) – häufige Verwechslung!',
    risikoText: 'Genau wie bei CPT: Das Risiko geht schon bei Übergabe an den ersten Frachtführer auf den Käufer über.',
    kostenText: 'Genau wie bei CPT: Der Verkäufer zahlt die Fracht bis zum vereinbarten Bestimmungsort.',
    versicherungText: 'Zusätzlich zu CPT muss der Verkäufer eine Transportversicherung mit Maximaldeckung (Institute Cargo Clauses A) abschließen – das ist der höchste Versicherungsschutz, den die Incoterms kennen. Der Käufer ist also auch nach Risikoübergang noch versichert, falls auf dem Transport etwas passiert.',
    zollText: 'Der Verkäufer übernimmt die Exportabfertigung, der Käufer die Importabfertigung.',
    beispiel: 'Ein Linzer Stahlhändler verkauft CIP Mailand an einen italienischen Kunden, multimodal per LKW und Bahn. Der Verkäufer zahlt den Transport bis Mailand UND schließt eine Vollkasko-ähnliche Transportversicherung (Klausel A) ab. Geht die Ware unterwegs verloren, ist sie über diese Versicherung abgedeckt – obwohl das Risiko formal schon beim Käufer liegt.',
    matchText: 'Risiko geht schon bei Übergabe an den ersten Frachtführer über, Verkäufer zahlt Fracht bis Bestimmungsort UND versichert maximal (Klausel A).',
  },
  {
    code: 'DAP', name: 'Delivered At Place', de: 'Geliefert benannter Ort', group: 'D', allTransport: true,
    risikoStage: 7, kostenStage: 7, exportzoll: 'Verkäufer', importzoll: 'Käufer', versicherung: 'keine Pflicht',
    merksatz: 'Verkäufer trägt Risiko & Kosten bis zum benannten Ort, liefert aber unentladen (transportbereit).',
    fallstrick: 'Käufer entlädt selbst und übernimmt die Importabfertigung – Verkäufer liefert nur ankommend.',
    risikoText: 'Das Risiko bleibt fast die ganze Lieferkette beim Verkäufer und geht erst über, wenn die Ware transportbereit (also noch auf dem Transportmittel) am vereinbarten Bestimmungsort beim Käufer ankommt.',
    kostenText: 'Der Verkäufer zahlt den kompletten Transport bis zum Zielort. Das Entladen am Zielort zahlt aber schon der Käufer.',
    versicherungText: 'Keine Partei ist verpflichtet, eine Transportversicherung abzuschließen.',
    zollText: 'Der Verkäufer übernimmt die Exportabfertigung, der Käufer die Importabfertigung – obwohl der Verkäufer fast bis zur Haustür liefert, bleibt die Einfuhrverzollung beim Käufer.',
    beispiel: 'Ein Salzburger Lebensmittelexporteur liefert DAP an ein Lager in Hamburg. Der LKW kommt am Lager an und steht abfahrbereit zum Entladen – genau in diesem Moment geht das Risiko über. Den Stapler-Einsatz zum Entladen muss der Käufer organisieren und zahlen, und auch die Einfuhrabgaben in Deutschland trägt er.',
    matchText: 'Risiko und Kosten gehen gemeinsam über, sobald die Ware unentladen am Bestimmungsort ankommt – Entladen zahlt der Käufer.',
  },
  {
    code: 'DPU', name: 'Delivered At Place Unloaded', de: 'Geliefert benannter Ort entladen', group: 'D', allTransport: true,
    risikoStage: 7.5, kostenStage: 7.5, exportzoll: 'Verkäufer', importzoll: 'Käufer', versicherung: 'keine Pflicht',
    merksatz: 'Wie DAP, aber Verkäufer entlädt die Ware zusätzlich am Bestimmungsort.',
    fallstrick: 'Einziger Incoterm, bei dem der Verkäufer das Entladen übernimmt.',
    risikoText: 'Das Risiko geht erst über, NACHDEM die Ware am Bestimmungsort entladen wurde – einen Schritt später als bei DAP.',
    kostenText: 'Der Verkäufer zahlt Transport UND Entladung am Zielort. Erst danach übernimmt der Käufer die Kosten.',
    versicherungText: 'Keine Partei ist verpflichtet, eine Transportversicherung abzuschließen.',
    zollText: 'Der Verkäufer übernimmt die Exportabfertigung, der Käufer die Importabfertigung.',
    beispiel: 'Ein Grazer Maschinenteile-Hersteller liefert DPU an eine Baustelle in Rotterdam. Der Verkäufer organisiert nicht nur den Transport, sondern auch den Kran, der die schweren Bauteile vom LKW hebt. Erst wenn die Teile sicher auf dem Boden stehen, geht das Risiko auf den Käufer über – fällt der Kran während des Entladens noch um, ist das Sache des Verkäufers.',
    matchText: 'Risiko und Kosten gehen erst über, nachdem die Ware am Bestimmungsort entladen wurde – einzige Klausel mit Entladepflicht des Verkäufers.',
  },
  {
    code: 'DDP', name: 'Delivered Duty Paid', de: 'Geliefert verzollt', group: 'D', allTransport: true,
    risikoStage: 8, kostenStage: 8, exportzoll: 'Verkäufer', importzoll: 'Verkäufer', versicherung: 'keine Pflicht',
    merksatz: 'Maximalpflicht für den Verkäufer: er liefert verzollt (Import inklusive) direkt zum Käufer.',
    fallstrick: 'Gegenteil von EXW – Verkäufer trägt wirklich alles, auch die Einfuhrabgaben.',
    risikoText: 'Das Risiko bleibt bis ganz zum Schluss beim Verkäufer und geht erst über, wenn die Ware beim Käufer ankommt – das ist der späteste Übergangspunkt aller Incoterms.',
    kostenText: 'Der Verkäufer zahlt wirklich alles: Transport, Export- UND Importabgaben, bis die Ware beim Käufer steht.',
    versicherungText: 'Keine Partei ist verpflichtet, eine Transportversicherung abzuschließen – trotz der Maximalpflicht bei Risiko und Kosten.',
    zollText: 'Der Verkäufer übernimmt sowohl Export- als auch Importabfertigung inklusive aller Einfuhrabgaben und Zölle im Zielland – das ist einzigartig unter den Incoterms.',
    beispiel: 'Ein Wiener Elektronikhändler verkauft DDP an einen Endkunden in Chicago. Der Verkäufer organisiert nicht nur den gesamten Transport, sondern zahlt auch die US-Einfuhrzölle und erledigt die amerikanische Importabfertigung. Der Käufer muss sich um nichts kümmern außer die Ware entgegenzunehmen.',
    matchText: 'Risiko und Kosten bleiben bis zur Ankunft beim Käufer beim Verkäufer – inklusive Importabfertigung und Einfuhrabgaben.',
  },
  {
    code: 'FAS', name: 'Free Alongside Ship', de: 'Frei Längsseite Schiff', group: 'F', allTransport: false,
    risikoStage: 3, kostenStage: 3, exportzoll: 'Verkäufer', importzoll: 'Käufer', versicherung: 'keine Pflicht',
    merksatz: 'Verkäufer liefert die Ware neben das Schiff (Kai/Leichter) im Verschiffungshafen.',
    fallstrick: 'Nur See-/Binnenschifffahrt. Noch nicht an Bord – das ist der Unterschied zu FOB.',
    risikoText: 'Das Risiko geht über, sobald die Ware neben dem Schiff am Kai bzw. auf dem Leichter im Verschiffungshafen bereitgestellt ist – noch BEVOR sie verladen wird.',
    kostenText: 'Der Verkäufer zahlt den Transport bis zum Kai im Hafen. Das eigentliche Verladen an Bord zahlt schon der Käufer.',
    versicherungText: 'Keine Partei ist verpflichtet, eine Transportversicherung abzuschließen.',
    zollText: 'Der Verkäufer übernimmt die Exportabfertigung, der Käufer die Importabfertigung.',
    beispiel: 'Ein Linzer Stahlhändler liefert FAS im Hafen von Triest an einen Käufer, der die Ware per Schiff weiter verschifft. Der Stahl wird auf dem Kai direkt neben dem Schiff bereitgestellt. Stürzt beim anschließenden Verladen ans Bord ein Kran um, ist das schon Sache des Käufers – das Risiko war ja schon vorher übergegangen.',
    matchText: 'Risiko und Kosten gehen gemeinsam über, sobald die Ware neben dem Schiff am Kai bereitsteht – noch vor dem Verladen. Nur Schiffstransport.',
  },
  {
    code: 'FOB', name: 'Free On Board', de: 'Frei an Bord', group: 'F', allTransport: false,
    risikoStage: 3.5, kostenStage: 3.5, exportzoll: 'Verkäufer', importzoll: 'Käufer', versicherung: 'keine Pflicht',
    merksatz: 'Verkäufer liefert, sobald die Ware an Bord des Schiffes ist.',
    fallstrick: 'Nur See-/Binnenschifffahrt. Klassiker für Verwechslung – bei Containern eigentlich FCA sinnvoller.',
    risikoText: 'Das Risiko geht über, sobald die Ware an Bord des vom Käufer benannten Schiffes verladen ist – also einen Schritt später als bei FAS.',
    kostenText: 'Der Verkäufer zahlt Transport und Verladung bis die Ware an Bord ist. Ab Bord zahlt der Käufer die Seefracht.',
    versicherungText: 'Keine Partei ist verpflichtet, eine Transportversicherung abzuschließen.',
    zollText: 'Der Verkäufer übernimmt die Exportabfertigung, der Käufer die Importabfertigung.',
    beispiel: 'Ein Grazer Maschinenteile-Hersteller liefert FOB Triest an einen Kunden in Shanghai. Sobald die Maschine an Bord des Schiffes verladen und festgezurrt ist, geht das Risiko auf den Käufer über. Sinkt das Schiff danach im Sturm, ist das ein Schaden des Käufers (bzw. seiner Versicherung) – nicht des Verkäufers.',
    matchText: 'Risiko und Kosten gehen gemeinsam über, sobald die Ware an Bord des Schiffes verladen ist. Nur Schiffstransport.',
  },
  {
    code: 'CFR', name: 'Cost and Freight', de: 'Kosten und Fracht', group: 'C', allTransport: false,
    risikoStage: 3.5, kostenStage: 5, exportzoll: 'Verkäufer', importzoll: 'Käufer', versicherung: 'keine Pflicht',
    merksatz: 'Verkäufer zahlt die Seefracht bis zum Bestimmungshafen, das Risiko geht aber schon bei Verladung über.',
    fallstrick: 'Wie CPT: Kosten- und Risikoübergang fallen auseinander – nur eben see-spezifisch.',
    risikoText: 'Das Risiko geht schon über, sobald die Ware an Bord des Schiffes ist – genau wie bei FOB.',
    kostenText: 'Der Verkäufer zahlt aber zusätzlich die Seefracht bis zum Bestimmungshafen weiter. Auch hier gilt: Verkäufer zahlt länger, als er das Risiko trägt.',
    versicherungText: 'Keine Partei ist verpflichtet, eine Transportversicherung abzuschließen – das unterscheidet CFR von CIF.',
    zollText: 'Der Verkäufer übernimmt die Exportabfertigung, der Käufer die Importabfertigung.',
    beispiel: 'Ein Salzburger Lebensmittelexporteur verkauft CFR an einen Käufer in New York. Der Verkäufer zahlt die komplette Seefracht von Hamburg bis New York. Sobald die Ware aber in Hamburg an Bord ist, trägt der Käufer das Risiko – beschädigt ein Sturm auf hoher See die Ladung, ist das sein Schaden, obwohl der Verkäufer die Fracht weiterzahlt.',
    matchText: 'Risiko geht schon bei Verladung an Bord über, Verkäufer zahlt Seefracht aber bis zum Bestimmungshafen weiter – ohne Versicherungspflicht. Nur Schiffstransport.',
  },
  {
    code: 'CIF', name: 'Cost, Insurance and Freight', de: 'Kosten, Versicherung und Fracht', group: 'C', allTransport: false,
    risikoStage: 3.5, kostenStage: 5, exportzoll: 'Verkäufer', importzoll: 'Käufer', versicherung: 'Verkäufer – Minimaldeckung (Institute Cargo Clauses C)',
    merksatz: 'Wie CFR, aber Verkäufer schließt zusätzlich eine Mindestversicherung ab.',
    fallstrick: 'CIF = Minimaldeckung (Klausel C), CIP = Maximaldeckung (Klausel A) – Eselsbrücke: CIF wie \'C\'heap.',
    risikoText: 'Genau wie bei CFR: Das Risiko geht über, sobald die Ware an Bord des Schiffes ist.',
    kostenText: 'Genau wie bei CFR: Der Verkäufer zahlt die Seefracht bis zum Bestimmungshafen.',
    versicherungText: 'Zusätzlich zu CFR muss der Verkäufer eine Transportversicherung mit Mindestdeckung (Institute Cargo Clauses C) abschließen – das ist der niedrigste Standard-Versicherungsschutz der Incoterms. Will der Käufer mehr Schutz, muss er selbst zusätzlich versichern.',
    zollText: 'Der Verkäufer übernimmt die Exportabfertigung, der Käufer die Importabfertigung.',
    beispiel: 'Ein steirischer Maschinenbauer verkauft CIF an einen Käufer in Singapur. Der Verkäufer zahlt die Seefracht und schließt eine Basis-Transportversicherung ab. Wird die Ladung unterwegs leicht beschädigt, deckt diese Minimalversicherung nur Grundrisiken ab – für umfassenderen Schutz hätte der Käufer selbst eine Zusatzversicherung abschließen müssen.',
    matchText: 'Risiko geht schon bei Verladung an Bord über, Verkäufer zahlt Seefracht bis zum Hafen UND versichert minimal (Klausel C). Nur Schiffstransport.',
  },
];

const ALLGEMEIN = [
  '11 international standardisierte Lieferklauseln (Update 2020)',
  'Erleichtern die Vereinbarung von Lieferkonditionen zwischen Käufer und Verkäufer',
  'Regeln Kosten, Risiko, Versicherung und Verzollung der Lieferung',
  'Der vereinbarte Ort markiert die Liefererfüllung für den Exporteur',
  'Klauseln müssen explizit im Kaufvertrag vereinbart werden',
];

const RISIKO_ARTEN = ['Diebstahl', 'Beschädigung', 'Verlust', 'Zeitverzug'];

const COMPARISON_PAIRS: ComparisonPair[] = [
  { a: 'DAP', b: 'DPU', question: 'Bei welchem der beiden Incoterms entlädt der Verkäufer die Ware zusätzlich am Bestimmungsort?', answer: 'DPU', explain: 'DPU (Delivered At Place Unloaded) ist der einzige Incoterm, bei dem der Verkäufer auch entlädt. Bei DAP liefert er nur transportbereit, unentladen.' },
  { a: 'FAS', b: 'FOB', question: 'Bei welchem der beiden ist die Ware bereits an Bord des Schiffes, wenn das Risiko übergeht?', answer: 'FOB', explain: 'FOB (Free On Board) = Risikoübergang bei Verladung an Bord. FAS (Free Alongside Ship) = Risikoübergang schon davor, neben dem Schiff am Kai.' },
  { a: 'CPT', b: 'CIP', question: 'Welcher der beiden verpflichtet den Verkäufer zusätzlich zu einer Transportversicherung?', answer: 'CIP', explain: 'CIP = Carriage AND INSURANCE Paid To — inkl. Versicherungspflicht (Maximaldeckung, Klausel A). CPT hat keine Versicherungspflicht.' },
  { a: 'CFR', b: 'CIF', question: 'Welcher der beiden verpflichtet den Verkäufer zusätzlich zu einer Transportversicherung?', answer: 'CIF', explain: 'CIF = Cost, INSURANCE and Freight — inkl. Versicherungspflicht (Minimaldeckung, Klausel C). CFR hat keine Versicherungspflicht.' },
  { a: 'CIP', b: 'CIF', question: 'Welcher der beiden verlangt nur eine Mindestversicherung (Institute Cargo Clauses C)?', answer: 'CIF', explain: 'CIF verlangt nur Minimaldeckung (Klausel C). CIP verlangt Maximaldeckung (Klausel A) — höherer Schutz, da CIP für alle Transportarten gilt.' },
  { a: 'EXW', b: 'FCA', question: 'Bei welchem der beiden übernimmt der Verkäufer die Exportabfertigung?', answer: 'FCA', explain: 'Bei FCA übernimmt der Verkäufer schon die Exportverzollung. Bei EXW (Maximalpflicht beim Käufer) macht der Käufer wirklich alles, auch den Export.' },
  { a: 'EXW', b: 'DDP', question: 'Welcher der beiden ist die Maximalpflicht für den VERKÄUFER (inkl. Importverzollung)?', answer: 'DDP', explain: 'DDP = Verkäufer trägt alles bis zum Käufer, inkl. Einfuhrabgaben. EXW ist das genaue Gegenteil: Maximalpflicht beim Käufer.' },
  { a: 'CPT', b: 'CFR', question: 'Welcher der beiden gilt für ALLE Transportarten (nicht nur See/Binnenschiff)?', answer: 'CPT', explain: 'CPT funktioniert für jede Transportart inkl. Multimodal/Luft. CFR ist auf See- und Binnenschifffahrt beschränkt.' },
];

const FIRMEN = ['ein steirischer Maschinenbauer', 'ein Wiener Elektronikhändler', 'eine Tiroler Möbelmanufaktur', 'ein Salzburger Lebensmittelexporteur', 'ein Linzer Stahlhändler', 'ein Grazer Maschinenteile-Hersteller'];
const ZIELE = ['einem Kunden in Hamburg', 'einem Käufer in Rotterdam', 'einem Abnehmer in Shanghai', 'einem Kunden in Mailand', 'einem Käufer in Singapur', 'einer Niederlassung in Chicago'];
const SEEZIELE = ['einem Kunden in Shanghai (Seefracht)', 'einem Abnehmer in New York (Seefracht)', 'einem Käufer in Singapur (Container per Schiff)'];

// ─────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pick<T>(arr: T[], n: number): T[] {
  return shuffle(arr).slice(0, n);
}

function buildCase(term: Incoterm): string {
  const firma = pick(FIRMEN, 1)[0];
  const ziel = term.allTransport ? pick(ZIELE, 1)[0] : pick(SEEZIELE, 1)[0];
  const clauses: string[] = [];

  if (term.risikoStage === term.kostenStage) {
    if (term.risikoStage === 0) clauses.push('Der Käufer organisiert und bezahlt den gesamten Transport ab Werk selbst, inklusive Verladung.');
    else if (term.risikoStage === 1) clauses.push('Der Verkäufer übergibt die Ware verzollt an den vom Käufer benannten Frachtführer — ab da trägt der Käufer Kosten und Risiko.');
    else if (term.risikoStage === 3) clauses.push('Der Verkäufer liefert die Ware neben das Schiff im Verschiffungshafen — ab da trägt der Käufer Kosten und Risiko.');
    else if (term.risikoStage === 3.5) clauses.push('Der Verkäufer liefert die Ware an Bord des Schiffes — ab da trägt der Käufer Kosten und Risiko.');
    else if (term.risikoStage === 7) clauses.push('Der Verkäufer liefert die Ware transportbereit (unentladen) zum vereinbarten Bestimmungsort beim Käufer.');
    else if (term.risikoStage === 7.5) clauses.push('Der Verkäufer liefert die Ware UND entlädt sie am vereinbarten Bestimmungsort.');
    else if (term.risikoStage === 8) clauses.push('Der Verkäufer liefert die Ware bis zum Käufer, inklusive Übernahme der Einfuhrabgaben.');
  } else {
    if (term.risikoStage <= 1) clauses.push('Der Verkäufer zahlt die Fracht bis zum Bestimmungsort, aber das Risiko geht bereits bei Übergabe an den ersten Frachtführer auf den Käufer über.');
    else clauses.push('Der Verkäufer zahlt die Seefracht bis zum Bestimmungshafen, aber das Risiko geht bereits bei Verladung an Bord auf den Käufer über.');
  }

  if (term.versicherung.startsWith('Verkäufer')) {
    if (term.versicherung.includes('Maximaldeckung')) clauses.push('Zusätzlich schließt der Verkäufer eine umfassende Transportversicherung mit Maximaldeckung ab.');
    else clauses.push('Zusätzlich schließt der Verkäufer eine Transportversicherung mit Mindestdeckung ab.');
  }

  if (term.exportzoll === 'Käufer') clauses.push('Auch die Exportabfertigung übernimmt der Käufer.');
  if (term.importzoll === 'Verkäufer') clauses.push('Der Verkäufer übernimmt sogar die Importabfertigung im Zielland.');

  return `${firma} liefert an ${ziel}. ${clauses.join(' ')}`;
}

function buildOptions(term: Incoterm): Incoterm[] {
  const pool = INCOTERMS.filter(t => t.code !== term.code && t.allTransport === term.allTransport);
  const distractors = pick(pool.length >= 3 ? pool : INCOTERMS.filter(t => t.code !== term.code), 3);
  return shuffle([term, ...distractors]);
}

// ─────────────────────────────────────────────────────────────────────────
// SMALL COMPONENTS
// ─────────────────────────────────────────────────────────────────────────

function GroupBadge({ group }: { group: GroupKey }) {
  const g = GROUPS[group];
  return (
    <span
      className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold border"
      style={{ background: g.color + '22', color: g.color, borderColor: g.color + '55' }}
    >
      {group}
    </span>
  );
}

function MiniProgressBar({ value, total }: { value: number; total: number }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div className="h-1.5 bg-[#2d3148] rounded-full overflow-hidden mb-4">
      <div className="h-full bg-indigo-500 transition-all duration-300" style={{ width: `${pct}%` }} />
    </div>
  );
}

function LocalFeedback({ correct, text }: { correct: boolean; text?: string }) {
  return (
    <div className={`mt-3.5 px-4 py-3 rounded-xl border text-[13.5px] leading-relaxed ${
      correct
        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
        : 'bg-red-500/10 border-red-500/30 text-red-300'
    }`}>
      <b>{correct ? '✓ Richtig' : '✗ Nicht ganz'}</b>
      {text && <div className="text-white mt-1">{text}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// THEORIE — Timeline Mini
// ─────────────────────────────────────────────────────────────────────────

function TimelineMini({ term }: { term: Incoterm }) {
  const w = 100 / (STAGES.length - 1);
  return (
    <div className="relative h-7 my-2.5">
      <div className="absolute top-3 left-0 right-0 h-1 bg-[#2d3148] rounded-sm" />
      <div
        className="absolute top-3 left-0 h-1 bg-amber-500 rounded-sm opacity-55"
        style={{ width: `${term.kostenStage * w}%` }}
      />
      <div
        className="absolute top-[18px] left-0 h-1 bg-red-500 rounded-sm"
        style={{ width: `${term.risikoStage * w}%` }}
      />
      <div
        className="absolute -top-0.5 text-[15px]"
        style={{ left: `${term.risikoStage * w}%`, transform: 'translateX(-50%)' }}
      >
        ▾
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// THEORIE — Overview Chart (alle 11 Terms als Balken)
// ─────────────────────────────────────────────────────────────────────────

// SVG transport-chain icons matching the textbook diagram
const TI = {
  factory: (
    <svg viewBox="0 0 32 32" fill="currentColor" className="w-full h-full">
      <rect x="2" y="14" width="28" height="16" rx="1" opacity=".15"/>
      <rect x="4" y="16" width="6" height="4" rx=".5" opacity=".3"/>
      <rect x="13" y="16" width="6" height="4" rx=".5" opacity=".3"/>
      <rect x="22" y="16" width="6" height="4" rx=".5" opacity=".3"/>
      <rect x="4" y="22" width="6" height="4" rx=".5" opacity=".3"/>
      <rect x="13" y="22" width="6" height="4" rx=".5" opacity=".3"/>
      <rect x="22" y="22" width="6" height="4" rx=".5" opacity=".3"/>
      <rect x="6" y="4" width="4" height="10" rx=".5"/>
      <rect x="14" y="7" width="4" height="7" rx=".5"/>
      <rect x="22" y="2" width="4" height="12" rx=".5"/>
      <path d="M7 4 L8 1 L9 4" strokeWidth=".5" stroke="currentColor" fill="none"/>
      <path d="M15 7 L16 4 L17 7" strokeWidth=".5" stroke="currentColor" fill="none"/>
      <path d="M23 2 L24 -1 L25 2" strokeWidth=".5" stroke="currentColor" fill="none"/>
    </svg>
  ),
  warehouse: (
    <svg viewBox="0 0 32 32" fill="currentColor" className="w-full h-full">
      <path d="M2 15 L16 6 L30 15 V30 H2 Z" opacity=".15"/>
      <path d="M2 15 L16 6 L30 15" fill="none" stroke="currentColor" strokeWidth="1.5"/>
      <rect x="2" y="15" width="28" height="15" rx="1" opacity=".2"/>
      <rect x="12" y="20" width="8" height="10" rx="1" opacity=".35"/>
    </svg>
  ),
  truck: (
    <svg viewBox="0 0 36 28" fill="currentColor" className="w-full h-full">
      <rect x="1" y="6" width="20" height="14" rx="2" opacity=".2"/>
      <rect x="21" y="10" width="12" height="10" rx="1.5" opacity=".3"/>
      <path d="M33 12 L35 12 L35 18 L33 18" opacity=".15"/>
      <circle cx="8" cy="23" r="3" opacity=".4"/>
      <circle cx="8" cy="23" r="1.5" fill="#0f1117"/>
      <circle cx="28" cy="23" r="3" opacity=".4"/>
      <circle cx="28" cy="23" r="1.5" fill="#0f1117"/>
    </svg>
  ),
  customs: (
    <svg viewBox="0 0 28 32" fill="currentColor" className="w-full h-full">
      <rect x="4" y="10" width="20" height="20" rx="1.5" opacity=".15"/>
      <rect x="8" y="2" width="12" height="8" rx="1" opacity=".25"/>
      <text x="14" y="8" textAnchor="middle" fontSize="6" fontWeight="bold" opacity=".6">Z</text>
      <path d="M9 18 H19 M9 22 H19 M9 26 H15" stroke="currentColor" strokeWidth="1" opacity=".25"/>
    </svg>
  ),
  ship: (
    <svg viewBox="0 0 40 32" fill="currentColor" className="w-full h-full">
      <path d="M4 22 Q4 28 10 28 H30 Q36 28 36 22 L34 16 H6 Z" opacity=".2"/>
      <rect x="10" y="8" width="20" height="8" rx="1" opacity=".25"/>
      <rect x="14" y="10" width="4" height="4" rx=".5" fill="#0f1117" opacity=".4"/>
      <rect x="22" y="10" width="4" height="4" rx=".5" fill="#0f1117" opacity=".4"/>
      <rect x="18" y="2" width="3" height="8" rx=".5" opacity=".35"/>
      <path d="M2 30 Q6 26 10 30 Q14 26 18 30 Q22 26 26 30 Q30 26 34 30 Q38 26 40 30" fill="none" stroke="currentColor" strokeWidth="1" opacity=".2"/>
    </svg>
  ),
  crane: (
    <svg viewBox="0 0 32 32" fill="currentColor" className="w-full h-full">
      <rect x="13" y="8" width="6" height="22" rx="1" opacity=".2"/>
      <rect x="4" y="6" width="24" height="4" rx="1" opacity=".25"/>
      <path d="M6 6 V4 L16 1 L26 4 V6" fill="none" stroke="currentColor" strokeWidth="1" opacity=".3"/>
      <rect x="4" y="10" width="3" height="14" rx=".5" opacity=".15"/>
      <rect x="3" y="24" width="5" height="4" rx=".5" opacity=".2"/>
    </svg>
  ),
  plane: (
    <svg viewBox="0 0 36 24" fill="currentColor" className="w-full h-full">
      <path d="M2 14 L10 12 L24 6 L34 4 L32 8 L24 10 L14 14 L10 14 Z" opacity=".25"/>
      <path d="M12 14 L14 20 L18 14" opacity=".2"/>
      <circle cx="33" cy="5" r="1.5" opacity=".3"/>
    </svg>
  ),
};

const TRANSPORT_CHAIN = [
  { icon: TI.factory, label: 'Werk' },
  { icon: TI.warehouse, label: '' },
  { icon: TI.truck, label: '' },
  { icon: TI.customs, label: 'Export' },
  { icon: TI.plane, label: '' },
  { icon: TI.crane, label: '' },
  { icon: TI.ship, label: '' },
  { icon: TI.crane, label: '' },
  { icon: TI.plane, label: '' },
  { icon: TI.customs, label: 'Import' },
  { icon: TI.truck, label: '' },
  { icon: TI.warehouse, label: '' },
  { icon: TI.factory, label: 'Käufer' },
];

function OverviewChart() {
  const n = STAGES.length;
  const w = 100 / (n - 1);
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <Card className="mb-4">
      <h2 className="text-lg font-bold mb-1">Incoterms 2020 — Gesamtübersicht</h2>
      <p className="text-xs text-[#9ca3af] mb-3">
        Jede Zeile zeigt einen Incoterm. Die obere Linie (orange) ist die Kostengrenze, die untere (rot) die Risikogrenze — beide markieren, ab wo der <b className="text-white">Käufer</b> übernimmt.
      </p>

      {/* Transport chain illustration — hidden on very small screens */}
      <div className="hidden sm:block ml-14 mb-1 overflow-x-auto">
        <div className="relative flex items-end" style={{ minWidth: 0 }}>
          {/* ground line */}
          <div className="absolute bottom-0 left-0 right-0 h-px bg-[#3d4168]" />
          {TRANSPORT_CHAIN.map((item, i) => (
            <div
              key={i}
              className="flex flex-col items-center flex-1"
              style={{ minWidth: 0 }}
            >
              <div className="w-5 h-5 md:w-6 md:h-6 text-[#6b7280] mb-0.5">{item.icon}</div>
              {item.label && (
                <span className="text-[7px] text-[#5e6173] leading-none">{item.label}</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Stage labels — hidden on mobile */}
      <div className="hidden sm:flex ml-14 mb-1.5 mt-1">
        {STAGES.map((s, i) => (
          <div
            key={i}
            className="text-[7.5px] md:text-[8.5px] text-[#5e6173] text-center leading-tight px-px"
            style={{
              flex: i === 0 || i === n - 1 ? '0 0 auto' : 1,
              width: i === 0 || i === n - 1 ? `${w}%` : undefined,
            }}
          >
            {s}
          </div>
        ))}
      </div>

      <div className="relative">
        {/* vertical guide lines */}
        <div className="absolute left-10 sm:left-14 right-0 top-0 bottom-0 pointer-events-none">
          {STAGES.map((_, i) => (
            <div
              key={i}
              className="absolute top-0 bottom-0 w-px bg-[#2d3148] opacity-50"
              style={{ left: `${i * w}%` }}
            />
          ))}
        </div>

        {INCOTERMS.map(term => {
          const isHover = hovered === term.code;
          const g = GROUPS[term.group];
          return (
            <div
              key={term.code}
              onMouseEnter={() => setHovered(term.code)}
              onMouseLeave={() => setHovered(null)}
              className={`flex items-center h-[30px] relative cursor-default rounded-md ${isHover ? 'bg-[#252840]' : ''}`}
            >
              <div
                className="w-10 sm:w-14 shrink-0 text-[11px] sm:text-xs font-bold"
                style={{ color: isHover ? g.color : 'white' }}
              >
                {term.code}
              </div>
              <div className="relative flex-1 h-4">
                {/* Seller bars (solid) */}
                <div
                  className="absolute top-0.5 left-0 h-[5px] rounded-sm"
                  style={{
                    width: `${term.kostenStage * w}%`,
                    background: isHover ? '#f59e0b' : '#b45309',
                    opacity: isHover ? 1 : 0.6,
                  }}
                />
                <div
                  className="absolute top-[9px] left-0 h-[5px] rounded-sm"
                  style={{
                    width: `${term.risikoStage * w}%`,
                    background: isHover ? '#ef4444' : '#991b1b',
                    opacity: isHover ? 1 : 0.7,
                  }}
                />
                {/* Buyer bars (faded continuation) */}
                <div
                  className="absolute top-0.5 h-[5px] rounded-sm"
                  style={{
                    left: `${term.kostenStage * w}%`,
                    right: 0,
                    background: isHover ? 'rgba(245,158,11,0.2)' : 'rgba(180,83,9,0.12)',
                  }}
                />
                <div
                  className="absolute top-[9px] h-[5px] rounded-sm"
                  style={{
                    left: `${term.risikoStage * w}%`,
                    right: 0,
                    background: isHover ? 'rgba(239,68,68,0.2)' : 'rgba(153,27,27,0.12)',
                  }}
                />
                {!term.allTransport && (
                  <div className="absolute -right-0.5 -top-px text-[9px] text-indigo-400" title="Nur See-/Binnenschifffahrt">
                    ⚓
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex gap-3 sm:gap-4 text-[11px] sm:text-xs mt-4 pt-3 border-t border-[#2d3148] flex-wrap">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-5 h-[5px] rounded-sm bg-amber-500" /> Kosten Verkäufer
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-5 h-[5px] rounded-sm bg-red-500" /> Risiko Verkäufer
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-5 h-[5px] rounded-sm bg-amber-500/20" /> Kosten Käufer
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-5 h-[5px] rounded-sm bg-red-500/20" /> Risiko Käufer
        </span>
        <span><span className="text-indigo-400">⚓</span> nur See-/Binnenschiff</span>
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// THEORIE — Term Card
// ─────────────────────────────────────────────────────────────────────────

function TermCard({ term, expanded, onToggle }: { term: Incoterm; expanded: boolean; onToggle: () => void }) {
  const g = GROUPS[term.group];

  return (
    <div
      className="bg-[#1e2130] border rounded-xl p-4 sm:p-5 mb-2.5 cursor-pointer transition-colors"
      style={{ borderColor: expanded ? g.color + '66' : '#2d3148' }}
      onClick={onToggle}
    >
      <div className="flex justify-between items-center gap-2">
        <div className="flex items-center gap-2 sm:gap-2.5 flex-wrap min-w-0">
          <GroupBadge group={term.group} />
          <span className="text-lg sm:text-xl font-bold">{term.code}</span>
          <span className="text-[#9ca3af] text-xs sm:text-sm truncate">{term.name}</span>
        </div>
        {!term.allTransport && (
          <span
            className="hidden sm:inline-block shrink-0 px-2.5 py-0.5 rounded-full text-[10px] font-bold border"
            style={{ background: '#4d8eff22', color: '#4d8eff', borderColor: '#4d8eff55' }}
          >
            nur See/Binnenschiff
          </span>
        )}
      </div>
      <div className="text-[#5e6173] text-[13px] mt-0.5">{term.de}</div>

      {expanded && (
        <div className="mt-3.5 border-t border-[#2d3148] pt-3.5" onClick={e => e.stopPropagation()}>
          <TimelineMini term={term} />
          <div className="flex justify-between text-[11px] text-[#5e6173] mb-2">
            <span>Werk Verkäufer</span><span>Werk Käufer</span>
          </div>
          <div className="flex gap-3 sm:gap-4 text-[11px] sm:text-xs mb-3.5 flex-wrap">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-1 rounded-sm bg-red-500" /> Risiko (Käufer ab hier)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-1 rounded-sm bg-amber-500" /> Kosten (Käufer ab hier)
            </span>
          </div>

          <div className="grid gap-2.5 mb-3.5">
            <div className="bg-[#252840] rounded-lg px-3 sm:px-3.5 py-2.5 border-l-[3px] border-l-red-500">
              <div className="text-[11.5px] font-bold text-red-400 mb-0.5">RISIKO</div>
              <div className="text-[13px] sm:text-[13.5px] leading-relaxed">{term.risikoText}</div>
            </div>
            <div className="bg-[#252840] rounded-lg px-3 sm:px-3.5 py-2.5 border-l-[3px] border-l-amber-500">
              <div className="text-[11.5px] font-bold text-amber-400 mb-0.5">KOSTEN</div>
              <div className="text-[13px] sm:text-[13.5px] leading-relaxed">{term.kostenText}</div>
            </div>
            <div className="bg-[#252840] rounded-lg px-3 sm:px-3.5 py-2.5 border-l-[3px] border-l-indigo-400">
              <div className="text-[11.5px] font-bold text-indigo-400 mb-0.5">VERSICHERUNG</div>
              <div className="text-[13px] sm:text-[13.5px] leading-relaxed">{term.versicherungText}</div>
            </div>
            <div className="bg-[#252840] rounded-lg px-3 sm:px-3.5 py-2.5 border-l-[3px] border-l-emerald-400">
              <div className="text-[11.5px] font-bold text-emerald-400 mb-0.5">VERZOLLUNG</div>
              <div className="text-[13px] sm:text-[13.5px] leading-relaxed">{term.zollText}</div>
            </div>
          </div>

          <div className="bg-indigo-500/[0.08] border border-indigo-500/20 rounded-lg px-3 sm:px-3.5 py-3 text-[13px] sm:text-[13.5px] leading-relaxed mb-3">
            <b className="text-indigo-400">Beispiel:</b> {term.beispiel}
          </div>

          <div className="bg-amber-500/10 border border-amber-500/25 rounded-lg px-3 sm:px-3.5 py-2.5 text-[13px]">
            <b className="text-amber-400">&#9888; Fallstrick:</b> {term.fallstrick}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// THEORIE VIEW
// ─────────────────────────────────────────────────────────────────────────

function TheorieView() {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState<GroupKey | 'ALL'>('ALL');

  const filtered = filter === 'ALL' ? INCOTERMS : INCOTERMS.filter(t => t.group === filter);

  return (
    <div>
      <OverviewChart />

      <Card className="mb-4">
        <h2 className="text-lg font-bold mb-3.5">Was sind Incoterms?</h2>
        <div className="grid gap-2">
          {ALLGEMEIN.map((a, i) => (
            <div key={i} className="flex gap-2.5 text-sm leading-relaxed">
              <span className="text-indigo-400">—</span><span>{a}</span>
            </div>
          ))}
        </div>
        <div className="mt-3.5 text-[13px] text-[#9ca3af]">
          <b className="text-white">Risiko</b> umfasst: {RISIKO_ARTEN.join(', ')}
        </div>
      </Card>

      <Card className="mb-4">
        <h2 className="text-lg font-bold mb-3.5">Zwei Begriffe, die du vorher kennen musst</h2>
        <div className="grid gap-3">
          <div className="bg-[#252840] rounded-xl p-3 sm:p-4">
            <div className="font-bold text-sm mb-1 text-indigo-400">Frachtführer</div>
            <div className="text-[13px] sm:text-[13.5px] leading-relaxed">
              Jedes Transportunternehmen, das die Ware physisch befördert — unabhängig vom Verkehrsmittel. Ein LKW-Spediteur ist ein Frachtführer, eine Bahn ist ein Frachtführer, eine Reederei mit ihrem Schiff ist ein Frachtführer, eine Airline ist ein Frachtführer. Der Begriff sagt nichts darüber, welches Fahrzeug es ist, nur dass jemand den Transport übernimmt. Bei FCA ist konkret der <i>erste</i> Frachtführer in der Kette gemeint — wer auch immer als erstes die Ware vom Verkäufer übernimmt.
            </div>
          </div>
          <div className="bg-[#252840] rounded-xl p-3 sm:p-4">
            <div className="font-bold text-sm mb-1 text-indigo-400">Haupttransport</div>
            <div className="text-[13px] sm:text-[13.5px] leading-relaxed">
              Die Beförderungsstrecke vom Abgangsland zum Bestimmungsland — der eigentliche grenzüberschreitende Transport (z. B. die Seefracht von Hamburg nach Shanghai, oder der LKW-Lauf von Wien nach Mailand). Davor liegt meist der <b className="text-white">Vorlauf</b> (Werk &rarr; Verschiffungshafen/Terminal), danach der <b className="text-white">Nachlauf</b> (Zielhafen/Terminal &rarr; Endkunde) — diese zählen nicht als Haupttransport.
            </div>
          </div>
        </div>
        <div className="mt-3 text-xs text-[#5e6173] italic">
          Genau diese zwei Begriffe trennen die Gruppen F und C: bei F zahlt und riskiert der Käufer den Haupttransport, bei C zahlt ihn der Verkäufer — das Risiko geht aber trotzdem schon früh über.
        </div>
      </Card>

      <Card className="mb-4">
        <h2 className="text-lg font-bold mb-3.5">Die 4 Gruppen</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {(Object.entries(GROUPS) as [GroupKey, GroupInfo][]).map(([k, g]) => (
            <div
              key={k}
              className="bg-[#252840] rounded-xl p-3 sm:p-3.5 border-l-[3px]"
              style={{ borderLeftColor: g.color }}
            >
              <div className="font-bold text-sm" style={{ color: g.color }}>{g.name}</div>
              <div className="text-xs text-[#9ca3af] mt-1">{g.desc}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* Group filter buttons */}
      <div className="flex gap-1.5 sm:gap-2 mb-3 flex-wrap">
        <button
          className={`px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl border text-xs sm:text-sm font-semibold transition-colors ${
            filter === 'ALL'
              ? 'border-indigo-500 bg-indigo-500/15 text-indigo-400'
              : 'border-[#2d3148] bg-[#1e2130] text-[#9ca3af]'
          }`}
          onClick={() => setFilter('ALL')}
        >
          Alle (11)
        </button>
        {(Object.entries(GROUPS) as [GroupKey, GroupInfo][]).map(([k, g]) => (
          <button
            key={k}
            className="px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl border text-xs sm:text-sm font-semibold transition-colors"
            style={{
              borderColor: filter === k ? g.color : '#2d3148',
              color: filter === k ? g.color : '#9ca3af',
              background: filter === k ? g.color + '22' : '#1e2130',
            }}
            onClick={() => setFilter(k)}
          >
            {k}
          </button>
        ))}
      </div>

      {filtered.map(t => (
        <TermCard
          key={t.code}
          term={t}
          expanded={expanded === t.code}
          onToggle={() => setExpanded(expanded === t.code ? null : t.code)}
        />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// EXERCISE STAGE HEADER
// ─────────────────────────────────────────────────────────────────────────

function StageHeader({ stage, setStage }: { stage: number; setStage: (s: number) => void }) {
  const stages = [
    { id: 0, label: '0 · Gruppen' },
    { id: 1, label: '1 · Matching' },
    { id: 2, label: '2 · Kategorien' },
    { id: 3, label: '3 · Zeitleiste' },
    { id: 4, label: '4 · Vergleich' },
    { id: 5, label: '5 · Cases' },
  ];
  return (
    <div className="flex gap-1.5 mb-4 flex-wrap">
      {stages.map(s => (
        <button
          key={s.id}
          onClick={() => setStage(s.id)}
          className={`px-2.5 sm:px-3.5 py-1.5 rounded-xl border text-[11px] sm:text-xs font-semibold transition-colors ${
            stage === s.id
              ? 'border-indigo-500 bg-indigo-500/15 text-indigo-400'
              : 'border-[#2d3148] bg-[#1e2130] text-[#9ca3af]'
          }`}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// STUFE 0 — GRUPPENWEISES MATCHING: Kürzel <-> Übergabeerklärung
// ─────────────────────────────────────────────────────────────────────────

function Stage0GroupMatch() {
  const [activeGroup, setActiveGroup] = useState<GroupKey>('F');
  const groupTerms = useMemo(() => INCOTERMS.filter(t => t.group === activeGroup), [activeGroup]);

  const [order, setOrder] = useState(() => shuffle(groupTerms));
  const [matched, setMatched] = useState<Record<string, string>>({});
  const [wrong, setWrong] = useState<{ code: string; explCode: string } | null>(null);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [selectedExpl, setSelectedExpl] = useState<string | null>(null);
  const [dragCode, setDragCode] = useState<string | null>(null);

  const explOrder = useMemo(() => shuffle(groupTerms), [groupTerms]);

  const allMatched = Object.keys(matched).length === groupTerms.length;

  const resetGroup = useCallback((g: GroupKey) => {
    const terms = INCOTERMS.filter(t => t.group === g);
    setActiveGroup(g);
    setOrder(shuffle(terms));
    setMatched({});
    setSelectedCode(null);
    setSelectedExpl(null);
    setWrong(null);
  }, []);

  const tryMatch = (code: string, explCode: string) => {
    if (code === explCode) {
      setMatched(m => ({ ...m, [code]: explCode }));
      setSelectedCode(null);
      setSelectedExpl(null);
    } else {
      setWrong({ code, explCode });
      setTimeout(() => setWrong(null), 500);
      setSelectedCode(null);
      setSelectedExpl(null);
    }
  };

  const handleCodeClick = (code: string) => {
    if (matched[code]) return;
    if (selectedExpl) { tryMatch(code, selectedExpl); return; }
    setSelectedCode(code === selectedCode ? null : code);
  };

  const handleExplClick = (explCode: string) => {
    if (Object.values(matched).includes(explCode)) return;
    if (selectedCode) { tryMatch(selectedCode, explCode); return; }
    setSelectedExpl(explCode === selectedExpl ? null : explCode);
  };

  const onDragStart = (code: string) => setDragCode(code);
  const onDrop = (explCode: string) => {
    if (dragCode) tryMatch(dragCode, explCode);
    setDragCode(null);
  };

  const g = GROUPS[activeGroup];

  return (
    <Card className="mb-4">
      <div className="flex justify-between items-center mb-1.5">
        <h3 className="text-sm sm:text-base font-bold">Gruppen-Matching: Kürzel ↔ Übergabepunkt</h3>
        <span className="text-[#9ca3af] text-[13px]">{Object.keys(matched).length} / {groupTerms.length}</span>
      </div>
      <p className="text-xs text-[#9ca3af] mb-3.5">
        Verbinde jedes Kürzel mit seiner Erklärung — durch Antippen beider Karten oder per Drag-and-Drop.
      </p>

      <div className="flex gap-1.5 mb-4 flex-wrap">
        {(Object.entries(GROUPS) as [GroupKey, GroupInfo][]).map(([k, gi]) => (
          <button
            key={k}
            onClick={() => resetGroup(k)}
            className="px-3 sm:px-3.5 py-1.5 rounded-xl border text-xs font-semibold transition-colors"
            style={{
              borderColor: activeGroup === k ? gi.color : '#2d3148',
              color: activeGroup === k ? gi.color : '#9ca3af',
              background: activeGroup === k ? gi.color + '22' : '#1e2130',
            }}
          >
            {k} ({INCOTERMS.filter(t => t.group === k).length})
          </button>
        ))}
      </div>

      <div
        className="rounded-xl px-3 sm:px-4 py-3 mb-4 text-[13px] sm:text-[13.5px] leading-relaxed"
        style={{ background: g.color + '14', border: `1px solid ${g.color}44` }}
      >
        <span className="font-bold" style={{ color: g.color }}>{g.name}: </span>
        {g.rule}
      </div>

      {/* Desktop: side-by-side / Mobile: stacked with labels */}
      <div className="grid gap-4 sm:gap-4" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
        {/* On mobile: alternating code + explanation cards */}
        <div className="sm:hidden grid gap-2">
          <div className="text-[10px] font-bold text-[#5e6173] uppercase tracking-wider mb-1">Kürzel antippen, dann Erklärung</div>
          <div className="grid grid-cols-3 gap-2 mb-3">
            {order.map(t => {
              const isMatched = !!matched[t.code];
              const isSelected = selectedCode === t.code;
              const isWrong = wrong?.code === t.code;
              return (
                <div
                  key={t.code}
                  onClick={() => handleCodeClick(t.code)}
                  className={`p-2.5 rounded-xl text-center font-bold text-sm transition-all ${
                    isMatched ? 'opacity-50 cursor-default' : 'cursor-pointer'
                  }`}
                  style={{
                    border: `1.5px solid ${isWrong ? '#e5534b' : isSelected ? '#4d8eff' : isMatched ? '#3ecf8e' : '#383a47'}`,
                    background: isMatched ? 'rgba(62,207,142,0.1)' : isSelected ? 'rgba(77,142,255,0.15)' : isWrong ? 'rgba(229,83,75,0.15)' : '#252840',
                    color: isMatched ? '#3ecf8e' : 'white',
                  }}
                >
                  {t.code}
                </div>
              );
            })}
          </div>
          <div className="grid gap-2">
            {explOrder.map(t => {
              const isMatched = Object.values(matched).includes(t.code);
              const isSelected = selectedExpl === t.code;
              const isWrong = wrong?.explCode === t.code;
              return (
                <div
                  key={t.code}
                  onClick={() => handleExplClick(t.code)}
                  className={`px-3 py-2.5 rounded-xl text-[12px] leading-relaxed transition-all ${
                    isMatched ? 'opacity-50 cursor-default' : 'cursor-pointer'
                  }`}
                  style={{
                    border: `1.5px solid ${isWrong ? '#e5534b' : isSelected ? '#4d8eff' : isMatched ? '#3ecf8e' : '#383a47'}`,
                    background: isMatched ? 'rgba(62,207,142,0.1)' : isSelected ? 'rgba(77,142,255,0.15)' : isWrong ? 'rgba(229,83,75,0.15)' : '#252840',
                    color: isMatched ? '#3ecf8e' : 'white',
                  }}
                >
                  {t.matchText}
                </div>
              );
            })}
          </div>
        </div>

        {/* Desktop: side by side */}
        <div className="hidden sm:grid gap-4" style={{ gridTemplateColumns: '180px 1fr' }}>
          <div className="grid gap-2.5">
            {order.map(t => {
              const isMatched = !!matched[t.code];
              const isSelected = selectedCode === t.code;
              const isWrong = wrong?.code === t.code;
              return (
                <div
                  key={t.code}
                  draggable={!isMatched}
                  onDragStart={() => onDragStart(t.code)}
                  onClick={() => handleCodeClick(t.code)}
                  className={`p-3.5 rounded-xl text-center font-bold text-base transition-all ${
                    isMatched ? 'opacity-60 cursor-default' : 'cursor-pointer'
                  }`}
                  style={{
                    border: `1.5px solid ${isWrong ? '#e5534b' : isSelected ? '#4d8eff' : isMatched ? '#3ecf8e' : '#383a47'}`,
                    background: isMatched ? 'rgba(62,207,142,0.1)' : isSelected ? 'rgba(77,142,255,0.15)' : isWrong ? 'rgba(229,83,75,0.15)' : '#252840',
                    color: isMatched ? '#3ecf8e' : 'white',
                  }}
                >
                  {t.code}
                  <div
                    className="text-[10.5px] font-normal mt-0.5 leading-tight"
                    style={{ color: isMatched ? '#3ecf8e' : '#5e6173' }}
                  >
                    ({t.name})
                  </div>
                </div>
              );
            })}
          </div>
          <div className="grid gap-2.5">
            {explOrder.map(t => {
              const isMatched = Object.values(matched).includes(t.code);
              const isSelected = selectedExpl === t.code;
              const isWrong = wrong?.explCode === t.code;
              return (
                <div
                  key={t.code}
                  onDragOver={e => e.preventDefault()}
                  onDrop={() => onDrop(t.code)}
                  onClick={() => handleExplClick(t.code)}
                  className={`px-4 py-3 rounded-xl text-[13px] leading-relaxed transition-all ${
                    isMatched ? 'opacity-60 cursor-default' : 'cursor-pointer'
                  }`}
                  style={{
                    border: `1.5px solid ${isWrong ? '#e5534b' : isSelected ? '#4d8eff' : isMatched ? '#3ecf8e' : '#383a47'}`,
                    background: isMatched ? 'rgba(62,207,142,0.1)' : isSelected ? 'rgba(77,142,255,0.15)' : isWrong ? 'rgba(229,83,75,0.15)' : '#252840',
                    color: isMatched ? '#3ecf8e' : 'white',
                  }}
                >
                  {t.matchText}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {allMatched && (
        <div className="mt-4">
          <LocalFeedback correct text={`Alle ${groupTerms.length} Begriffe der ${g.name} richtig zugeordnet.`} />
          <div className="flex gap-2 mt-3 flex-wrap">
            {(Object.keys(GROUPS) as GroupKey[]).filter(gk => gk !== activeGroup).slice(0, 1).map(gk => (
              <button
                key={gk}
                className="px-5 py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white font-bold text-sm transition-colors"
                onClick={() => resetGroup(gk)}
              >
                Weiter mit {gk}-Gruppe →
              </button>
            ))}
            <button
              className="px-5 py-2.5 rounded-xl border border-[#383a47] bg-[#252840] text-white font-semibold text-sm"
              onClick={() => resetGroup(activeGroup)}
            >
              Nochmal üben
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// STUFE 1 — MATCHING: Kürzel <-> Bedeutung
// ─────────────────────────────────────────────────────────────────────────

function Stage1Matching() {
  const [round, setRound] = useState(0);
  const [score, setScore] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [answered, setAnswered] = useState(false);
  const [correct, setCorrect] = useState(false);

  const question = useMemo(() => {
    const term = INCOTERMS[round % INCOTERMS.length];
    const wrongOptions = pick(INCOTERMS.filter(t => t.code !== term.code), 3);
    const options = shuffle([term, ...wrongOptions]);
    return { term, options };
  }, [round]);

  const handleSelect = (code: string) => {
    if (answered) return;
    setSelected(code);
    setAnswered(true);
    setCorrect(code === question.term.code);
    if (code === question.term.code) setScore(s => s + 1);
  };

  const next = () => {
    setRound(r => r + 1);
    setSelected(null);
    setAnswered(false);
  };

  return (
    <Card className="mb-4">
      <div className="flex justify-between items-center mb-2">
        <h3 className="text-sm sm:text-base font-bold">Welcher Incoterm passt zur Bedeutung?</h3>
        <span className="text-[#9ca3af] text-[13px]">Score: {score}</span>
      </div>
      <MiniProgressBar value={round % 10} total={10} />
      <div className="bg-[#252840] rounded-xl px-3 sm:px-4 py-3 sm:py-4 mb-4 text-sm sm:text-base font-semibold">
        „{question.term.de}" <span className="text-[#5e6173] font-normal text-[12px] sm:text-[13px]">({question.term.name})</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:gap-2.5">
        {question.options.map(opt => {
          const isSelected = selected === opt.code;
          const isCorrectOpt = opt.code === question.term.code;
          let bg = '#252840', border = '#2d3148';
          if (answered && isCorrectOpt) { bg = 'rgba(62,207,142,0.15)'; border = '#3ecf8e'; }
          else if (answered && isSelected && !isCorrectOpt) { bg = 'rgba(229,83,75,0.15)'; border = '#e5534b'; }
          return (
            <button
              key={opt.code}
              onClick={() => handleSelect(opt.code)}
              disabled={answered}
              className="px-3 sm:px-4 py-3 sm:py-3.5 rounded-xl text-left text-sm sm:text-[15px] font-bold transition-colors"
              style={{ border: `1px solid ${border}`, background: bg, color: 'white', cursor: answered ? 'default' : 'pointer' }}
            >
              {opt.code} <span className="font-normal text-[10px] sm:text-xs text-[#9ca3af]">· {opt.group}</span>
            </button>
          );
        })}
      </div>
      {answered && (
        <>
          <LocalFeedback correct={correct} text={question.term.merksatz} />
          <button className="mt-3.5 px-5 py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white font-bold text-sm transition-colors" onClick={next}>
            Weiter →
          </button>
        </>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// STUFE 2 — KATEGORISIERUNG: Gruppe (E/F/C/D) & Transportart
// ─────────────────────────────────────────────────────────────────────────

function Stage2Category() {
  const [round, setRound] = useState(0);
  const [score, setScore] = useState(0);
  const [mode, setMode] = useState<'group' | 'transport'>('group');
  const [answered, setAnswered] = useState(false);
  const [selected, setSelected] = useState<string | boolean | null>(null);
  const [correct, setCorrect] = useState(false);

  const term = useMemo(() => INCOTERMS[round % INCOTERMS.length], [round]);

  const groupOptions: GroupKey[] = ['E', 'F', 'C', 'D'];
  const transportOptions: { v: boolean; label: string }[] = [
    { v: true, label: 'Alle Transportarten' },
    { v: false, label: 'Nur See-/Binnenschiff' },
  ];

  const correctAnswer: string | boolean = mode === 'group' ? term.group : term.allTransport;

  const handleSelect = (val: string | boolean) => {
    if (answered) return;
    setSelected(val);
    setAnswered(true);
    const isCorrect = val === correctAnswer;
    setCorrect(isCorrect);
    if (isCorrect) setScore(s => s + 1);
  };

  const next = () => {
    setRound(r => r + 1);
    setMode(() => (round % 2 === 1 ? 'group' : 'transport'));
    setAnswered(false);
    setSelected(null);
  };

  return (
    <Card className="mb-4">
      <div className="flex justify-between items-center mb-2 gap-2">
        <h3 className="text-sm sm:text-base font-bold">
          {mode === 'group' ? 'Welcher Gruppe gehört dieser Incoterm an?' : 'Für welche Transportarten gilt dieser Incoterm?'}
        </h3>
        <span className="text-[#9ca3af] text-[13px] shrink-0">Score: {score}</span>
      </div>
      <MiniProgressBar value={round % 10} total={10} />
      <div className="bg-[#252840] rounded-xl px-4 py-3 sm:py-4 mb-4 text-xl sm:text-[22px] font-bold text-center">
        {term.code} <span className="text-[12px] sm:text-[13px] font-normal text-[#5e6173]">— {term.de}</span>
      </div>

      {mode === 'group' ? (
        <div className="grid grid-cols-2 gap-2 sm:gap-2.5">
          {groupOptions.map(gk => {
            const isSelected = selected === gk;
            const isCorrectOpt = gk === correctAnswer;
            let bg = '#252840', border = '#2d3148';
            if (answered && isCorrectOpt) { bg = 'rgba(62,207,142,0.15)'; border = '#3ecf8e'; }
            else if (answered && isSelected && !isCorrectOpt) { bg = 'rgba(229,83,75,0.15)'; border = '#e5534b'; }
            return (
              <button
                key={gk}
                onClick={() => handleSelect(gk)}
                disabled={answered}
                className="px-3 py-3 sm:px-3.5 sm:py-3.5 rounded-xl text-xs sm:text-sm font-bold transition-colors"
                style={{ border: `1px solid ${border}`, background: bg, color: GROUPS[gk].color, cursor: answered ? 'default' : 'pointer' }}
              >
                {GROUPS[gk].name}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-2.5">
          {transportOptions.map(o => {
            const isSelected = selected === o.v;
            const isCorrectOpt = o.v === correctAnswer;
            let bg = '#252840', border = '#2d3148';
            if (answered && isCorrectOpt) { bg = 'rgba(62,207,142,0.15)'; border = '#3ecf8e'; }
            else if (answered && isSelected && !isCorrectOpt) { bg = 'rgba(229,83,75,0.15)'; border = '#e5534b'; }
            return (
              <button
                key={String(o.v)}
                onClick={() => handleSelect(o.v)}
                disabled={answered}
                className="px-3.5 py-3.5 rounded-xl text-sm font-bold transition-colors"
                style={{ border: `1px solid ${border}`, background: bg, color: 'white', cursor: answered ? 'default' : 'pointer' }}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      )}

      {answered && (
        <>
          <LocalFeedback correct={correct} text={`${term.code} gehört zur ${GROUPS[term.group].name.split(' – ')[1]} und gilt für ${term.allTransport ? 'alle Transportarten' : 'nur See-/Binnenschifffahrt'}.`} />
          <button className="mt-3.5 px-5 py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white font-bold text-sm transition-colors" onClick={next}>
            Weiter →
          </button>
        </>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// STUFE 3 — INTERAKTIVE ZEITLEISTE: Risiko- & Kostenübergang anklicken
// ─────────────────────────────────────────────────────────────────────────

function InteractiveTimeline({
  onPick,
  picked,
  correctStage,
  showResult,
  dimension,
}: {
  onPick: (i: number) => void;
  picked: number | null;
  correctStage: number;
  showResult: boolean;
  dimension: 'risiko' | 'kosten';
}) {
  const n = STAGES.length;
  const color = dimension === 'risiko' ? '#e5534b' : '#f5a623';

  return (
    <div className="my-5 overflow-x-auto">
      <div className="relative h-16 min-w-[500px]">
        <div className="absolute top-[30px] left-0 right-0 h-[5px] bg-[#2d3148] rounded" />
        {showResult && (
          <div
            className="absolute top-[30px] left-0 h-[5px] rounded"
            style={{ width: `${(correctStage / (n - 1)) * 100}%`, background: color, opacity: 0.85 }}
          />
        )}
        {STAGES.map((s, i) => {
          const leftPct = (i / (n - 1)) * 100;
          const isPicked = picked === i;
          const isCorrectMark = showResult && Math.round(correctStage) === i;
          return (
            <div
              key={i}
              className="absolute top-0 text-center w-[60px] sm:w-[90px]"
              style={{ left: `${leftPct}%`, transform: 'translateX(-50%)' }}
            >
              <button
                onClick={() => !showResult && onPick(i)}
                disabled={showResult}
                title={s}
                className="w-5 h-5 sm:w-[22px] sm:h-[22px] rounded-full mt-[21px] transition-all"
                style={{
                  border: `2px solid ${isPicked ? color : isCorrectMark ? '#3ecf8e' : '#383a47'}`,
                  background: isPicked ? color : isCorrectMark ? '#3ecf8e' : '#252840',
                  cursor: showResult ? 'default' : 'pointer',
                }}
              />
              <div className="text-[8px] sm:text-[9.5px] text-[#5e6173] mt-1 leading-tight">{s}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stage3Timeline() {
  const [round, setRound] = useState(0);
  const [score, setScore] = useState(0);
  const [dimension, setDimension] = useState<'risiko' | 'kosten'>('risiko');
  const [picked, setPicked] = useState<number | null>(null);
  const [showResult, setShowResult] = useState(false);

  const term = useMemo(() => INCOTERMS[round % INCOTERMS.length], [round]);
  const correctStage = dimension === 'risiko' ? term.risikoStage : term.kostenStage;

  const check = () => {
    if (picked === null) return;
    setShowResult(true);
    if (Math.abs(picked - correctStage) <= 0.5) setScore(s => s + 1);
  };

  const next = () => {
    setRound(r => r + 1);
    setDimension(() => (round % 2 === 0 ? 'kosten' : 'risiko'));
    setPicked(null);
    setShowResult(false);
  };

  const isCorrect = showResult && picked !== null && Math.abs(picked - correctStage) <= 0.5;

  return (
    <Card className="mb-4">
      <div className="flex justify-between items-center mb-2 gap-2">
        <h3 className="text-sm sm:text-base font-bold">
          Ab wann trägt der{' '}
          <span style={{ color: dimension === 'risiko' ? '#e5534b' : '#f5a623' }}>
            {dimension === 'risiko' ? 'Käufer das Risiko' : 'Käufer die Kosten'}
          </span>
          ?
        </h3>
        <span className="text-[#9ca3af] text-[13px] shrink-0">Score: {score}</span>
      </div>
      <MiniProgressBar value={round % 10} total={10} />
      <div className="bg-[#252840] rounded-xl px-4 py-3.5 mb-1.5 text-lg sm:text-xl font-bold text-center">
        {term.code} <span className="text-[12px] sm:text-[13px] font-normal text-[#5e6173]">— {term.de}</span>
      </div>
      <p className="text-[11px] sm:text-xs text-[#9ca3af] text-center">Klick auf den Punkt in der Lieferkette, ab dem der Käufer übernimmt</p>

      <InteractiveTimeline onPick={setPicked} picked={picked} correctStage={correctStage} showResult={showResult} dimension={dimension} />

      {!showResult ? (
        <button
          className="mt-2.5 px-5 py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white font-bold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={picked === null}
          onClick={check}
        >
          Prüfen
        </button>
      ) : (
        <>
          <LocalFeedback
            correct={isCorrect}
            text={
              dimension === 'risiko'
                ? `Risikoübergang bei ${term.code}: ${STAGES[Math.round(correctStage)]}. ${term.merksatz}`
                : `Kostenübergang bei ${term.code}: ${STAGES[Math.round(correctStage)]}. ${term.merksatz}`
            }
          />
          {term.risikoStage !== term.kostenStage && (
            <div className="mt-2 text-xs text-amber-400">
              &#9888; Bei {term.code} fallen Risiko- und Kostenübergang auseinander — beide Dimensionen separat merken!
            </div>
          )}
          <button className="mt-3.5 px-5 py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white font-bold text-sm transition-colors" onClick={next}>
            Weiter →
          </button>
        </>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// STUFE 4 — DIREKTVERGLEICHE: klassische Verwechslungspaare
// ─────────────────────────────────────────────────────────────────────────

function Stage4Comparison() {
  const [round, setRound] = useState(0);
  const [score, setScore] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [answered, setAnswered] = useState(false);

  const pair = useMemo(() => shuffle(COMPARISON_PAIRS)[round % COMPARISON_PAIRS.length], [round]);
  const correct = answered && selected === pair.answer;

  const handleSelect = (code: string) => {
    if (answered) return;
    setSelected(code);
    setAnswered(true);
    if (code === pair.answer) setScore(s => s + 1);
  };

  const next = () => {
    setRound(r => r + 1);
    setSelected(null);
    setAnswered(false);
  };

  return (
    <Card className="mb-4">
      <div className="flex justify-between items-center mb-2">
        <h3 className="text-sm sm:text-base font-bold">Direktvergleich</h3>
        <span className="text-[#9ca3af] text-[13px]">Score: {score}</span>
      </div>
      <MiniProgressBar value={round % 8} total={8} />
      <div className="bg-[#252840] rounded-xl px-3 sm:px-4 py-3 sm:py-4 mb-4 text-[13px] sm:text-[15px] leading-relaxed">
        {pair.question}
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        {[pair.a, pair.b].map(code => {
          const isSelected = selected === code;
          const isCorrectOpt = code === pair.answer;
          let bg = '#252840', border = '#2d3148';
          if (answered && isCorrectOpt) { bg = 'rgba(62,207,142,0.15)'; border = '#3ecf8e'; }
          else if (answered && isSelected && !isCorrectOpt) { bg = 'rgba(229,83,75,0.15)'; border = '#e5534b'; }
          return (
            <button
              key={code}
              onClick={() => handleSelect(code)}
              disabled={answered}
              className="py-4 sm:py-[18px] rounded-xl text-base sm:text-lg font-bold transition-colors"
              style={{ border: `1px solid ${border}`, background: bg, color: 'white', cursor: answered ? 'default' : 'pointer' }}
            >
              {code}
            </button>
          );
        })}
      </div>
      {answered && (
        <>
          <LocalFeedback correct={correct} text={pair.explain} />
          <button className="mt-3.5 px-5 py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white font-bold text-sm transition-colors" onClick={next}>
            Weiter →
          </button>
        </>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// STUFE 5 — CASE-GENERATOR: zufällige Variablen-Kombinationen
// ─────────────────────────────────────────────────────────────────────────

function Stage5Cases() {
  const [round, setRound] = useState(0);
  const [score, setScore] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [answered, setAnswered] = useState(false);

  const { term, caseText, options } = useMemo(() => {
    const chosen = shuffle(INCOTERMS)[0];
    return { term: chosen, caseText: buildCase(chosen), options: buildOptions(chosen) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round]);

  const correct = answered && selected === term.code;

  const handleSelect = (code: string) => {
    if (answered) return;
    setSelected(code);
    setAnswered(true);
    if (code === term.code) setScore(s => s + 1);
  };

  const next = () => {
    setRound(r => r + 1);
    setSelected(null);
    setAnswered(false);
  };

  return (
    <Card className="mb-4">
      <div className="flex justify-between items-center mb-2">
        <h3 className="text-sm sm:text-base font-bold">Welcher Incoterm beschreibt diesen Fall?</h3>
        <span className="text-[#9ca3af] text-[13px]">Score: {score} / {round}</span>
      </div>
      <div className="bg-[#252840] rounded-xl px-3 sm:px-5 py-3 sm:py-4 mb-4 text-[13px] sm:text-[14.5px] leading-relaxed italic">
        {caseText}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:gap-2.5">
        {options.map(opt => {
          const isSelected = selected === opt.code;
          const isCorrectOpt = opt.code === term.code;
          let bg = '#252840', border = '#2d3148';
          if (answered && isCorrectOpt) { bg = 'rgba(62,207,142,0.15)'; border = '#3ecf8e'; }
          else if (answered && isSelected && !isCorrectOpt) { bg = 'rgba(229,83,75,0.15)'; border = '#e5534b'; }
          return (
            <button
              key={opt.code}
              onClick={() => handleSelect(opt.code)}
              disabled={answered}
              className="px-3 sm:px-4 py-3 sm:py-3.5 rounded-xl text-left text-sm sm:text-[15px] font-bold transition-colors"
              style={{ border: `1px solid ${border}`, background: bg, color: 'white', cursor: answered ? 'default' : 'pointer' }}
            >
              {opt.code} <span className="font-normal text-[10px] sm:text-[11.5px] text-[#9ca3af]">· {opt.de}</span>
            </button>
          );
        })}
      </div>
      {answered && (
        <>
          <LocalFeedback correct={correct} text={`${term.code} (${term.name}): ${term.merksatz}`} />
          <button className="mt-3.5 px-5 py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white font-bold text-sm transition-colors" onClick={next}>
            Nächster Fall →
          </button>
        </>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────────────────

export default function IncotermsKurs({ onClose }: ExerciseProps) {
  const [tab, setTab] = useState<'theorie' | 'uebung'>('theorie');
  const [stage, setStage] = useState(0);

  return (
    <ExerciseShell title="Incoterms 2020" subtitle="Theorie & Übungsprogression — 11 Klauseln, 6 Übungsstufen" onClose={onClose}>
      <div className="flex gap-2 justify-center mb-6 flex-wrap">
        <button
          className={`px-4 py-2.5 rounded-xl border text-sm font-semibold transition-colors ${
            tab === 'theorie'
              ? 'border-indigo-500 bg-indigo-500/15 text-indigo-400'
              : 'border-[#2d3148] bg-[#1e2130] text-[#9ca3af]'
          }`}
          onClick={() => setTab('theorie')}
        >
          Theorie
        </button>
        <button
          className={`px-4 py-2.5 rounded-xl border text-sm font-semibold transition-colors ${
            tab === 'uebung'
              ? 'border-indigo-500 bg-indigo-500/15 text-indigo-400'
              : 'border-[#2d3148] bg-[#1e2130] text-[#9ca3af]'
          }`}
          onClick={() => setTab('uebung')}
        >
          Übung
        </button>
      </div>

      {tab === 'theorie' ? (
        <TheorieView />
      ) : (
        <div>
          <StageHeader stage={stage} setStage={setStage} />
          {stage === 0 && <Stage0GroupMatch key="s0" />}
          {stage === 1 && <Stage1Matching key="s1" />}
          {stage === 2 && <Stage2Category key="s2" />}
          {stage === 3 && <Stage3Timeline key="s3" />}
          {stage === 4 && <Stage4Comparison key="s4" />}
          {stage === 5 && <Stage5Cases key="s5" />}
        </div>
      )}
    </ExerciseShell>
  );
}
