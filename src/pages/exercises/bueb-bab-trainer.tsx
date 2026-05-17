// BÜB → BAB → Kostenträger Trainer
// Tischlerei Berger KG, März — kompletter Durchlauf in 9 Phasen.
//
// Quelle: ursprünglich von Claude generiert als bueb-bab-trainer-v2.jsx
// (Light-Theme, Inline-Styles). Hier portiert auf Tailwind + Dark-Theme
// mit den shared exercise components aus _shared.tsx, damit die Übung
// optisch mit dem Rest der App harmoniert.

import { useState } from 'react';
import {
  ExerciseShell, ProgressBar, StepHeader, InfoBox, FeedbackBox, HintBox,
  NumIn, ToggleBtn, PrimaryBtn, Card, fmtEur, numFromInput,
} from './_shared';

// ─── Daten (statisches Übungsszenario) ─────────────────────────────────
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
const MEK_TISCHE = 33000, MEK_REGALE = 22000;
const FEK_TISCHE = 24000, FEK_REGALE = 16000;
const EK_TOTAL = MEK_T + FEK_T;
const GK_TOTAL = KORE - EK_TOTAL;

type KsKey = 'material' | 'fertigung' | 'verwaltung' | 'vertrieb';
const KS: KsKey[] = ['material', 'fertigung', 'verwaltung', 'vertrieb'];
const KSL: Record<KsKey, string> = { material: 'Material', fertigung: 'Fertigung', verwaltung: 'Verwaltung', vertrieb: 'Vertrieb' };

interface GkItem {
  id: string;
  name: string;
  amount: number;
  method: 'direkt' | 'schlüssel';
  pcts?: string;
  dist: Record<KsKey, number>;
}

const GK_ITEMS: GkItem[] = [
  { id: 'g1', name: 'Hilfsstoffe (Material-GK)', amount: 15000, method: 'direkt', dist: { material: 15000, fertigung: 0, verwaltung: 0, vertrieb: 0 } },
  { id: 'g2', name: 'Gehälter Verwaltung', amount: 15000, method: 'direkt', dist: { material: 0, fertigung: 0, verwaltung: 15000, vertrieb: 0 } },
  { id: 'g3', name: 'Gehälter Vertrieb', amount: 7000, method: 'direkt', dist: { material: 0, fertigung: 0, verwaltung: 0, vertrieb: 7000 } },
  { id: 'g4', name: 'Hallenmiete', amount: 10000, method: 'schlüssel', pcts: 'Mat 10%, Fert 60%, Verw 20%, Vertr 10%', dist: { material: 1000, fertigung: 6000, verwaltung: 2000, vertrieb: 1000 } },
  { id: 'g5', name: 'Energie / Strom', amount: 6000, method: 'schlüssel', pcts: 'Mat 10%, Fert 60%, Verw 10%, Vertr 20%', dist: { material: 600, fertigung: 3600, verwaltung: 600, vertrieb: 1200 } },
  { id: 'g6', name: 'Kalk. Abschreibung', amount: 9000, method: 'schlüssel', pcts: 'Mat 10%, Fert 60%, Verw 20%, Vertr 10%', dist: { material: 900, fertigung: 5400, verwaltung: 1800, vertrieb: 900 } },
  { id: 'g7', name: 'Kalk. Zinsen', amount: 5000, method: 'schlüssel', pcts: 'Mat 10%, Fert 60%, Verw 10%, Vertr 20%', dist: { material: 500, fertigung: 3000, verwaltung: 500, vertrieb: 1000 } },
  { id: 'g8', name: 'Kalk. Unternehmerlohn', amount: 5000, method: 'schlüssel', pcts: 'Fert 20%, Verw 60%, Vertr 20%', dist: { material: 0, fertigung: 1000, verwaltung: 3000, vertrieb: 1000 } },
  { id: 'g9', name: 'Kalk. Miete (Lager)', amount: 3000, method: 'direkt', dist: { material: 3000, fertigung: 0, verwaltung: 0, vertrieb: 0 } },
];

const correctKS: Record<KsKey, number> = { material: 0, fertigung: 0, verwaltung: 0, vertrieb: 0 };
GK_ITEMS.forEach(g => KS.forEach(k => { correctKS[k] += g.dist[k]; }));
const MGK = correctKS.material, FGK = correctKS.fertigung, VwGK = correctKS.verwaltung, VtGK = correctKS.vertrieb;
const HK = MEK_T + MGK + FEK_T + FGK;
const MGK_PCT = Math.round((MGK / MEK_T) * 10000) / 100;
const FGK_PCT = Math.round((FGK / FEK_T) * 10000) / 100;
const VwGK_PCT = Math.round((VwGK / HK) * 10000) / 100;
const VtGK_PCT = Math.round((VtGK / HK) * 10000) / 100;

const PHASES = [
  'klassifizierung', 'neutral', 'anderskosten', 'zusatzkosten', 'ergebnis',
  'bab_ek_gk', 'bab_verteilung', 'bab_zuschlag', 'kostentraeger',
] as const;
type Phase = typeof PHASES[number];

// ─── Sub-Komponenten (übungsspezifisch) ────────────────────────────────

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
  const [phase, setPhase] = useState<Phase>('klassifizierung');
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [fb, setFb] = useState<{ ok: boolean; msg: string } | null>(null);

  const [types, setTypes] = useState<Record<number, string>>({});
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [neutralSum, setNeutralSum] = useState<string>('');
  const [kalkVals, setKalkVals] = useState<Record<number, string>>({});
  const [diffs, setDiffs] = useState<Record<number, string>>({});
  const [diffSum, setDiffSum] = useState<string>('');
  const [zusatzVals, setZusatzVals] = useState<Record<string, string>>({});
  const [zusatzSum, setZusatzSum] = useState<string>('');
  const [koreAns, setKoreAns] = useState<string>('');
  const [ekAns, setEkAns] = useState<string>('');
  const [gkAns, setGkAns] = useState<string>('');
  const [babMeth, setBabMeth] = useState<Record<string, 'direkt' | 'schlüssel'>>({});
  const [babE, setBabE] = useState<Record<string, Partial<Record<KsKey, string>>>>({});
  const [hkAns, setHkAns] = useState<string>('');
  const [zs, setZs] = useState<Record<string, string>>({});
  const [ktV, setKtV] = useState<Record<string, string>>({});

  const go = (p: Phase) => { setPhase(p); setFb(null); };
  const ok = (k: string) => setDone(p => ({ ...p, [k]: true }));
  const clr = () => setFb(null);
  const err = (m: string) => setFb({ ok: false, msg: m });
  const suc = (m: string) => setFb({ ok: true, msg: m });

  const compKT = (mek: number, fek: number) => {
    const mgk = Math.round(mek * MGK_PCT / 100);
    const fgk = Math.round(fek * FGK_PCT / 100);
    const hk = mek + mgk + fek + fgk;
    const vw = Math.round(hk * VwGK_PCT / 100);
    const vt = Math.round(hk * VtGK_PCT / 100);
    return { mgk, fgk, hk, vwgk: vw, vtgk: vt, sk: hk + vw + vt };
  };
  const tKT = compKT(MEK_TISCHE, FEK_TISCHE);
  const rKT = compKT(MEK_REGALE, FEK_REGALE);

  const chk1 = () => {
    if (!FIBU.every(f => types[f.id])) return err('Bitte alle Positionen zuordnen.');
    const w = FIBU.filter(f => types[f.id] !== f.type);
    if (w.length) return err(`${w.length} falsch: ${w.map(x => x.name).join(', ')}`);
    suc('Alle Positionen richtig!'); ok('p1');
  };
  const chk2 = () => {
    const items = FIBU.filter(f => f.type === 'neutral');
    if (!items.every(f => reasons[f.id])) return err('Bitte alle Begründungen wählen.');
    const w = items.filter(f => reasons[f.id] !== f.reason);
    if (w.length) return err(`Falsch: ${w.map(x => x.name).join(', ')}`);
    const cs = items.reduce((s, f) => s + f.amount, 0);
    if (numFromInput(neutralSum) !== cs) return err(`Begründungen stimmen, aber Summe ${fmtEur(numFromInput(neutralSum))} ist falsch.`);
    suc(`Neutraler Aufwand: −${fmtEur(cs)}`); ok('p2');
  };
  const chk3 = () => {
    const items = FIBU.filter(f => f.type === 'anderskosten');
    for (const f of items) {
      if (numFromInput(kalkVals[f.id]) !== f.kalkValue) return err(`${f.name}: Kalk. Wert falsch.`);
      if (numFromInput(diffs[f.id]) !== (f.kalkValue! - f.amount)) return err(`${f.name}: Differenz falsch.`);
    }
    const cs = items.reduce((s, f) => s + (f.kalkValue! - f.amount), 0);
    if (numFromInput(diffSum) !== cs) return err(`Einzelwerte stimmen, aber Gesamtdifferenz ${fmtEur(numFromInput(diffSum))} falsch.`);
    suc(`Anderskosten-Differenz: +${fmtEur(cs)}`); ok('p3');
  };
  const chk4 = () => {
    const w = ZUSATZ.filter(z => numFromInput(zusatzVals[z.id]) !== z.amount);
    if (w.length) return err(`Falsch: ${w.map(z => z.name).join(', ')}`);
    const cs = ZUSATZ.reduce((s, z) => s + z.amount, 0);
    if (numFromInput(zusatzSum) !== cs) return err(`Beträge stimmen, aber Summe ${fmtEur(numFromInput(zusatzSum))} falsch.`);
    suc(`Zusatzkosten: +${fmtEur(cs)}`); ok('p4');
  };
  const chk5 = () => {
    if (numFromInput(koreAns) !== KORE) return err(`${fmtEur(numFromInput(koreAns))} ist falsch.`);
    suc(`${fmtEur(KORE)} – BÜB abgeschlossen!`); ok('p5');
  };
  const chk6 = () => {
    if (numFromInput(ekAns) !== EK_TOTAL) return err(`Einzelkosten ${fmtEur(numFromInput(ekAns))} falsch.`);
    if (numFromInput(gkAns) !== GK_TOTAL) return err(`EK stimmt! Aber GK ${fmtEur(numFromInput(gkAns))} falsch.`);
    suc(`EK: ${fmtEur(EK_TOTAL)}, GK: ${fmtEur(GK_TOTAL)}`); ok('p6');
  };
  const chk7 = () => {
    const errs: string[] = [];
    GK_ITEMS.forEach(g => {
      if (!babMeth[g.id]) { errs.push(`${g.name}: Methode fehlt`); return; }
      const isDirect = g.method === 'direkt';
      if (isDirect !== (babMeth[g.id] === 'direkt')) { errs.push(`${g.name}: Methode falsch`); return; }
      const ue = babE[g.id] || {};
      KS.forEach(k => { if (numFromInput(ue[k]) !== g.dist[k]) errs.push(`${g.name} → ${KSL[k]}`); });
    });
    if (errs.length) return err(`${errs.length} Fehler: ${errs.slice(0, 4).join(', ')}${errs.length > 4 ? '...' : ''}`);
    suc(`Verteilung korrekt! Mat: ${fmtEur(MGK)} | Fert: ${fmtEur(FGK)} | Verw: ${fmtEur(VwGK)} | Vertr: ${fmtEur(VtGK)}`);
    ok('p7');
  };
  const chk8 = () => {
    if (numFromInput(hkAns) !== HK) return err(`Herstellkosten ${fmtEur(numFromInput(hkAns))} falsch.`);
    const pairs: [string, number, string][] = [
      ['mgk', MGK_PCT, 'MGK'], ['fgk', FGK_PCT, 'FGK'], ['vwgk', VwGK_PCT, 'VwGK'], ['vtgk', VtGK_PCT, 'VtGK'],
    ];
    const w: string[] = [];
    pairs.forEach(([k, c, l]) => {
      const v = parseFloat(String(zs[k] || '').replace(',', '.'));
      if (isNaN(v) || Math.abs(v - c) > 0.15) w.push(`${l}: ${isNaN(v) ? '?' : v}% statt ${c}%`);
    });
    if (w.length) return err(`HK stimmt! Aber: ${w.join(', ')}`);
    suc('Alle Zuschlagssätze korrekt!'); ok('p8');
  };
  const chk9 = () => {
    const fields: [string, number][] = [
      ['t_mgk', tKT.mgk], ['t_fgk', tKT.fgk], ['t_hk', tKT.hk], ['t_vwgk', tKT.vwgk], ['t_vtgk', tKT.vtgk], ['t_sk', tKT.sk],
      ['r_mgk', rKT.mgk], ['r_fgk', rKT.fgk], ['r_hk', rKT.hk], ['r_vwgk', rKT.vwgk], ['r_vtgk', rKT.vtgk], ['r_sk', rKT.sk],
    ];
    const w = fields
      .filter(([k, v]) => numFromInput(ktV[k]) !== v)
      .map(([k]) => k.replace('t_', 'Tische ').replace('r_', 'Regale ').toUpperCase());
    if (w.length) return err(`${w.length} Werte falsch: ${w.slice(0, 5).join(', ')}`);
    suc(`Tische: ${fmtEur(tKT.sk)} | Regale: ${fmtEur(rKT.sk)}`); ok('p9');
  };

  const next = (nextPhase: Phase, label = 'Weiter →') => (
    <PrimaryBtn label={label} onClick={() => go(nextPhase)} color="emerald" />
  );

  const phaseIdx = PHASES.indexOf(phase);

  return (
    <ExerciseShell
      title="BÜB → BAB → Kostenträger"
      subtitle="Tischlerei Berger KG – März"
      onClose={onClose}
    >
      <ProgressBar
        phases={PHASES as readonly string[] as string[]}
        current={phaseIdx}
        groupLabel={{ left: 'BÜB', right: 'BAB + Kostenträger', splitAt: 5 }}
      />

      {/* ═══ 1: KLASSIFIZIERUNG ═══ */}
      {phase === 'klassifizierung' && (
        <div>
          <StepHeader step="1" title="Kostenarten klassifizieren" sub="Ordne jede Position zu." />
          <HintBox>
            <strong>Grundkosten:</strong> Aufwand = Kosten, 1:1 übernommen<br />
            <strong>Neutral:</strong> gehört nicht in die KoRe<br />
            <strong>Anderskosten:</strong> existiert in FIBU, wird anders bewertet
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
          {!done.p1 ? <PrimaryBtn label="Überprüfen" onClick={chk1} /> : next('neutral')}
        </div>
      )}

      {/* ═══ 2: NEUTRAL + SUMME ═══ */}
      {phase === 'neutral' && (
        <div>
          <StepHeader step="2" title="Neutrale Aufwände begründen" sub="Begründung wählen + Summe berechnen." />
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
          <SumRow label="Summe neutraler Aufwand:" prefix="−" sign="neg" value={neutralSum} onChange={v => { setNeutralSum(v); clr(); }} />
          <FeedbackBox feedback={fb} />
          {!done.p2 ? <PrimaryBtn label="Überprüfen" onClick={chk2} /> : next('anderskosten')}
        </div>
      )}

      {/* ═══ 3: ANDERSKOSTEN ═══ */}
      {phase === 'anderskosten' && (
        <div>
          <StepHeader step="3" title="Anderskosten-Differenz" sub="Kalk. Wert, Differenz UND Gesamtsumme selbst berechnen." />
          <InfoBox>
            <strong>Zusatzinfos:</strong><br />
            • Kalk. Abschreibung (Wiederbeschaffungswert): <strong>9.000 €</strong><br />
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
                    <NumIn value={kalkVals[f.id]} onChange={v => { setKalkVals(p => ({ ...p, [f.id]: v })); clr(); }} />
                  </td>
                  <td className={`${tdCls(i)} text-center`}>
                    <div className="flex items-center justify-center gap-1">
                      <span className="text-emerald-400 font-bold text-sm">+</span>
                      <NumIn value={diffs[f.id]} onChange={v => { setDiffs(p => ({ ...p, [f.id]: v })); clr(); }} width="w-20" />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          <SumRow label="Gesamte Anderskosten-Differenz:" prefix="+" sign="pos" value={diffSum} onChange={v => { setDiffSum(v); clr(); }} />
          <FeedbackBox feedback={fb} />
          {!done.p3 ? <PrimaryBtn label="Überprüfen" onClick={chk3} /> : next('zusatzkosten')}
        </div>
      )}

      {/* ═══ 4: ZUSATZKOSTEN ═══ */}
      {phase === 'zusatzkosten' && (
        <div>
          <StepHeader step="4" title="Kalkulatorische Zusatzkosten" sub="Beträge eintragen + Summe berechnen." />
          <InfoBox>
            <strong>Zusatzinfos:</strong><br />
            • Unternehmer arbeitet aktiv mit → Unternehmerlohn: <strong>5.000 €</strong><br />
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
                    <NumIn value={zusatzVals[z.id]} onChange={v => { setZusatzVals(p => ({ ...p, [z.id]: v })); clr(); }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          <SumRow label="Summe Zusatzkosten:" prefix="+" sign="pos" value={zusatzSum} onChange={v => { setZusatzSum(v); clr(); }} />
          <FeedbackBox feedback={fb} />
          {!done.p4 ? <PrimaryBtn label="Überprüfen" onClick={chk4} /> : next('ergebnis')}
        </div>
      )}

      {/* ═══ 5: ERGEBNIS ═══ */}
      {phase === 'ergebnis' && (
        <div>
          <StepHeader step="5" title="BÜB-Ergebnis" sub="Berechne die Kosten laut Kostenrechnung." />
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
                <NumIn value={koreAns} onChange={v => { setKoreAns(v); clr(); }} width="w-32" />
              </div>
            </div>
          </Card>
          <FeedbackBox feedback={fb} />
          {!done.p5 ? <PrimaryBtn label="Überprüfen" onClick={chk5} /> : next('bab_ek_gk', 'Weiter zum BAB →')}
        </div>
      )}

      {/* ═══ 6: EK / GK ═══ */}
      {phase === 'bab_ek_gk' && (
        <div>
          <StepHeader step="6" title="Einzel- & Gemeinkosten" sub="Berechne EK und GK selbst." />
          <div className="my-3 px-4 py-3 rounded-xl border bg-emerald-500/10 border-emerald-500/30 text-emerald-200 text-sm">
            ✅ BÜB fertig! Kosten laut KoRe: <strong>{fmtEur(KORE)}</strong>
          </div>
          <InfoBox>
            <strong>Einzelkosten (gegeben):</strong><br />
            Tische: MEK {fmtEur(MEK_TISCHE)} + FEK {fmtEur(FEK_TISCHE)} | Regale: MEK {fmtEur(MEK_REGALE)} + FEK {fmtEur(FEK_REGALE)}
          </InfoBox>
          <Card>
            <div className="flex justify-between items-center flex-wrap gap-2 mb-4">
              <div className="font-bold text-white text-sm">Gesamte Einzelkosten (MEK + FEK)</div>
              <NumIn value={ekAns} onChange={v => { setEkAns(v); clr(); }} width="w-32" />
            </div>
            <div className="border-t border-[#2d3148] pt-4 flex justify-between items-center flex-wrap gap-2">
              <div>
                <div className="font-bold text-white text-sm">Gemeinkosten</div>
                <div className="text-xs text-[#9ca3af]">KoRe − EK</div>
              </div>
              <NumIn value={gkAns} onChange={v => { setGkAns(v); clr(); }} width="w-32" />
            </div>
          </Card>
          <FeedbackBox feedback={fb} />
          {!done.p6 ? <PrimaryBtn label="Überprüfen" onClick={chk6} /> : next('bab_verteilung')}
        </div>
      )}

      {/* ═══ 7: BAB VERTEILUNG ═══ */}
      {phase === 'bab_verteilung' && (
        <div>
          <StepHeader step="7" title="Gemeinkosten verteilen" sub={`Verteile ${fmtEur(GK_TOTAL)} auf die 4 Kostenstellen (Euro-Beträge).`} />
          <HintBox label="📊 Verteilungsschlüssel anzeigen">
            <strong>Hallenmiete</strong> (m²): Mat 10%, Fert 60%, Verw 20%, Vertr 10%<br />
            <strong>Energie</strong> (Verbrauch): Mat 10%, Fert 60%, Verw 10%, Vertr 20%<br />
            <strong>Kalk. AfA</strong> (Anlagenwert): Mat 10%, Fert 60%, Verw 20%, Vertr 10%<br />
            <strong>Kalk. Zinsen</strong> (Kapitalbindung): Mat 10%, Fert 60%, Verw 10%, Vertr 20%<br />
            <strong>Kalk. U-Lohn</strong> (Schätzung): Fert 20%, Verw 60%, Vertr 20%
          </HintBox>
          {GK_ITEMS.map(g => {
            const m = babMeth[g.id];
            const euros = babE[g.id] || {};
            return (
              <Card key={g.id} className="mb-2">
                <div className="flex justify-between items-center mb-2 flex-wrap gap-2">
                  <span className="font-bold text-white text-sm">{g.name}</span>
                  <span className="font-mono text-[#d1d5db] text-sm">{fmtEur(g.amount)}</span>
                </div>
                <div className="flex gap-1.5 mb-2.5 flex-wrap">
                  <ToggleBtn
                    label="Direkt → eine KS"
                    active={m === 'direkt'}
                    color="blue"
                    onClick={() => { setBabMeth(p => ({ ...p, [g.id]: 'direkt' })); clr(); }}
                  />
                  <ToggleBtn
                    label="Verteilungsschlüssel"
                    active={m === 'schlüssel'}
                    color="purple"
                    onClick={() => { setBabMeth(p => ({ ...p, [g.id]: 'schlüssel' })); clr(); }}
                  />
                </div>
                {m && (
                  <div className="flex gap-2 flex-wrap">
                    {KS.map(k => (
                      <div key={k} className="flex flex-col items-center gap-0.5">
                        <span className="text-[10px] text-[#9ca3af] font-semibold">{KSL[k]}</span>
                        <NumIn
                          value={euros[k] ?? ''}
                          onChange={v => { setBabE(p => ({ ...p, [g.id]: { ...p[g.id], [k]: v } })); clr(); }}
                          width="w-20"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
          <FeedbackBox feedback={fb} />
          {!done.p7 ? <PrimaryBtn label="Überprüfen" onClick={chk7} /> : next('bab_zuschlag')}
        </div>
      )}

      {/* ═══ 8: HK + ZUSCHLAGSSÄTZE ═══ */}
      {phase === 'bab_zuschlag' && (
        <div>
          <StepHeader step="8" title="Herstellkosten & Zuschlagssätze" sub="Berechne zuerst die HK, dann die Zuschlagssätze." />
          <HintBox label="📐 Formeln anzeigen">
            <strong>HK</strong> = MEK + MGK + FEK + FGK<br /><br />
            <strong>MGK%</strong> = Material-GK ÷ MEK × 100<br />
            <strong>FGK%</strong> = Fertigungs-GK ÷ FEK × 100<br />
            <strong>VwGK%</strong> = Verwaltungs-GK ÷ HK × 100<br />
            <strong>VtGK%</strong> = Vertriebs-GK ÷ HK × 100
          </HintBox>
          <InfoBox>
            <strong>Deine BAB-Ergebnisse:</strong><br />
            MEK = {fmtEur(MEK_T)} | FEK = {fmtEur(FEK_T)}<br />
            Mat-GK = {fmtEur(MGK)} | Fert-GK = {fmtEur(FGK)} | Verw-GK = {fmtEur(VwGK)} | Vertr-GK = {fmtEur(VtGK)}
          </InfoBox>
          <Card>
            <div className="flex justify-between items-center mb-4 pb-4 border-b-2 border-[#2d3148] flex-wrap gap-2">
              <div>
                <div className="font-bold text-white">Herstellkosten (HK)</div>
                <div className="text-xs text-[#9ca3af]">MEK + MGK + FEK + FGK</div>
              </div>
              <NumIn value={hkAns} onChange={v => { setHkAns(v); clr(); }} width="w-32" />
            </div>
            {[
              { key: 'mgk', label: 'Material-GK-Zuschlag' },
              { key: 'fgk', label: 'Fertigungs-GK-Zuschlag' },
              { key: 'vwgk', label: 'Verwaltungs-GK-Zuschlag' },
              { key: 'vtgk', label: 'Vertriebs-GK-Zuschlag' },
            ].map((z, i) => (
              <div
                key={z.key}
                className={`flex justify-between items-center py-3 flex-wrap gap-2 ${i < 3 ? 'border-b border-[#2d3148]' : ''}`}
              >
                <div className="font-bold text-white text-sm">{z.label}</div>
                <div className="flex items-center gap-1">
                  <NumIn value={zs[z.key]} onChange={v => { setZs(p => ({ ...p, [z.key]: v })); clr(); }} width="w-20" />
                  <span className="font-bold text-[#d1d5db]">%</span>
                </div>
              </div>
            ))}
          </Card>
          <FeedbackBox feedback={fb} />
          {!done.p8 ? <PrimaryBtn label="Überprüfen" onClick={chk8} /> : next('kostentraeger')}
        </div>
      )}

      {/* ═══ 9: KOSTENTRÄGER ═══ */}
      {phase === 'kostentraeger' && (
        <div>
          <StepHeader step="9" title="Kostenträgerrechnung" sub="Selbstkosten für Tische und Regale berechnen." />
          <HintBox label="📐 Zuschlagssätze anzeigen">
            MGK: {MGK_PCT}% | FGK: {FGK_PCT}% | VwGK: {VwGK_PCT}% | VtGK: {VtGK_PCT}%
          </HintBox>
          {[
            { title: '🪑 Tische', mek: MEK_TISCHE, fek: FEK_TISCHE, p: 't' },
            { title: '📚 Regale', mek: MEK_REGALE, fek: FEK_REGALE, p: 'r' },
          ].map(prod => (
            <Card key={prod.p} className="mb-3">
              <div className="font-bold text-white text-base mb-3">{prod.title}</div>
              <table className="w-full border-collapse text-sm">
                <tbody>
                  {([
                    { label: 'MEK', fixed: fmtEur(prod.mek) },
                    { label: `+ MGK (${MGK_PCT}%)`, key: 'mgk' },
                    { label: 'FEK', fixed: fmtEur(prod.fek) },
                    { label: `+ FGK (${FGK_PCT}%)`, key: 'fgk' },
                    { label: '= Herstellkosten', key: 'hk', bold: true },
                    { label: `+ VwGK (${VwGK_PCT}%)`, key: 'vwgk' },
                    { label: `+ VtGK (${VtGK_PCT}%)`, key: 'vtgk' },
                    { label: '= Selbstkosten', key: 'sk', bold: true, final: true },
                  ] as Array<{ label: string; fixed?: string; key?: string; bold?: boolean; final?: boolean }>).map((row, i) => (
                    <tr
                      key={i}
                      className={
                        row.final ? 'bg-emerald-500/10' : row.bold ? 'bg-[#252840]' : ''
                      }
                    >
                      <td className={`px-3 py-2 border-b border-[#2d3148] ${row.bold ? 'font-bold text-white' : 'text-[#d1d5db]'} ${row.final ? 'text-base' : ''}`}>
                        {row.label}
                      </td>
                      <td className="px-3 py-2 border-b border-[#2d3148] text-right">
                        {row.fixed ? (
                          <span className="font-mono text-[#d1d5db]">{row.fixed}</span>
                        ) : (
                          <NumIn
                            value={ktV[`${prod.p}_${row.key}`]}
                            onChange={v => { setKtV(p => ({ ...p, [`${prod.p}_${row.key}`]: v })); clr(); }}
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
            <PrimaryBtn label="Überprüfen" onClick={chk9} />
          ) : (
            <div className="my-3 px-4 py-3 rounded-xl border bg-emerald-500/10 border-emerald-500/30 text-emerald-200 text-sm leading-relaxed">
              🎉 <strong>Geschafft!</strong> Kompletter Weg BÜB → BAB → Kostenträger durchgerechnet!<br /><br />
              Tische: <strong>{fmtEur(tKT.sk)}</strong> | Regale: <strong>{fmtEur(rKT.sk)}</strong> | Kontrolle: <strong>{fmtEur(tKT.sk + rKT.sk)} = {fmtEur(KORE)}</strong> ✓
            </div>
          )}
        </div>
      )}
    </ExerciseShell>
  );
}
