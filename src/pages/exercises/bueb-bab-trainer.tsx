// BÜB → BAB → Kostenträger Trainer (v3)
// Tischlerei Berger KG, März — 9 klickbare Phasen.
//
// Verbesserungen ggü. v2:
//   • Klickbare Step-Navigation (StepNav statt linear ProgressBar)
//   • Schritt 7 redesigned: zwei-Layer-Entscheidung Direkt/Schlüssel →
//     KS/Verteilungsbasis. Euro-Beträge werden nicht mehr eingegeben,
//     sondern nach erfolgreicher Klassifizierung in einer Übersichts-
//     Tabelle automatisch dargestellt.
//   • Toleranz beim Check für Step 8 + 9 (Rundungs-Slack: ±0.5 % bzw.
//     ±200 € für Euros, <1 % Abweichung für Prozente).
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
  target?: KsKey;             // wenn isDirekt: welche KS
  basis?: BasisKey;           // wenn !isDirekt: welcher Verteilungsschlüssel
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

// Toleranz: Rundungsfehler bei Euro (±0.5 % oder ±200 €) bzw. Prozent (<1 %)
const closeEur = (a: number, b: number) => Math.abs(a - b) <= Math.max(Math.abs(b) * 0.005, 200);
const closePct = (a: number, b: number) => Math.abs(a - b) < 1;

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

// ─── kleine UI-Helfer (übungsspezifisch) ──────────────────────────────
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

// ─── Hauptkomponente ───────────────────────────────────────────────────

export default function BuebBabTrainer({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<StepId>('p1');
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [fb, setFb] = useState<{ ok: boolean; msg: string } | null>(null);

  const [types, setTypes] = useState<Record<number, string>>({});
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [nSum, setNSum] = useState<string>('');
  const [kV, setKV] = useState<Record<number, string>>({});
  const [dV, setDV] = useState<Record<number, string>>({});
  const [dSum, setDSum] = useState<string>('');
  const [zV, setZV] = useState<Record<string, string>>({});
  const [zSum, setZSum] = useState<string>('');
  const [koreA, setKoreA] = useState<string>('');
  const [ekA, setEkA] = useState<string>('');
  const [gkA, setGkA] = useState<string>('');
  // Step 7 — drei separate State-Maps, eine pro Layer
  const [babType, setBabType] = useState<Record<string, 'direkt' | 'schlüssel'>>({});
  const [babTarget, setBabTarget] = useState<Record<string, KsKey>>({});
  const [babBasis, setBabBasis] = useState<Record<string, BasisKey>>({});
  const [hkA, setHkA] = useState<string>('');
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

  // ─── Checks ─────────────────────────────────────────────────────────
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
    if (numFromInput(nSum) !== s) return err('Begründungen stimmen, aber Summe falsch.');
    suc(`Neutraler Aufwand: −${fmtEur(s)}`); ok('p2');
  };
  const c3 = () => {
    const it = FIBU.filter(f => f.type === 'anderskosten');
    for (const f of it) {
      if (numFromInput(kV[f.id]) !== f.kalkValue) return err(`${f.name}: Kalk. Wert falsch.`);
      if (numFromInput(dV[f.id]) !== (f.kalkValue! - f.amount)) return err(`${f.name}: Differenz falsch.`);
    }
    const s = it.reduce((a, f) => a + (f.kalkValue! - f.amount), 0);
    if (numFromInput(dSum) !== s) return err('Einzelwerte stimmen, Gesamtdifferenz falsch.');
    suc(`Anderskosten-Differenz: +${fmtEur(s)}`); ok('p3');
  };
  const c4 = () => {
    const w = ZUSATZ.filter(z => numFromInput(zV[z.id]) !== z.amount);
    if (w.length) return err(`Falsch: ${w.map(z => z.name).join(', ')}`);
    const s = ZUSATZ.reduce((a, z) => a + z.amount, 0);
    if (numFromInput(zSum) !== s) return err('Beträge stimmen, Summe falsch.');
    suc(`Zusatzkosten: +${fmtEur(s)}`); ok('p4');
  };
  const c5 = () => {
    if (numFromInput(koreA) !== KORE) return err(`${fmtEur(numFromInput(koreA))} ist falsch.`);
    suc(`${fmtEur(KORE)} – BÜB abgeschlossen!`); ok('p5');
  };
  const c6 = () => {
    if (numFromInput(ekA) !== EK_T) return err('Einzelkosten falsch.');
    if (numFromInput(gkA) !== GK_T) return err('EK stimmt! GK falsch.');
    suc(`EK: ${fmtEur(EK_T)}, GK: ${fmtEur(GK_T)}`); ok('p6');
  };
  const c7 = () => {
    const errs: string[] = [];
    GK_ITEMS.forEach(g => {
      const typ = babType[g.id];
      if (!typ) { errs.push(`${g.name}: Methode fehlt`); return; }
      if (g.isDirekt && typ !== 'direkt') { errs.push(`${g.name}: Sollte direkt zugeordnet werden`); return; }
      if (!g.isDirekt && typ !== 'schlüssel') { errs.push(`${g.name}: Braucht einen Verteilungsschlüssel`); return; }
      if (g.isDirekt) {
        if (babTarget[g.id] !== g.target) { errs.push(`${g.name}: Falsche Kostenstelle`); }
      } else {
        if (babBasis[g.id] !== g.basis) { errs.push(`${g.name}: Falscher Schlüssel`); }
      }
    });
    if (errs.length) return err(errs.slice(0, 4).join(' · ') + (errs.length > 4 ? ` · +${errs.length - 4} weitere` : ''));
    suc(`Alles richtig! Mat: ${fmtEur(MGK)} | Fert: ${fmtEur(FGK)} | Verw: ${fmtEur(VwGK)} | Vertr: ${fmtEur(VtGK)}`);
    ok('p7');
  };
  const c8 = () => {
    if (!closeEur(numFromInput(hkA), HK_VAL)) return err('Herstellkosten falsch.');
    const w: string[] = [];
    ([['mgk', MGK_P, 'MGK'], ['fgk', FGK_P, 'FGK'], ['vwgk', VwGK_P, 'VwGK'], ['vtgk', VtGK_P, 'VtGK']] as const).forEach(([k, c, l]) => {
      const v = parseFloat(String(zsA[k] || '').replace(',', '.'));
      if (isNaN(v) || !closePct(v, c)) w.push(l);
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
    if (w.length) return err(`${w.length} Werte falsch.`);
    suc(`Tische: ${fmtEur(tK.sk)} | Regale: ${fmtEur(rK.sk)}`); ok('p9');
  };

  const next = (nextId: StepId, label = 'Weiter →') => (
    <PrimaryBtn label={label} onClick={() => go(nextId)} color="emerald" />
  );

  // ─── Step 7 GK Card ─────────────────────────────────────────────────
  function GKCard({ g }: { g: GkItem }) {
    const typ = babType[g.id];
    const tgt = babTarget[g.id];
    const bas = babBasis[g.id];

    return (
      <Card className="mb-2.5">
        {/* Header */}
        <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
          <span className="font-bold text-white text-sm">{g.name}</span>
          <span className="font-mono text-[#d1d5db] text-sm">{fmtEur(g.amount)}</span>
        </div>

        {/* Layer 1 */}
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

        {/* Layer 2a: Direkt → welche KS */}
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

        {/* Layer 2b: Schlüssel → welche Basis */}
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
    <ExerciseShell
      title="BÜB → BAB → Kostenträger"
      subtitle="Tischlerei Berger KG – März"
      onClose={onClose}
    >
      <StepNav
        steps={STEPS}
        current={step}
        done={done}
        onSelect={(id) => go(id as StepId)}
        groupLabels={{ left: 'BÜB', right: 'BAB + Kostenträger', splitAt: 5 }}
      />

      {/* ═══ P1 ═══ */}
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

      {/* ═══ P2 ═══ */}
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

      {/* ═══ P3 ═══ */}
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

      {/* ═══ P4 ═══ */}
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

      {/* ═══ P5 ═══ */}
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

      {/* ═══ P6 ═══ */}
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

      {/* ═══ P7 ═══ */}
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

      {/* ═══ P8 ═══ */}
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

      {/* ═══ P9 ═══ */}
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
    </ExerciseShell>
  );
}
