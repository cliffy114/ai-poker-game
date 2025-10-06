
// ====== Language Switch Injection Start ======
import React, { useState } from 'react';

const translations = {
  zh: {
    title: "斗地主 · Fight the Landlord",
    matchSettings: "对局设置",
    enablePairing: "启用对局",
    rounds: "局数",
    initialScore: "初始分",
    possibleLandlord: "可抢地主",
    rule: "规则",
    aiSettings: "每家 AI 设置（独立）",
    select: "选择",
    minInterval: "最小间隔 (ms)",
    thinkTime: "弃牌时间 (秒)",
    rating: "天梯积分（活动积分 AR）",
  },
  en: {
    title: "Fight the Landlord",
    matchSettings: "Match Settings",
    enablePairing: "Enable Match",
    rounds: "Rounds",
    initialScore: "Initial Score",
    possibleLandlord: "Landlord Mode",
    rule: "Rule",
    aiSettings: "Each AI Settings (Independent)",
    select: "Select",
    minInterval: "Min Interval (ms)",
    thinkTime: "Discard Time (s)",
    rating: "Rating (Active Rating AR)",
  },
};
// ====== Language Switch Injection End ======
// pages/index.tsx
import { useEffect, useRef, useState } from 'react';

type Four2Policy = 'both' | '2singles' | '2pairs';
type BotChoice =
  | 'built-in:greedy-max'
  | 'built-in:greedy-min'
  | 'built-in:random-legal'
  | 'built-in:mininet'
  | 'built-in:ally-support'
  | 'built-in:endgame-rush'
  | 'ai:openai' | 'ai:gemini' | 'ai:grok' | 'ai:kimi' | 'ai:qwen' | 'ai:deepseek'
  | 'http';

/* ========= TrueSkill（前端轻量实现，1v2：地主 vs 两农民） ========= */
type Rating = { mu:number; sigma:number };
const TS_DEFAULT: Rating = { mu:25, sigma:25/3 };
const TS_BETA = 25/6;
const TS_TAU  = 25/300;
const SQRT2 = Math.sqrt(2);
function erf(x:number){
  const [lang, setLang] = useState<'zh' | 'en'>('zh');
  const t = (key: keyof typeof translations['zh']) => translations[lang][key];
 const s=Math.sign(x); const a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=0.3275911; const t=1/(1+p*Math.abs(x)); const y=1-(((((a5*t+a4)*t+a3)*t+a2)*t+a1)*t)*Math.exp(-x*x); return s*y; }
function phi(x:number){ return Math.exp(-0.5*x*x)/Math.sqrt(2*Math.PI); }
function Phi(x:number){ return 0.5*(1+erf(x/SQRT2)); }
function V_exceeds(t:number){ const d=Math.max(1e-12,Phi(t)); return phi(t)/d; }
function W_exceeds(t:number){ const v=V_exceeds(t); return v*(v+t); }
function tsUpdateTwoTeams(r:Rating[], teamA:number[], teamB:number[]){
  const varA = teamA.reduce((s,i)=>s+r[i].sigma**2,0), varB = teamB.reduce((s,i)=>s+r[i].sigma**2,0);
  const muA  = teamA.reduce((s,i)=>s+r[i].mu,0),     muB  = teamB.reduce((s,i)=>s+r[i].mu,0);
  const c2   = varA + varB + 2*TS_BETA*TS_BETA;
  const c    = Math.sqrt(c2);
  const t    = (muA - muB) / c;
  const v = V_exceeds(t), w = W_exceeds(t);
  for (const i of teamA) {
    const sig2=r[i].sigma**2, mult=sig2/c, mult2=sig2/c2;
    r[i].mu += mult*v;
    r[i].sigma = Math.sqrt(Math.max(1e-6, sig2*(1 - w*mult2)) + TS_TAU*TS_TAU);
  }
  for (const i of teamB) {
    const sig2=r[i].sigma**2, mult=sig2/c, mult2=sig2/c2;
    r[i].mu -= mult*v;
    r[i].sigma = Math.sqrt(Math.max(1e-6, sig2*(1 - w*mult2)) + TS_TAU*TS_TAU);
  }
}

/* ===== TrueSkill 本地存档（新增） ===== */
type TsRole = 'landlord'|'farmer';
type TsStoreEntry = {
  id: string;                 // 身份（详见 seatIdentity）
  label?: string;
  overall?: Rating | null;    // 总体
  roles?: {                   // 角色分档
    landlord?: Rating | null;
    farmer?: Rating | null;
  };
  meta?: { choice?: string; model?: string; httpBase?: string };
};
type TsStore = {
  schema: 'ddz-trueskill@1';
  updatedAt: string;
  players: Record<string, TsStoreEntry>;
};
const TS_STORE_KEY = 'ddz_ts_store_v1';

const ensureRating = (x:any): Rating => {
  const mu = Number(x?.mu), sigma = Number(x?.sigma);
  if (Number.isFinite(mu) && Number.isFinite(sigma)) return { mu, sigma };
  return { ...TS_DEFAULT };
};
const emptyStore = (): TsStore => ({ schema:'ddz-trueskill@1', updatedAt:new Date().toISOString(), players:{} });
const readStore = (): TsStore => {
  try { const raw = localStorage.getItem(TS_STORE_KEY); if (!raw) return emptyStore();
    const j = JSON.parse(raw); if (j?.schema && j?.players) return j as TsStore;
  } catch {}
  return emptyStore();
};
const writeStore = (s: TsStore) => { try { s.updatedAt=new Date().toISOString(); localStorage.setItem(TS_STORE_KEY, JSON.stringify(s)); } catch {} };

/* ====== 其它 UI/逻辑 ====== */
type LiveProps = {
  rounds: number;
  startScore: number;
  
  seatDelayMs?: number[];
  enabled: boolean;
  rob: boolean;
  four2: Four2Policy;
  seats: BotChoice[];
  seatModels: string[];
  seatKeys: {
    openai?: string; gemini?: string; grok?: string; kimi?: string; qwen?: string; deepseek?: string;
    httpBase?: string; httpToken?: string;
  }[];
  farmerCoop: boolean;
  onTotals?: (totals:[number,number,number]) => void;
  onLog?: (lines: string[]) => void;
  turnTimeoutSecs?: number[];};

function SeatTitle({ i }: { i:number }) {
  return <span style={{ fontWeight:700 }}>{['甲','乙','丙'][i]}</span>;
}

type SuitSym = '♠'|'♥'|'♦'|'♣'|'🃏';
const SUITS: SuitSym[] = ['♠','♥','♦','♣'];
const seatName = (i:number)=>['甲','乙','丙'][i] || String(i);

const rankOf = (l: string) => {
  if (!l) return '';
  const c0 = l[0];
  if ('♠♥♦♣'.includes(c0)) return l.slice(1).replace(/10/i, 'T').toUpperCase();
  if (c0 === '🃏') return (
      {/* ===== Language Switch Button ===== */}
      <div style={{ textAlign: 'right', marginBottom: 10 }}>
        <button
          onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
          style={{
            padding: '6px 12px',
            borderRadius: '6px',
            border: '1px solid #ccc',
            background: '#f9f9f9',
            cursor: 'pointer',
          }}
        >
          🌐 {lang === 'zh' ? '中文 | English' : 'English | 中文'}
        </button>
      </div>
l.slice(2) || 'X').replace(/10/i, 'T').toUpperCase();
  return l.replace(/10/i, 'T').toUpperCase();
};
function candDecorations(l: string): string[] {
  if (!l) return [];
  if (l === 'x') return ['🃏X'];
  if (l === 'X') return ['🃏Y'];
  if (l.startsWith('🃏')) return [l];
  if ('♠♥♦♣'.includes(l[0])) return [l];
  const r = rankOf(l);
  if (r === 'JOKER') return ['🃏Y'];
  return SUITS.map(s => `${s}${r}`);
}
function decorateHandCycle(raw: string[]): string[] {
  let idx = 0;
  return raw.map(l => {
    if (!l) return l;
    if (l === 'x') return '🃏X';
    if (l === 'X') return '🃏Y';
    if (l.startsWith('🃏')) return l;
    if ('♠♥♦♣'.includes(l[0])) return l;
    const suit = SUITS[idx % SUITS.length]; idx++;
    return `${suit}${rankOf(l)}`;
  });
}

function Card({ label }: { label:string }) {
  const suit = label.startsWith('🃏') ? '🃏' : label.charAt(0);
  const baseColor = (suit === '♥' || suit === '♦') ? '#af1d22' : '#1a1a1a';
  const rank = label.startsWith('🃏') ? (label.slice(2) || '') : label.slice(1);
  const rankColor = suit === '🃏' ? (rank === 'Y' ? '#d11' : '#16a34a') : undefined;
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', gap:6,
      border:'1px solid #ddd', borderRadius:8, padding:'6px 10px',
      marginRight:6, marginBottom:6, fontWeight:800, color: baseColor
    }}>
      <span style={{ fontSize:16 }}>{suit}</span>
      <span style={{ fontSize:16, ...(rankColor ? { color: rankColor } : {}) }}>{rank === 'T' ? '10' : rank}</span>
    </span>
  );
}
function Hand({ cards }: { cards: string[] }) {
  if (!cards || cards.length === 0) return <span style={{ opacity: 0.6 }}>（空）</span>;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap' }}>
      {cards.map((c, idx) => <Card key={`${c}-${idx}`} label={c} />)}
    </div>
  );
}
function PlayRow({ seat, move, cards, reason }:{
  seat:number; move:'play'|'pass'; cards?:string[]; reason?:string
}) {
  return (
    <div style={{ display:'flex', gap:8, alignItems:'center', padding:'6px 0' }}>
      <div style={{ width:32, textAlign:'right', opacity:0.8 }}>{seatName(seat)}</div>
      <div style={{ width:56, fontWeight:700 }}>{move === 'pass' ? '过' : '出牌'}</div>
      <div style={{ flex:1 }}>
        {move === 'pass' ? <span style={{ opacity:0.6 }}>过</span> : <Hand cards={cards || []} />}
      </div>
      {reason && <div style={{ width:260, fontSize:12, color:'#666' }}>{reason}</div>}
    </div>
  );
}
function LogLine({ text }: { text:string }) {
  return (
    <div style={{ fontFamily:'ui-monospace,Menlo,Consolas,monospace', fontSize:12, color:'#555', padding:'2px 0' }}>
      {text}
    </div>
  );
}

/* ===== 天梯图组件（x=ΔR_event，y=各 AI/内置；含未参赛=历史或0） ===== */
function LadderPanel() {
  const [tick, setTick] = useState(0);
  useEffect(()=>{
    const onAny = () => setTick(k=>k+1);
    if (typeof window !== 'undefined') {
      window.addEventListener('ddz-all-refresh', onAny as any);
    }
    const t = setInterval(onAny, 2000);
    return ()=> { if (typeof window!=='undefined') window.removeEventListener('ddz-all-refresh', onAny as any); clearInterval(t); };
  }, []);

  let store:any = { players:{} };
  try {
    if (typeof window !== 'undefined') {
      const raw = localStorage.getItem('ddz_ladder_store_v1');
      if (raw) store = JSON.parse(raw) || { players:{} };
    }
  } catch {}

  const CATALOG = [
    'built-in:greedy-max','built-in:greedy-min','built-in:random-legal','built-in:mininet','built-in:ally-support','built-in:endgame-rush',
    'ai:openai','ai:gemini','ai:grok','ai:kimi','ai:qwen','ai:deepseek','http'
  ];
  const catalogIds = CATALOG.map((choice)=>{
    const model = defaultModelFor(choice as any) || '';
    const base  = (choice === 'http') ? '' : '';
    return `${choice}|${model}|${base}`;
  });
  const catalogLabels = (id:string)=>{
    const [choice, model] = id.split('|');
    const label = choiceLabel(choice as any);
    if (choice.startsWith('ai:')) return `${label}:${model||defaultModelFor(choice as any)}`;
    return label;
  };

  const players: Record<string, any> = (store?.players)||{};
  const keys = Array.from(new Set([...Object.keys(players), ...catalogIds]));
  const arr = keys.map((id)=>{
    const ent = players[id];
    const val = ent?.current?.deltaR ?? 0;
    const n   = ent?.current?.n ?? 0;
    const label = ent?.label || catalogLabels(id) || id;
    return { id, label, val, n };
  });

  const K = Math.max(1, ...arr.map(x=> (players[x.id]?.current?.K ?? 20)), 20);
  const items = arr.sort((a,b)=> b.val - a.val);

  const axisStyle:any = { position:'absolute', left:'50%', top:0, bottom:0, width:1, background:'#e5e7eb' };

  return (
    <div style={{ border:'1px dashed #e5e7eb', borderRadius:8, padding:10, marginTop:10 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
        <div style={{ fontWeight:700 }}>天梯图（活动积分 ΔR）</div>
        <div style={{ fontSize:12, color:'#6b7280' }}>范围 ±K（按局面权重加权，当前 K≈{K}；未参赛=历史或0）</div>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'240px 1fr 56px', gap:8 }}>
        {items.map((it:any)=>{
          const pct = Math.min(1, Math.abs(it.val)/K);
          const pos = it.val >= 0;
          return (
            <div key={it.id} style={{ display:'contents' }}>
              <div style={{ whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{it.label}</div>
              <div style={{ position:'relative', height:16, background:'#f9fafb', border:'1px solid #f3f4f6', borderRadius:8 }}>
                <div style={axisStyle} />
                <div style={{ position:'absolute', left: pos ? '50%' : `${50 - pct*50}%`, width: `${pct*50}%`, top:2, bottom:2, background: pos ? '#16a34a' : '#ef4444', borderRadius:6 }}/>
              </div>
              <div style={{ fontFamily:'ui-monospace,Menlo,Consolas,monospace', textAlign:'right' }}>{it.val.toFixed(2)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
function Section({ title, children }:{title:string; children:React.ReactNode}) {
  return (
    <div style={{ marginBottom:16 }}>
      <div style={{ fontWeight:700, marginBottom:8 }}>{title}</div>
      <div>{children}</div>
    </div>
  );
}

/* ====== 模型预设/校验 ====== */
function defaultModelFor(choice: BotChoice): string {
  switch (choice) {
    case 'ai:openai': return 'gpt-4o-mini';
    case 'ai:gemini': return 'gemini-1.5-flash';
    case 'ai:grok':  return 'grok-2-latest';
    case 'ai:kimi':  return 'kimi-k2-0905-preview';
    case 'ai:qwen':  return 'qwen-plus';
    case 'ai:deepseek': return 'deepseek-chat';
    default: return '';
  }
}
function normalizeModelForProvider(choice: BotChoice, input: string): string {
  const m = (input || '').trim(); if (!m) return '';
  const low = m.toLowerCase();
  switch (choice) {
    case 'ai:kimi':   return /^kimi[-\w]*/.test(low) ? m : '';
    case 'ai:openai': return /^(gpt-|o[34]|text-|omni)/.test(low) ? m : '';
    case 'ai:gemini': return /^gemini[-\w.]*/.test(low) ? m : '';
    case 'ai:grok':   return /^grok[-\w.]*/.test(low) ? m : '';
    case 'ai:qwen':   return /^qwen[-\w.]*/.test(low) ? m : '';
    case 'ai:deepseek': return /^deepseek[-\w.]*/.test(low) ? m : '';
    default: return '';
  }
}
function choiceLabel(choice: BotChoice): string {
  switch (choice) {
    case 'built-in:greedy-max':   return 'Greedy Max';
    case 'built-in:greedy-min':   return 'Greedy Min';
    case 'built-in:random-legal': return 'Random Legal';
    case 'built-in:mininet':      return 'MiniNet';
    case 'built-in:ally-support': return 'AllySupport';
    case 'built-in:endgame-rush': return 'EndgameRush';
    case 'ai:openai':             return 'OpenAI';
    case 'ai:gemini':             return 'Gemini';
    case 'ai:grok':               return 'Grok';
    case 'ai:kimi':               return 'Kimi';
    case 'ai:qwen':               return 'Qwen';
    case 'ai:deepseek':           return 'DeepSeek';
    case 'http':                  return 'HTTP';
    default: return String(choice);
  }
}
/* ====== 雷达图累计（0~5） ====== */
type Score5 = { coop:number; agg:number; cons:number; eff:number; rob:number };
function mergeScore(prev: Score5, curr: Score5, mode: 'mean'|'ewma', count:number, alpha:number): Score5 {
  if (mode === 'mean') {
    const c = Math.max(0, count);
    return {
      coop: (prev.coop*c + curr.coop)/(c+1),
      agg:  (prev.agg *c + curr.agg )/(c+1),
      cons: (prev.cons*c + curr.cons)/(c+1),
      eff:  (prev.eff *c + curr.eff )/(c+1),
      rob:  (prev.rob *c + curr.rob )/(c+1),
    };
  }
  const a = Math.min(0.95, Math.max(0.05, alpha || 0.35));
  return {
    coop: a*curr.coop + (1-a)*prev.coop,
    agg:  a*curr.agg  + (1-a)*prev.agg,
    cons: a*curr.cons + (1-a)*prev.cons,
    eff:  a*curr.eff  + (1-a)*prev.eff,
    rob:  a*curr.rob  + (1-a)*prev.rob,
  };
}
/* ---------- 文本改写：把“第 x 局”固定到本局 ---------- */
const makeRewriteRoundLabel = (n: number) => (msg: string) => {
  if (typeof msg !== 'string') return msg;
  let out = msg;
  out = out.replace(/第\s*\d+\s*局开始/g, `第 ${n} 局开始`);
  out = out.replace(/开始第\s*\d+\s*局（/g, `开始第 ${n} 局（`);
  out = out.replace(/开始第\s*\d+\s*局\(/g,  `开始第 ${n} 局(`);
  out = out.replace(/开始连打\s*\d+\s*局（/g, `开始第 ${n} 局（`);
  out = out.replace(/开始连打\s*\d+\s*局\(/g,  `开始第 ${n} 局(`);
  out = out.replace(/单局模式.*?(仅运行|运行)\s*\d+\s*局（/g, `单局模式：开始第 ${n} 局（`);
  out = out.replace(/单局模式.*?(仅运行|运行)\s*\d+\s*局\(/g,  `单局模式：开始第 ${n} 局(`);
  return out;
};

/* ==================== LivePanel（对局） ==================== */
function LivePanel(props: LiveProps) {
  const [running, setRunning] = useState(false);

  const [hands, setHands] = useState<string[][]>([[],[],[]]);
  const [landlord, setLandlord] = useState<number|null>(null);
  const [plays, setPlays] = useState<{seat:number; move:'play'|'pass'; cards?:string[]; reason?:string}[]>([]);
  const [multiplier, setMultiplier] = useState(1);
  const [winner, setWinner] = useState<number|null>(null);
  const [delta, setDelta] = useState<[number,number,number] | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [totals, setTotals] = useState<[number,number,number]>([
    props.startScore || 0, props.startScore || 0, props.startScore || 0,
  ]);
  const [finishedCount, setFinishedCount] = useState(0);
  // —— 每手牌得分（动态曲线）+ 分局切割与地主 ——
  const [scoreSeries, setScoreSeries] = useState<(number|null)[][]>([[],[],[]]);
  const scoreSeriesRef = useRef(scoreSeries); useEffect(()=>{ scoreSeriesRef.current = scoreSeries; }, [scoreSeries]);
  const [roundCuts, setRoundCuts] = useState<number[]>([0]);
  const roundCutsRef = useRef(roundCuts); useEffect(()=>{ roundCutsRef.current = roundCuts; }, [roundCuts]);

  const [roundLords, setRoundLords] = useState<number[]>([]);

  /* ====== 评分统计（每局） ====== */
  type SeatStat = { rounds:number; overallAvg:number; lastAvg:number; best:number; worst:number; mean:number; sigma:number };
  const [scoreStats, setScoreStats] = useState<SeatStat[]>([
    { rounds:0, overallAvg:0, lastAvg:0, best:0, worst:0, mean:0, sigma:0 },
    { rounds:0, overallAvg:0, lastAvg:0, best:0, worst:0, mean:0, sigma:0 },
    { rounds:0, overallAvg:0, lastAvg:0, best:0, worst:0, mean:0, sigma:0 },
  ]);
  const [scoreDists, setScoreDists] = useState<number[][]>([[],[],[]]);
  const statsFileRef = useRef<HTMLInputElement|null>(null);
  const roundLordsRef = useRef(roundLords); useEffect(()=>{ roundLordsRef.current = roundLords; }, [roundLords]);

  // 依据 scoreSeries（每手评分）与 roundCuts（每局切点）计算每局均值，并汇总到席位统计
  const recomputeScoreStats = () => {
    try {
      const series = scoreSeriesRef.current;   // number[][]
      const cuts = roundCutsRef.current;       // number[]
      const n = Math.max(series[0]?.length||0, series[1]?.length||0, series[2]?.length||0);
      const bands = (cuts && cuts.length ? [...cuts] : [0]).sort((a,b)=>a-b);
      if (bands[0] !== 0) bands.unshift(0);
      if (bands[bands.length-1] !== n) bands.push(n);
      const perSeatRounds:number[][] = [[],[],[]];
      for (let b=0;b<bands.length-1;b++){
        const st = bands[b], ed = bands[b+1];
        const len = Math.max(0, ed - st);
        if (len <= 0) continue;
        for (let s=0;s<3;s++){
          const arr = series[s]||[];
          let sum = 0, cnt = 0;
          for (let i=st;i<ed;i++){
            const v = arr[i];
            if (typeof v === 'number') { sum += v; cnt++; }
          }
          if (cnt>0) perSeatRounds[s].push(sum/cnt);
        }
      }
      const stats = [0,1,2].map(s=>{
        const rs = perSeatRounds[s];
        const rounds = rs.length;
        if (rounds===0) return { rounds:0, overallAvg:0, lastAvg:0, best:0, worst:0, mean:0, sigma:0 };
        const sum = rs.reduce((a,b)=>a+b,0);
        const overall = sum/rounds;
        const last = rs[rounds-1];
        const best = Math.max(...rs);
        const worst = Math.min(...rs);
        const mu = overall;
        const varv = rs.reduce((a,b)=>a + (b-mu)*(b-mu), 0) / rounds;
        const sigma = Math.sqrt(Math.max(0, varv));
        return { rounds, overallAvg: overall, lastAvg: last, best, worst, mean: mu, sigma };
      });
      setScoreStats(stats);
      setScoreDists(perSeatRounds);
    } catch (e) { console.error('[stats] recompute error', e); }
  }
  // 每局结束或数据变化时刷新统计
  useEffect(()=>{ recomputeScoreStats(); }, [roundCuts, scoreSeries]);

  // 每局结束或数据变化时刷新统计
  useEffect(()=>{ recomputeScoreStats(); }, [roundCuts, scoreSeries]);

  // 每局结束或数据变化时刷新统计
  useEffect(()=>{ recomputeScoreStats(); }, [roundCuts, scoreSeries]);
;
  // —— TrueSkill（前端实时） —— //
  const [tsArr, setTsArr] = useState<Rating[]>([{...TS_DEFAULT},{...TS_DEFAULT},{...TS_DEFAULT}]);
  const tsRef = useRef(tsArr); useEffect(()=>{ tsRef.current=tsArr; }, [tsArr]);
  const tsCr = (r:Rating)=> (r.mu - 3*r.sigma);

  // ===== 新增：TS 存档（读/写/应用） =====
  const tsStoreRef = useRef<TsStore>(emptyStore());
  useEffect(()=>{ try { tsStoreRef.current = readStore(); } catch {} }, []);
  const fileRef = useRef<HTMLInputElement|null>(null);

  const seatIdentity = (i:number) => {
    const choice = props.seats[i];
    const model = normalizeModelForProvider(choice, props.seatModels[i] || '') || defaultModelFor(choice);
    const base = choice === 'http' ? (props.seatKeys[i]?.httpBase || '') : '';
    return `${choice}|${model}|${base}`; // 身份锚定
  };

  const resolveRatingForIdentity = (id: string, role?: TsRole): Rating | null => {
    const p = tsStoreRef.current.players[id]; if (!p) return null;
    if (role && p.roles?.[role]) return ensureRating(p.roles[role]);
    if (p.overall) return ensureRating(p.overall);
    const L = p.roles?.landlord, F = p.roles?.farmer;
    if (L && F) return { mu:(L.mu+F.mu)/2, sigma:(L.sigma+F.sigma)/2 };
    if (L) return ensureRating(L);
    if (F) return ensureRating(F);
    return null;
  };

  const applyTsFromStore = (why:string) => {
    const ids = [0,1,2].map(seatIdentity);
    const init = ids.map(id => resolveRatingForIdentity(id) || { ...TS_DEFAULT });
    setTsArr(init);
    setLog(l => [...l, `【TS】已从存档应用（${why}）：` + init.map((r,i)=>`${['甲','乙','丙'][i]} μ=${(Math.round(r.mu*100)/100).toFixed(2)} σ=${(Math.round(r.sigma*100)/100).toFixed(2)}`).join(' | ')]);
  };

  // NEW: 按角色应用（若知道地主，则地主用 landlord 档，其他用 farmer 档；未知则退回 overall）
  const applyTsFromStoreByRole = (lord: number | null, why: string) => {
    const ids = [0,1,2].map(seatIdentity);
    const init = [0,1,2].map(i => {
      const role: TsRole | undefined = (lord == null) ? undefined : (i === lord ? 'landlord' : 'farmer');
      return resolveRatingForIdentity(ids[i], role) || { ...TS_DEFAULT };
    });
    setTsArr(init);
    setLog(l => [...l,
      `【TS】按角色应用（${why}，地主=${lord ?? '未知'}）：` +
      init.map((r,i)=>`${['甲','乙','丙'][i]} μ=${(Math.round(r.mu*100)/100).toFixed(2)} σ=${(Math.round(r.sigma*100)/100).toFixed(2)}`).join(' | ')
    ]);
  };

  const updateStoreAfterRound = (updated: Rating[], landlordIndex:number) => {
    const ids = [0,1,2].map(seatIdentity);
    for (let i=0;i<3;i++){
      const id = ids[i];
      const entry: TsStoreEntry = tsStoreRef.current.players[id] || { id, roles:{} };
      entry.overall = { ...updated[i] };
      const role: TsRole = (i===landlordIndex) ? 'landlord' : 'farmer';
      entry.roles = entry.roles || {};
      entry.roles[role] = { ...updated[i] };
      const choice = props.seats[i];
      const model  = (props.seatModels[i] || '').trim();
      const base   = choice==='http' ? (props.seatKeys[i]?.httpBase || '') : '';
      entry.meta = { choice, ...(model ? { model } : {}), ...(base ? { httpBase: base } : {}) };
      tsStoreRef.current.players[id] = entry;
    }
    writeStore(tsStoreRef.current);
  };

  const handleUploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    try {
      const text = await f.text();
      const j = JSON.parse(text);
      const store: TsStore = emptyStore();

      // 兼容多种模板：数组 / {players:{}} / 单人
      if (Array.isArray(j?.players)) {
        for (const p of j.players) {
          const id = p.id || p.identity || p.key; if (!id) continue;
          store.players[id] = {
            id,
            overall: p.overall || p.rating || null,
            roles: { landlord: p.roles?.landlord ?? p.landlord ?? p.L ?? null,
                     farmer:   p.roles?.farmer   ?? p.farmer   ?? p.F ?? null },
            meta: p.meta || {}
          };
        }
      } else if (j?.players && typeof j.players === 'object') {
        store.players = j.players;
      } else if (Array.isArray(j)) {
        for (const p of j) { const id = p.id || p.identity; if (!id) continue; store.players[id] = p; }
      } else {
        if (j?.id) store.players[j.id] = j;
      }

      tsStoreRef.current = store; writeStore(store);
      setLog(l => [...l, `【TS】已上传存档（共 ${Object.keys(store.players).length} 名玩家）`]);
    } catch (err:any) {
      setLog(l => [...l, `【TS】上传解析失败：${err?.message || err}`]);
    } finally { e.target.value = ''; }
  };

  const handleSaveArchive = () => {
    const ids = [0,1,2].map(seatIdentity);
    ids.forEach((id,i)=>{
      const entry: TsStoreEntry = tsStoreRef.current.players[id] || { id, roles:{} };
      entry.overall = { ...tsRef.current[i] };
      tsStoreRef.current.players[id] = entry;
    });
    writeStore(tsStoreRef.current);
    const blob = new Blob([JSON.stringify(tsStoreRef.current, null, 2)], { type:'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'trueskill_store.json'; a.click();
    setTimeout(()=>URL.revokeObjectURL(url), 1200);
    setLog(l => [...l, '【TS】已导出当前存档。']);
  };

  // —— 用于“区分显示”的帮助函数 —— //
  const fmt2 = (x:number)=> (Math.round(x*100)/100).toFixed(2);
  const muSig = (r: Rating | null | undefined) => r ? `μ ${fmt2(r.mu)}｜σ ${fmt2(r.sigma)}` : '—';
  const getStoredForSeat = (i:number) => {
    const id = seatIdentity(i);
    const p = tsStoreRef.current.players[id];
    return {
      overall: p?.overall ? ensureRating(p.overall) : null,
      landlord: p?.roles?.landlord ? ensureRating(p.roles.landlord) : null,
      farmer: p?.roles?.farmer ? ensureRating(p.roles.farmer) : null,
    };
  };
  /* ===== Radar（战术画像）本地存档（新增） ===== */
  type RadarAgg = { scores: Score5; count: number };
  type RadarStoreEntry = {
    id: string; // 身份：choice|model|base（沿用 seatIdentity）
    overall?: RadarAgg | null;  // 不区分身份时累计
    roles?: { landlord?: RadarAgg | null; farmer?: RadarAgg | null }; // 按角色分档
    meta?: { choice?: string; model?: string; httpBase?: string };
  };
  type RadarStore = {
    schema: 'ddz-radar@1';
    updatedAt: string;
    players: Record<string, RadarStoreEntry>;
  };
  const RADAR_STORE_KEY = 'ddz_radar_store_v1';

  const ensureScore5 = (x:any): Score5 => ({
    coop: Number(x?.coop ?? 2.5),
    agg : Number(x?.agg  ?? 2.5),
    cons: Number(x?.cons ?? 2.5),
    eff : Number(x?.eff  ?? 2.5),
    rob : Number(x?.rob  ?? 2.5),
  });
  const ensureRadarAgg = (x:any): RadarAgg => ({
    scores: ensureScore5(x?.scores),
    count : Math.max(0, Number(x?.count)||0),
  });

  const emptyRadarStore = (): RadarStore =>
    ({ schema:'ddz-radar@1', updatedAt:new Date().toISOString(), players:{} });

  const readRadarStore = (): RadarStore => {
    try {
      const raw = localStorage.getItem(RADAR_STORE_KEY);
      if (!raw) return emptyRadarStore();
      const j = JSON.parse(raw);
      if (j?.schema === 'ddz-radar@1' && j?.players) return j as RadarStore;
    } catch {}
    return emptyRadarStore();
  };
  const writeRadarStore = (_s: RadarStore) => { /* no-op: radar not persisted */ };

  /** 用“均值 + 次数”合并（与前端 mean 聚合一致） */
  function mergeRadarAgg(prev: RadarAgg|null|undefined, inc: Score5): RadarAgg {
    if (!prev) return { scores: { ...inc }, count: 1 };
    const c = prev.count;
    const mean = (a:number,b:number)=> (a*c + b)/(c+1);
    return {
      scores: {
        coop: mean(prev.scores.coop, inc.coop),
        agg : mean(prev.scores.agg , inc.agg ),
        cons: mean(prev.scores.cons, inc.cons),
        eff : mean(prev.scores.eff , inc.eff ),
        rob : mean(prev.scores.rob , inc.rob ),
      },
      count: c + 1,
    };
  }

  // —— Radar 存档：读写/应用/上传/导出 —— //
  const radarStoreRef = useRef<RadarStore>(emptyRadarStore());
  useEffect(()=>{ try { radarStoreRef.current = readRadarStore(); } catch {} }, []);
  const radarFileRef = useRef<HTMLInputElement|null>(null);

  /** 取指定座位的（按角色可选）Radar 累计 */
  const resolveRadarForIdentity = (id:string, role?: 'landlord'|'farmer'): RadarAgg | null => {
    const p = radarStoreRef.current.players[id];
    if (!p) return null;
    if (role && p.roles?.[role]) return ensureRadarAgg(p.roles[role]);
    if (p.overall) return ensureRadarAgg(p.overall);
    const L = p.roles?.landlord, F = p.roles?.farmer;
    if (L && F) {
      const ll = ensureRadarAgg(L), ff = ensureRadarAgg(F);
      const tot = Math.max(1, ll.count + ff.count);
      const w = (a:number,b:number,ca:number,cb:number)=> (a*ca + b*cb)/tot;
      return {
        scores: {
          coop: w(ll.scores.coop, ff.scores.coop, ll.count, ff.count),
          agg : w(ll.scores.agg , ff.scores.agg , ll.count, ff.count),
          cons: w(ll.scores.cons, ff.scores.cons, ll.count, ff.count),
          eff : w(ll.scores.eff , ff.scores.eff , ll.count, ff.count),
          rob : w(ll.scores.rob , ff.scores.rob , ll.count, ff.count),
        },
        count: tot,
      };
    }
    if (L) return ensureRadarAgg(L);
    if (F) return ensureRadarAgg(F);
    return null;
  };

  /** 根据当前地主身份（已知/未知）把存档套到 UI 的 aggStats/aggCount */
  
  /* ===== 天梯（活动积分 ΔR_event）本地存档（localStorage 直接读写） ===== */
  type LadderAgg = { n:number; sum:number; delta:number; deltaR:number; K:number; N0:number };
  type LadderEntry = { id:string; label:string; current:LadderAgg; history?: { when:string; n:number; delta:number; deltaR:number }[] };
  type LadderStore = { schema:'ddz-ladder@1'; updatedAt:string; players: Record<string, LadderEntry> };
  const LADDER_KEY = 'ddz_ladder_store_v1';
  const LADDER_EMPTY: LadderStore = { schema:'ddz-ladder@1', updatedAt:new Date().toISOString(), players:{} };
  const LADDER_DEFAULT: LadderAgg = { n:0, sum:0, delta:0, deltaR:0, K:20, N0:20 };

  function readLadder(): LadderStore {
    try { const raw = localStorage.getItem(LADDER_KEY); if (raw) { const j = JSON.parse(raw); if (j?.schema==='ddz-ladder@1') return j as LadderStore; } } catch {}
    return { ...LADDER_EMPTY, updatedAt:new Date().toISOString() };
  }
  function writeLadder(s: LadderStore) {
    try { s.updatedAt = new Date().toISOString(); localStorage.setItem(LADDER_KEY, JSON.stringify(s)); } catch {}
  }
  function ladderUpdateLocal(id:string, label:string, sWin:number, pExp:number, weight:number=1) {
    const st = readLadder();
    const ent = st.players[id] || { id, label, current: { ...LADDER_DEFAULT }, history: [] };
    if (!ent.current) ent.current = { ...LADDER_DEFAULT };
    if (!ent.label) ent.label = label;
    const w = Math.max(0, Number(weight) || 0);
    ent.current.n += w;
    ent.current.sum += w * (sWin - pExp);
    const N0 = ent.current.N0 ?? 20;
    const K  = ent.current.K  ?? 20;
    ent.current.delta = ent.current.n > 0 ? (ent.current.sum / ent.current.n) : 0;
    const shrink = Math.sqrt(ent.current.n / (ent.current.n + Math.max(1, N0)));
    ent.current.deltaR = K * ent.current.delta * shrink;
    st.players[id] = ent;
    writeLadder(st);
    try { window.dispatchEvent(new Event('ddz-all-refresh')); } catch {}
  }
    const applyRadarFromStoreByRole = (lord: number | null, why: string) => {
    const ids = [0,1,2].map(seatIdentity);
    const s3 = [0,1,2].map(i=>{
      const role = (lord==null) ? undefined : (i===lord ? 'landlord' : 'farmer');
      return resolveRadarForIdentity(ids[i], role) || { scores: { coop:2.5, agg:2.5, cons:2.5, eff:2.5, rob:2.5 }, count: 0 };
    });
    setAggStats(s3.map(x=>({ ...x.scores })));
    setAggCount(Math.max(s3[0].count, s3[1].count, s3[2].count));
    setLog(l => [...l, `【Radar】已从存档应用（${why}，地主=${lord ?? '未知'}）`]);
  };

  /** 在收到一帧“本局画像 s3[0..2]”后，写入 Radar 存档（overall + 角色分档） */
  const updateRadarStoreFromStats = (s3: Score5[], lord: number | null) => {
    const ids = [0,1,2].map(seatIdentity);
    for (let i=0;i<3;i++){
      const id = ids[i];
      const entry = (radarStoreRef.current.players[id] || { id, roles:{} }) as RadarStoreEntry;
      entry.overall = mergeRadarAgg(entry.overall, s3[i]);
      if (lord!=null) {
        const role: 'landlord' | 'farmer' = (i===lord ? 'landlord' : 'farmer');
        entry.roles = entry.roles || {};
        entry.roles[role] = mergeRadarAgg(entry.roles[role], s3[i]);
      }
      const choice = props.seats[i];
      const model  = (props.seatModels[i] || '').trim();
      const base   = choice==='http' ? (props.seatKeys[i]?.httpBase || '') : '';
      entry.meta = { choice, ...(model ? { model } : {}), ...(base ? { httpBase: base } : {}) };
      radarStoreRef.current.players[id] = entry;
    }
    // writeRadarStore disabled (no radar persistence)
  };

  /** 上传 Radar 存档（JSON） */
  const handleRadarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    try {
      const text = await f.text();
      const j = JSON.parse(text);
      const store: RadarStore = emptyRadarStore();

      if (Array.isArray(j?.players)) {
        for (const p of j.players) {
          const id = p.id || p.identity || p.key; if (!id) continue;
          store.players[id] = {
            id,
            overall: p.overall ? ensureRadarAgg(p.overall) : null,
            roles: {
              landlord: p.roles?.landlord ? ensureRadarAgg(p.roles.landlord) : (p.landlord ? ensureRadarAgg(p.landlord) : null),
              farmer  : p.roles?.farmer   ? ensureRadarAgg(p.roles.farmer)   : (p.farmer   ? ensureRadarAgg(p.farmer)   : null),
            },
            meta: p.meta || {},
          };
        }
      } else if (j?.players && typeof j.players === 'object') {
        for (const [id, p] of Object.entries<any>(j.players)) {
          store.players[id] = {
            id,
            overall: p?.overall ? ensureRadarAgg(p.overall) : null,
            roles: {
              landlord: p?.roles?.landlord ? ensureRadarAgg(p.roles.landlord) : null,
              farmer  : p?.roles?.farmer   ? ensureRadarAgg(p.roles.farmer)   : null,
            },
            meta: p?.meta || {},
          };
        }
      } else if (Array.isArray(j)) {
        for (const p of j) { const id = p.id || p.identity; if (!id) continue; store.players[id] = p as any; }
      } else if (j?.id) {
        store.players[j.id] = j as any;
      }

      radarStoreRef.current = store; writeRadarStore(store);
      setLog(l => [...l, `【Radar】已上传存档（${Object.keys(store.players).length} 位）`]);
    } catch (err:any) {
      setLog(l => [...l, `【Radar】上传解析失败：${err?.message || err}`]);
    } finally { e.target.value = ''; }
  };

  /** 导出当前 Radar 存档 */
  const handleRadarSave = () => {
  setLog(l => [...l, '【Radar】存档已禁用（仅支持查看/刷新，不再保存到本地或 ALL 文件）。']);
};
;

  // 累计画像
  const [aggMode, setAggMode] = useState<'mean'|'ewma'>('ewma');
  const [alpha, setAlpha] = useState<number>(0.35);
  const [aggStats, setAggStats] = useState<Score5[] | null>(null);
  const [aggCount, setAggCount] = useState<number>(0);

  useEffect(() => { props.onTotals?.(totals); }, [totals]);
  useEffect(() => { props.onLog?.(log); }, [log]);

  const controllerRef = useRef<AbortController|null>(null);
  const handsRef = useRef(hands); useEffect(() => { handsRef.current = hands; }, [hands]);
  const playsRef = useRef(plays); useEffect(() => { playsRef.current = plays; }, [plays]);
  const totalsRef = useRef(totals); useEffect(() => { totalsRef.current = totals; }, [totals]);
  const finishedRef = useRef(finishedCount); useEffect(() => { finishedRef.current = finishedCount; }, [finishedCount]);
  const logRef = useRef(log); useEffect(() => { logRef.current = log; }, [log]);
  const landlordRef = useRef(landlord); useEffect(() => { landlordRef.current = landlord; }, [landlord]);
  const winnerRef = useRef(winner); useEffect(() => { winnerRef.current = winner; }, [winner]);
  const deltaRef = useRef(delta); useEffect(() => { deltaRef.current = delta; }, [delta]);
  const multiplierRef = useRef(multiplier); useEffect(() => { multiplierRef.current = multiplier; }, [multiplier]);

  const aggStatsRef = useRef(aggStats); useEffect(()=>{ aggStatsRef.current = aggStats; }, [aggStats]);
  const aggCountRef = useRef(aggCount); useEffect(()=>{ aggCountRef.current = aggCount; }, [aggCount]);
  const aggModeRef  = useRef(aggMode);  useEffect(()=>{ aggModeRef.current  = aggMode;  }, [aggMode]);
  const alphaRef    = useRef(alpha);    useEffect(()=>{ alphaRef.current    = alpha;    }, [alpha]);

  const lastReasonRef = useRef<(string|null)[]>([null, null, null]);

  // 每局观测标记
  const roundFinishedRef = useRef<boolean>(false);
  const seenStatsRef     = useRef<boolean>(false);

  
  const scoreFileRef = useRef<HTMLInputElement|null>(null);

  const agentIdForIndex = (i:number) => {
    const choice = props.seats[i] as BotChoice;
    const label = choiceLabel(choice);
    if ((choice as string).startsWith('built-in')) return label;
    const model = (props.seatModels?.[i]) || defaultModelFor(choice);
    return `${label}:${model}`;
  };

  const handleScoreSave = () => {
    const agents = [0,1,2].map(agentIdForIndex);
    const n = Math.max(scoreSeries[0]?.length||0, scoreSeries[1]?.length||0, scoreSeries[2]?.length||0);
    const payload = {
      version: 1,
      createdAt: new Date().toISOString(),
      agents,
      rounds: roundCutsRef.current,
      n,
      seriesBySeat: scoreSeriesRef.current,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type:'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'score_series.json'; a.click();
    setTimeout(()=>URL.revokeObjectURL(url), 1500);
  };

  const handleScoreUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      const f = e.target.files?.[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        try {
          const j = JSON.parse(String(rd.result||'{}'));
          const fileAgents: string[] = j.agents || (Array.isArray(j.seats)? j.seats.map((s:any)=> s.agent || s.label) : []);
          const targetAgents = [0,1,2].map(agentIdForIndex);
          const mapped:(number|null)[][] = [[],[],[]];
          for (let i=0;i<3;i++){
            const idx = fileAgents.indexOf(targetAgents[i]);
            mapped[i] = (idx>=0 && Array.isArray(j.seriesBySeat?.[idx])) ? j.seriesBySeat[idx] : [];
          }
          setScoreSeries(mapped);
          if (Array.isArray(j.rounds)) setRoundCuts(j.rounds as number[]);
        } catch (err) {
          console.error('[score upload] parse error', err);
        }
      };
      rd.readAsText(f);
    } catch (err) {
      console.error('[score upload] error', err);
    } finally {
      if (scoreFileRef.current) scoreFileRef.current.value = '';
    }
  };

  
  const handleStatsSave = () => {
    try {
      const payload = { when: new Date().toISOString(), stats: scoreStats, dists: scoreDists };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type:'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'score-stats.json';
      a.click();
      setTimeout(()=> URL.revokeObjectURL(a.href), 0);
    } catch (e) { console.error('[stats] save error', e); }
  };
  const handleStatsUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      const f = e.target.files?.[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        try {
          const obj = JSON.parse(String(rd.result||'{}'));
          if (Array.isArray(obj.stats) && obj.stats.length===3) setScoreStats(obj.stats as any);
          if (Array.isArray(obj.dists) && obj.dists.length===3) setScoreDists(obj.dists as any);
        } catch (err) { console.error('[stats upload] parse error', err); }
      };
      rd.readAsText(f);
    } catch (err) { console.error('[stats upload] error', err); }
    finally { if (statsFileRef.current) statsFileRef.current.value = ''; }
  };
  const handleStatsRefresh = () => { setRoundCuts(prev => [...prev]); };
const handleScoreRefresh = () => {
    setScoreSeries(prev => prev.map(arr => Array.isArray(arr) ? [...arr] : []));
    setRoundCuts(prev => [...prev]);
    setRoundLords(prev => [...prev]);
  };
const [allLogs, setAllLogs] = useState<string[]>([]);
const allLogsRef = useRef(allLogs);
useEffect(() => { allLogsRef.current = allLogs; }, [allLogs]);
const start = async () => {
    if (running) return;
    if (!props.enabled) { setLog(l => [...l, '【前端】未启用对局：请在设置中勾选“启用对局”。']); return; }

    setRunning(true);
    setAllLogs([]);
    setLandlord(null); setHands([[], [], []]); setPlays([]);
    setWinner(null); setDelta(null); setMultiplier(1);
    setLog([]); setFinishedCount(0);
    setTotals([props.startScore || 0, props.startScore || 0, props.startScore || 0]);
    lastReasonRef.current = [null, null, null];
    setAggStats(null); setAggCount(0);

    // TrueSkill：开始时先应用 overall（未知地主）
    setTsArr([{...TS_DEFAULT},{...TS_DEFAULT},{...TS_DEFAULT}]);
    try { applyTsFromStore('比赛开始前'); } catch {}

    controllerRef.current = new AbortController();

    const buildSeatSpecs = (): any[] => {
      return props.seats.slice(0,3).map((choice, i) => {
        const normalized = normalizeModelForProvider(choice, props.seatModels[i] || '');
        const model = normalized || defaultModelFor(choice);
        const keys = props.seatKeys[i] || {};
        switch (choice) {
          case 'ai:openai':   return { choice, model, apiKey: keys.openai || '' };
          case 'ai:gemini':   return { choice, model, apiKey: keys.gemini || '' };
          case 'ai:grok':     return { choice, model, apiKey: keys.grok || '' };
          case 'ai:kimi':     return { choice, model, apiKey: keys.kimi || '' };
          case 'ai:qwen':     return { choice, model, apiKey: keys.qwen || '' };
          case 'ai:deepseek': return { choice, model, apiKey: keys.deepseek || '' };
          case 'http':        return { choice, model, baseUrl: keys.httpBase || '', token: keys.httpToken || '' };
          default:            return { choice };
        }
      });
    };

    const seatSummaryText = (specs: any[]) =>
      specs.map((s, i) => {
        const nm = seatName(i);
        if (s.choice.startsWith('built-in')) return `${nm}=${choiceLabel(s.choice as BotChoice)}`;
        if (s.choice === 'http') return `${nm}=HTTP(${s.baseUrl ? 'custom' : 'default'})`;
        return `${nm}=${choiceLabel(s.choice as BotChoice)}(${s.model || defaultModelFor(s.choice as BotChoice)})`;
      }).join(', ');

    const markRoundFinishedIfNeeded = (
      nextFinished:number,
      nextAggStats: Score5[] | null,
      nextAggCount: number
    ) => {
      if (!roundFinishedRef.current) {
        if (!seenStatsRef.current) {
          const neutral: Score5 = { coop:2.5, agg:2.5, cons:2.5, eff:2.5, rob:2.5 };
          const mode = aggModeRef.current;
          const a    = alphaRef.current;
          if (!nextAggStats) {
            nextAggStats = [neutral, neutral, neutral];
            nextAggCount = 1;
          } else {
            nextAggStats = nextAggStats.map(prev => mergeScore(prev, neutral, mode, nextAggCount, a));
            nextAggCount = nextAggCount + 1;
          }
        }
        roundFinishedRef.current = true;
        nextFinished = nextFinished + 1;
      }
      return { nextFinished, nextAggStats, nextAggCount };
    };

    const playOneGame = async (_gameIndex: number, labelRoundNo: number) => {
    let lastEventTs = Date.now();
    const timeoutMs = (()=>{
      const arr = props.turnTimeoutSecs || [30,30,30];
      const norm = arr.map(x=> (Number.isFinite(x as any) && (x as any)>0 ? (x as any) : 30));
      const sec = Math.min(...norm);
      return Math.max(5000, sec*1000);
    })();
    let dogId: any = null;

      setLog([]); lastReasonRef.current = [null, null, null];
      const baseSpecs = buildSeatSpecs();
      const startShift = ((labelRoundNo - 1) % 3 + 3) % 3;
      const specs = [0,1,2].map(i => baseSpecs[(i + startShift) % 3]);
      const toUiSeat = (j:number) => (j + startShift) % 3;
      const remap3 = <T,>(arr: T[]) => ([ arr[(0 - startShift + 3) % 3], arr[(1 - startShift + 3) % 3], arr[(2 - startShift + 3) % 3] ]) as T[];
      const traceId = Math.random().toString(36).slice(2,10) + '-' + Date.now().toString(36);
      setLog(l => [...l, `【前端】开始第 ${labelRoundNo} 局 | 座位: ${seatSummaryText(baseSpecs)} | coop=${props.farmerCoop ? 'on' : 'off'} | trace=${traceId}`]);

      roundFinishedRef.current = false;
      seenStatsRef.current = false;

      const r = await fetch('/api/stream_ndjson', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          rounds: 1,
          startScore: props.startScore,
          seatDelayMs: props.seatDelayMs,
          enabled: props.enabled,
          rob: props.rob,
          four2: props.four2,
          seats: specs,
          clientTraceId: traceId,
          stopBelowZero: true,
          farmerCoop: props.farmerCoop,
        turnTimeoutSec: (props.turnTimeoutSecs ?? [30,30,30])
        }),
        signal: controllerRef.current!.signal,
      });
      if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);

      const reader = r.body.getReader();
      dogId = setInterval(() => {
        if (Date.now() - lastEventTs > timeoutMs) {
          setLog(l => [...l, `⏳ 超过 ${Math.round(timeoutMs/1000)}s 未收到事件，已触发前端提示（后端会按规则自动“过”或出最小牌），继续等待…`]);
          lastEventTs = Date.now(); // 防止重复提示
        }
      }, 1000);
    
      const decoder = new TextDecoder('utf-8');
      let buf = '';
      const rewrite = makeRewriteRoundLabel(labelRoundNo);

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        let idx: number;
        const batch: any[] = [];
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line) continue;
          try { batch.push(JSON.parse(line)); } catch {}
        }

        if (batch.length) {
          let nextHands = handsRef.current.map(x => [...x]);
          let nextPlays = [...playsRef.current];
          let nextTotals = [...totalsRef.current] as [number, number, number];
          let nextFinished = finishedRef.current;
          let nextLog = [...logRef.current];
          let nextLandlord = landlordRef.current;
          let nextWinner = winnerRef.current as number | null;
          let nextDelta = deltaRef.current as [number, number, number] | null;
          let nextMultiplier = multiplierRef.current;
          let nextAggStats = aggStatsRef.current;
          let nextAggCount = aggCountRef.current;

          
          let nextScores = scoreSeriesRef.current.map(x => [...x]);
          let sawAnyTurn = false;
          let nextCuts = roundCutsRef.current.slice();
          let nextLords = roundLordsRef.current.slice();
for (const raw of batch) {
            let m: any = raw;
            // Remap engine->UI indices when startShift != 0
            if (startShift) {
              const mapMsg = (obj:any)=>{
                const out:any = { ...obj };
                const mapSeat = (x:any)=> (typeof x==='number' ? toUiSeat(x) : x);
                const mapArr = (a:any)=> (Array.isArray(a) && a.length===3 ? remap3(a) : a);
                out.seat = mapSeat(out.seat);
                if ('landlordIdx' in out) out.landlordIdx = mapSeat(out.landlordIdx);
                if ('landlord' in out) out.landlord = mapSeat(out.landlord);
                if ('winner' in out) out.winner = mapSeat(out.winner);
                if ('hands' in out) out.hands = mapArr(out.hands);
                if ('totals' in out) out.totals = mapArr(out.totals);
                if ('delta' in out) out.delta = mapArr(out.delta);
                if ('ratings' in out) out.ratings = mapArr(out.ratings);
                if (out.payload) {
                  const p:any = { ...out.payload };
                  if ('seat' in p) p.seat = mapSeat(p.seat);
                  if ('landlord' in p) p.landlord = mapSeat(p.landlord);
                  if ('hands' in p) p.hands = mapArr(p.hands);
                  if ('totals' in p) p.totals = mapArr(p.totals);
                  out.payload = p;
                }
                return out;
              };
              m = mapMsg(raw);
            } else {
              const m_any:any = raw; m = m_any;
            }

            // m already defined above
            try {
              // -------- TS 帧（后端主动提供） --------
              if (m.type === 'ts' && Array.isArray(m.ratings) && m.ratings.length === 3) {
                const incoming: Rating[] = m.ratings.map((r:any)=>({ mu:Number(r.mu)||25, sigma:Number(r.sigma)||25/3 }));
                setTsArr(incoming);

                if (m.where === 'after-round') {
                  const res = markRoundFinishedIfNeeded(nextFinished, nextAggStats, nextAggCount);
                  nextFinished = res.nextFinished; nextAggStats = res.nextAggStats; nextAggCount = res.nextAggCount;
                  nextLog = [...nextLog, `【TS】after-round 已更新 μ/σ`];
                } else if (m.where === 'before-round') {
                  nextLog = [...nextLog, `【TS】before-round μ/σ 准备就绪`];
                }
                continue;
              }

              // -------- 事件边界 --------
              if (m.type === 'event' && m.kind === 'round-start') {
                // 清空上一局残余手牌/出牌；等待 init/hands 再填充
                nextPlays = [];
                nextHands = [[], [], []] as any;
                nextLandlord = null;

                nextLog = [...nextLog, `【边界】round-start #${m.round}`];
                continue;
              }
              if (m.type === 'event' && m.kind === 'round-end') {
                nextLog = [...nextLog, `【边界】round-end #${m.round}`];
                const res = markRoundFinishedIfNeeded(nextFinished, nextAggStats, nextAggCount);
                nextFinished = res.nextFinished; nextAggStats = res.nextAggStats; nextAggCount = res.nextAggCount;
                continue;
              }

              // -------- 初始发牌（仅限 init 帧） --------
              if (m.type === 'init') {
                const rh = m.hands;
                if (Array.isArray(rh) && rh.length === 3 && Array.isArray(rh[0])) {
                  nextPlays = [];
                  nextWinner = null;
                  nextDelta = null;
                  nextMultiplier = 1; // 仅开局重置；后续“抢”只做×2
                  nextHands = (rh as string[][]).map(decorateHandCycle);

                  const lord = (m.landlordIdx ?? m.landlord ?? null) as number | null;
                  nextLandlord = lord;
                  {
                    const n0 = Math.max(nextScores[0]?.length||0, nextScores[1]?.length||0, nextScores[2]?.length||0);
                    const lordVal = (lord ?? -1) as number | -1;
                    if (nextCuts.length === 0) { nextCuts = [n0]; nextLords = [lordVal]; }
                    else if (nextCuts[nextCuts.length-1] !== n0) { nextCuts = [...nextCuts, n0]; nextLords = [...nextLords, lordVal]; }
                  }
                  // 若本局地主刚刚确认，回填到最近一段的 roundLords，避免底色为白
                  if (nextCuts.length > 0) {
                    const idxBand = Math.max(0, nextCuts.length - 1);
                    const lordVal2 = (nextLandlord ?? -1) as number | -1;
                    if (nextLords[idxBand] !== lordVal2) {
                      nextLords = Object.assign([], nextLords, { [idxBand]: lordVal2 });
                    }
                  }

                  nextLog = [...nextLog, `发牌完成，${lord != null ? seatName(lord) : '?' }为地主`];

                  try { applyTsFromStoreByRole(lord, '发牌后'); } catch {}
                  lastReasonRef.current = [null, null, null];
                }
                continue;
              }

              
              // -------- 首次手牌兜底注入（若没有 init 帧但消息里带了 hands） --------
              {
                const rh0 = m.hands ?? m.payload?.hands ?? m.state?.hands ?? m.init?.hands;
                if ((!nextHands || !(nextHands[0]?.length)) && Array.isArray(rh0) && rh0.length === 3 && Array.isArray(rh0[0])) {
                  nextHands = (rh0 as string[][]).map(decorateHandCycle);
                  const lord2 = (m.landlordIdx ?? m.landlord ?? m.payload?.landlord ?? m.state?.landlord ?? m.init?.landlord ?? null) as number | null;
                  if (lord2 != null) nextLandlord = lord2;
                  // 不重置倍数/不清空已产生的出牌，避免覆盖后续事件
                  nextLog = [...nextLog, `发牌完成（推断），${lord2 != null ? seatName(lord2) : '?' }为地主`];
                  {
                    // —— 兜底：没有 init 帧也要推进 roundCuts / roundLords ——
                    const n0 = Math.max(
                      nextScores[0]?.length||0,
                      nextScores[1]?.length||0,
                      nextScores[2]?.length||0
                    );
                    const lordVal = (nextLandlord ?? -1) as number | -1;
                    if (nextCuts.length === 0) { nextCuts = [n0]; nextLords = [lordVal]; }
                    else if (nextCuts[nextCuts.length-1] !== n0) {
                      nextCuts = [...nextCuts, n0];
                      nextLords = [...nextLords, lordVal];
                    }
                    // 若本局地主刚刚确认，回填最近一段的 roundLords，避免底色为白
                    if (nextCuts.length > 0) {
                      const idxBand = Math.max(0, nextCuts.length - 1);
                      const lordVal2 = (nextLandlord ?? -1) as number | -1;
                      if (nextLords[idxBand] !== lordVal2) {
                        nextLords = Object.assign([], nextLords, { [idxBand]: lordVal2 });
                      }
                    }
                  }

                }
              }

// -------- AI 过程日志 --------
              if (m.type === 'event' && m.kind === 'bot-call') {
                nextLog = [...nextLog, `AI调用｜${seatName(m.seat)}｜${m.by}${m.model ? `(${m.model})` : ''}｜阶段=${m.phase || 'unknown'}${m.need ? `｜需求=${m.need}` : ''}`];
                continue;
              }
              if (m.type === 'event' && m.kind === 'bot-done') {
                nextLog = [
                  ...nextLog,
                  `AI完成｜${seatName(m.seat)}｜${m.by}${m.model ? `(${m.model})` : ''}｜耗时=${m.tookMs}ms`,
                  ...(m.reason ? [`AI理由｜${seatName(m.seat)}：${m.reason}`] : []),
                ];
                lastReasonRef.current[m.seat] = m.reason || null;
                continue;
              }

              // -------- 抢/不抢 --------
              if (m.type === 'event' && m.kind === 'rob') {
  if (m.rob) nextMultiplier = Math.max(1, (nextMultiplier || 1) * 2);
                nextLog = [...nextLog, `${seatName(m.seat)} ${m.rob ? '抢地主' : '不抢'}`];
                continue;
              }

              // -------- 起新墩 --------
              if (m.type === 'event' && m.kind === 'trick-reset') {
                nextLog = [...nextLog, '一轮结束，重新起牌'];
                nextPlays = [];
                continue;
              }

              // -------- 出/过 --------
              
                // （fallback）若本批次没有收到 'turn' 行，则从 event:play 中恢复 score
                if (!sawAnyTurn) {
                  const s = (typeof m.seat === 'number') ? m.seat as number : -1;
                  if (s>=0 && s<3) {
                    let val: number|null = (typeof (m as any).score === 'number') ? (m as any).score as number : null;
                    if (typeof val !== 'number') {
                      const rr = (m.reason ?? lastReasonRef.current?.[s] ?? '') as string;
                      const mm = /score=([+-]?\d+(?:\.\d+)?)/.exec(rr || '');
                      if (mm) { val = parseFloat(mm[1]); }
                    }
                    for (let i=0;i<3;i++){
                      if (!Array.isArray(nextScores[i])) nextScores[i]=[];
                      nextScores[i] = [...nextScores[i], (i===s ? val : null)];
                    }
                  }
                }

              // -------- 记录 turn（含 score） --------
              if (m.type === 'turn') {
                const s = (typeof m.seat === 'number') ? m.seat as number : -1;
                if (s>=0 && s<3) {
                  sawAnyTurn = true;
                  const val = (typeof m.score === 'number') ? (m.score as number) : null;
                  for (let i=0;i<3;i++){
                    if (!Array.isArray(nextScores[i])) nextScores[i]=[];
                    nextScores[i] = [...nextScores[i], (i===s ? val : null)];
                  }
                }
                continue;
              }
if (m.type === 'event' && m.kind === 'play') {
                if (m.move === 'pass') {
                  const reason = (m.reason ?? lastReasonRef.current[m.seat]) || undefined;
                  lastReasonRef.current[m.seat] = null;
                  nextPlays = [...nextPlays, { seat: m.seat, move: 'pass', reason }];
                  nextLog = [...nextLog, `${seatName(m.seat)} 过${reason ? `（${reason}）` : ''}`];
                } else {
                  const pretty: string[] = [];
                  const seat = m.seat as number;
                  const cards: string[] = m.cards || [];
                  const nh = (nextHands && (nextHands as any[]).length === 3 ? nextHands : [[], [], []]).map((x: any) => [...x]);
                  for (const rawCard of cards) {
                    const options = candDecorations(rawCard);
                    const chosen = options.find((d: string) => nh[seat].includes(d)) || options[0];
                    const k = nh[seat].indexOf(chosen);
                    if (k >= 0) nh[seat].splice(k, 1);
                    pretty.push(chosen);
                  }
                  const reason = (m.reason ?? lastReasonRef.current[m.seat]) || undefined;
                  lastReasonRef.current[m.seat] = null;

                  nextHands = nh;
                  nextPlays = [...nextPlays, { seat: m.seat, move: 'play', cards: pretty, reason }];
                  nextLog = [...nextLog, `${seatName(m.seat)} 出牌：${pretty.join(' ')}${reason ? `（理由：${reason}）` : ''}`];
                }
                continue;
              }

              // -------- 结算（多种别名兼容） --------
              const isWinLike =
                (m.type === 'event' && (m.kind === 'win' || m.kind === 'result' || m.kind === 'game-over' || m.kind === 'game_end')) ||
                (m.type === 'result') || (m.type === 'game-over') || (m.type === 'game_end');
              if (isWinLike) {
                const L = (nextLandlord ?? 0) as number;
                const ds = (Array.isArray(m.deltaScores) ? m.deltaScores
                          : Array.isArray(m.delta) ? m.delta
                          : [0,0,0]) as [number,number,number];

                // 将“以地主为基准”的增减分旋转成“按座位顺序”的展示
                const rot: [number,number,number] = [
                  ds[(0 - L + 3) % 3],
                  ds[(1 - L + 3) % 3],
                  ds[(2 - L + 3) % 3],
                ];
                let nextWinnerLocal     = m.winner ?? nextWinner ?? null;
                const effMult = (m.multiplier ?? (nextMultiplier ?? 1));
// 判定 rot 是否已经按倍数放大：基分 |-2|+|+1|+|+1| = 4
const sumAbs = Math.abs(rot[0]) + Math.abs(rot[1]) + Math.abs(rot[2]);
const needScale = effMult > 1 && (sumAbs === 4 || (sumAbs % effMult !== 0));
const rot2 = needScale
  ? (rot.map(v => (typeof v === 'number' ? v * effMult : v)) as [number, number, number])
  : rot;
nextMultiplier = effMult;
nextDelta      = rot2;
nextTotals     = [
  nextTotals[0] + rot2[0],
  nextTotals[1] + rot2[1],
  nextTotals[2] + rot2[2]
] as any;

                // 若后端没给 winner，依据“地主增减”推断胜负：ds[0] > 0 => 地主胜
                if (nextWinnerLocal == null) {
                  const landlordDelta = ds[0] ?? 0;
                  if (landlordDelta > 0) nextWinnerLocal = L;
                  else if (landlordDelta < 0) {
                    const farmer = [0,1,2].find(x => x !== L)!;
                    nextWinnerLocal = farmer;
                  }
                }
                nextWinner = nextWinnerLocal;

                // 标记一局结束 & 雷达图兜底
                {
                  const res = markRoundFinishedIfNeeded(nextFinished, nextAggStats, nextAggCount);
                  nextFinished = res.nextFinished; nextAggStats = res.nextAggStats; nextAggCount = res.nextAggCount;
                }

                
                // ✅ Ladder（活动积分 ΔR）：按本局分差幅度加权（独立于胜负方向）
                try {
                  const pre = tsRef.current.map(r => ({ ...r })); // 局前 TS 快照
                  const farmers = [0,1,2].filter(x => x !== L);
                  const farmerWin = (nextWinner === L) ? false : true;
                  const teamWin = (seat:number) => (seat === L) ? (!farmerWin) : farmerWin;
                  const teamP = (seat:number) => {
                    const teamA = (seat === L) ? [L] : farmers;
                    const teamB = (seat === L) ? farmers : [L];
                    const muA = teamA.reduce((ss,i)=> ss + pre[i].mu, 0);
                    const muB = teamB.reduce((ss,i)=> ss + pre[i].mu, 0);
                    const vA  = teamA.reduce((ss,i)=> ss + pre[i].sigma*pre[i].sigma + TS_BETA*TS_BETA, 0);
                    const vB  = teamB.reduce((ss,i)=> ss + pre[i].sigma*pre[i].sigma + TS_BETA*TS_BETA, 0);
                    const c = Math.sqrt(vA + vB);
                    return Phi( (muA - muB) / c );
                  };
                  const mag = Math.max(Math.abs(ds[0]||0), Math.abs(ds[1]||0), Math.abs(ds[2]||0));
                  const base = 20, cap = 3, gamma = 1;
                  const weight = 1 + gamma * Math.min(cap, mag / base);
                  for (let i=0;i<3;i++) {
                    const sWinTeam = teamWin(i) ? 1 : 0;
                    const pExpTeam = teamP(i);
                    const scale    = (i === L) ? 1 : 0.5;  // 地主记一份，两个农民各记半份
                    const id = seatIdentity(i);
                    const label = agentIdForIndex(i);
                    ladderUpdateLocal(id, label, sWinTeam * scale, pExpTeam * scale, weight);
                  }
                } catch {}
// ✅ TrueSkill：局后更新 + 写入“角色分档”存档
                {
                  const updated = tsRef.current.map(r => ({ ...r }));
                  const farmers = [0,1,2].filter(s => s !== L);
                  const landlordDelta = ds[0] ?? 0;
                  const landlordWin = (nextWinner === L) || (landlordDelta > 0);
                  if (landlordWin) tsUpdateTwoTeams(updated, [L], farmers);
                  else             tsUpdateTwoTeams(updated, farmers, [L]);

                  setTsArr(updated);
                  updateStoreAfterRound(updated, L);

                  nextLog = [
                    ...nextLog,
                    `TS(局后)：甲 μ=${fmt2(updated[0].mu)} σ=${fmt2(updated[0].sigma)}｜乙 μ=${fmt2(updated[1].mu)} σ=${fmt2(updated[1].sigma)}｜丙 μ=${fmt2(updated[2].mu)} σ=${fmt2(updated[2].sigma)}`
                  ];
                }

                nextLog = [
                  ...nextLog,
                  `胜者：${nextWinner == null ? '—' : seatName(nextWinner)}，倍数 x${nextMultiplier}，当局积分（按座位） ${rot.join(' / ')}｜原始（相对地主） ${ds.join(' / ')}｜地主=${seatName(L)}`
                ];
                continue;
              }

              // -------- 画像统计（两种形态） --------
              const isStatsTop = (m.type === 'stats' && (Array.isArray(m.perSeat) || Array.isArray(m.seats)));
              const isStatsEvt = (m.type === 'event' && m.kind === 'stats' && (Array.isArray(m.perSeat) || Array.isArray(m.seats)));
              if (isStatsTop || isStatsEvt) {
                seenStatsRef.current = true;
                const arr = (m.perSeat ?? m.seats) as any[];
                const s3 = [0,1,2].map(i=>{
                  const rec = arr.find((x:any)=>x.seat===i || x.index===i);
                  const sc = rec?.scaled || rec?.score || {};
                  return {
                    coop: Number(sc.coop ?? 2.5),
                    agg : Number(sc.agg  ?? 2.5),
                    cons: Number(sc.cons ?? 2.5),
                    eff : Number(sc.eff  ?? 2.5),
                    rob : Number(sc.rob  ?? 2.5),
                  };
                }) as Score5[];

                // 同步写入 Radar 本地存档（overall + 角色分档）
                updateRadarStoreFromStats(s3, nextLandlord);

                const mode  = aggModeRef.current;
                const a     = alphaRef.current;

                if (!nextAggStats) {
                  nextAggStats = s3.map(x=>({ ...x }));
                  nextAggCount = 1;
                } else {
                  nextAggStats = nextAggStats.map((prev, idx) => mergeScore(prev, s3[idx], mode, nextAggCount, a));
                  nextAggCount = nextAggCount + 1;
                }

                const msg = s3.map((v, i)=>`${seatName(i)}：Coop ${v.coop}｜Agg ${v.agg}｜Cons ${v.cons}｜Eff ${v.eff}｜Rob ${v.rob}`).join(' ｜ ');
                nextLog = [...nextLog, `战术画像（本局）：${msg}（已累计 ${nextAggCount} 局）`];
                continue;
              }

              // -------- 文本日志 --------
              if (m.type === 'log' && typeof m.message === 'string') {
                nextLog = [...nextLog, rewrite(m.message)];
                continue;
              }
            } catch (e) { console.error('[ingest:batch]', e, raw); }
          }

          setRoundLords(nextLords);
          setRoundCuts(nextCuts);
          setScoreSeries(nextScores);
          setHands(nextHands); setPlays(nextPlays);
          setTotals(nextTotals); setFinishedCount(nextFinished);
          setLog(nextLog); setLandlord(nextLandlord);
          setWinner(nextWinner); setMultiplier(nextMultiplier); setDelta(nextDelta);
          setAggStats(nextAggStats || null); setAggCount(nextAggCount || 0);
        }
      }

          if (dogId) { try { clearInterval(dogId); } catch {} }
    setLog(l => [...l, `—— 本局流结束 ——`]);
    setAllLogs(prev => [...prev, ...logRef.current, `\n--- End of Round ${labelRoundNo} ---\n`]);
    };

    try {
      for (let i = 0; i < props.rounds; i++) {
        if (controllerRef.current?.signal.aborted) break;
        const thisRound = i + 1;
        await playOneGame(i, thisRound);
        const hasNegative = Array.isArray(totalsRef.current) && totalsRef.current.some(v => (v as number) < 0);
        if (hasNegative) { setLog(l => [...l, '【前端】检测到总分 < 0，停止连打。']); break; }
        await new Promise(r => setTimeout(r, 800 + Math.floor(Math.random() * 600)));
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') setLog(l => [...l, '已手动停止。']);
      else setLog(l => [...l, `错误：${e?.message || e}`]);
    } finally { setRunning(false); }
  };

  const stop = () => { controllerRef.current?.abort(); setRunning(false); };

  const remainingGames = Math.max(0, (props.rounds || 1) - finishedCount);

  // ===== 统一统计打包（All-in-One） =====
type AllBundle = {
  schema: 'ddz-all@1';
  createdAt: string;
  identities: string[];
  trueskill?: TsStore;
  /* radar?: RadarStore;  // disabled */
  ladder?: { schema:'ddz-ladder@1'; updatedAt:string; players: Record<string, any> };
};

const buildAllBundle = (): AllBundle => {
  const identities = [0,1,2].map(seatIdentity);
  let ladder: any = null;
  try {
    const raw = localStorage.getItem('ddz_ladder_store_v1');
    ladder = raw ? JSON.parse(raw) : null;
  } catch {}
  return {
    schema: 'ddz-all@1',
    createdAt: new Date().toISOString(),
    identities,
    trueskill: tsStoreRef.current,
    /* radar excluded */
    ladder,
  };
};

const applyAllBundleInner = (obj:any) => {
  try {
    if (obj?.trueskill?.players) {
      tsStoreRef.current = obj.trueskill as TsStore;
      writeStore(tsStoreRef.current);
    }
    // radar ignored for ALL upload (persistence disabled)

    if (obj?.ladder?.schema === 'ddz-ladder@1') {
      try { localStorage.setItem('ddz_ladder_store_v1', JSON.stringify(obj.ladder)); } catch {}
    }
    setLog(l => [...l, '【ALL】统一上传完成（TS / 画像 / 天梯）。']);
  } catch (e:any) {
    setLog(l => [...l, `【ALL】统一上传失败：${e?.message || e}`]);
  }
};
const handleAllSaveInner = () => {
    const payload = buildAllBundle();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type:'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'ddz_all_stats.json'; a.click();
    setTimeout(()=>URL.revokeObjectURL(url), 1000);
    setLog(l => [...l, '【ALL】已导出统一统计文件。']);
  };

  

  const handleAllRefreshInner = () => {
    applyTsFromStoreByRole(landlordRef.current, '手动刷新');
    applyRadarFromStoreByRole(landlordRef.current, '手动刷新');
    setScoreSeries(prev => prev.map(arr => Array.isArray(arr) ? [...arr] : []));
    setRoundCuts(prev => [...prev]);
    setRoundLords(prev => [...prev]);
    setLog(l => [...l, '【ALL】已刷新面板数据。']);
  };

  useEffect(()=>{
    const onSave = () => handleAllSaveInner();
    const onRefresh = () => handleAllRefreshInner();
    const onUpload = (e: Event) => {
      const ce = e as CustomEvent<any>;
      applyAllBundleInner(ce.detail);
    };
    window.addEventListener('ddz-all-save', onSave as any);
    window.addEventListener('ddz-all-refresh', onRefresh as any);
    window.addEventListener('ddz-all-upload', onUpload as any);
    return () => {
      window.removeEventListener('ddz-all-save', onSave as any);
      window.removeEventListener('ddz-all-refresh', onRefresh as any);
      window.removeEventListener('ddz-all-upload', onUpload as any);
    };
  }, []);

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:8 }}>
        <span style={{ display:'inline-flex', alignItems:'center', padding:'6px 10px', border:'1px solid #e5e7eb', borderRadius:8, fontSize:12, background:'#fff' }}>
          剩余局数：{remainingGames}
        </span>
      </div>

      {/* ========= TrueSkill（实时） ========= */}
      <Section title="TrueSkill（实时）">
        {/* 上传 / 存档 / 刷新 */}
        <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:8 }}>
<div style={{ fontSize:12, color:'#6b7280' }}>按“内置/AI+模型/版本(+HTTP Base)”识别，并区分地主/农民。</div>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12 }}>
          {[0,1,2].map(i=>{
            const stored = getStoredForSeat(i);
            const usingRole: 'overall'|'landlord'|'farmer' =
              landlord==null ? 'overall' : (landlord===i ? 'landlord' : 'farmer');
            return (
              <div key={i} style={{ border:'1px solid #eee', borderRadius:8, padding:10 }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
                  <div><SeatTitle i={i}/> {landlord===i && <span style={{ marginLeft:6, color:'#bf7f00' }}>（地主）</span>}</div>
                </div>
                <div style={{ fontSize:13, color:'#374151' }}>
                  <div>μ：<b>{fmt2(tsArr[i].mu)}</b></div>
                  <div>σ：<b>{fmt2(tsArr[i].sigma)}</b></div>
                  <div>CR = μ − 3σ：<b>{fmt2(tsCr(tsArr[i]))}</b></div>
                </div>

                {/* 区分显示总体/地主/农民三档，并标注当前使用 */}
                <div style={{ borderTop:'1px dashed #eee', marginTop:8, paddingTop:8 }}>
                  <div style={{ fontSize:12, marginBottom:6 }}>
                    当前使用：<b>
                      {usingRole === 'overall' ? '总体档' : usingRole === 'landlord' ? '地主档' : '农民档'}
                    </b>
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:8, fontSize:12, color:'#374151' }}>
                    <div>
                      <div style={{ fontWeight:600, opacity:0.8 }}>总体</div>
                      <div>{muSig(stored.overall)}</div>
                    </div>
                    <div>
                      <div style={{ fontWeight:600, opacity:0.8 }}>地主</div>
                      <div>{muSig(stored.landlord)}</div>
                    </div>
                    <div>
                      <div style={{ fontWeight:600, opacity:0.8 }}>农民</div>
                      <div>{muSig(stored.farmer)}</div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize:12, color:'#6b7280', marginTop:6 }}>
          说明：CR 为置信下界（越高越稳）；每局结算后自动更新（也兼容后端直接推送 TS）。</div>
      </Section>

      {/* ======= 积分下面、手牌上面：雷达图 ======= */}
      <Section title="战术画像（累计，0~5）">
        {/* Radar：上传 / 存档 / 刷新 */}
        <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:8 }}>
<div style={{ fontSize:12, color:'#6b7280' }}>按“内置/AI+模型/版本(+HTTP Base)”识别，并区分地主/农民。</div>
        </div>

        <RadarPanel
          aggStats={aggStats}
          aggCount={aggCount}
          aggMode={aggMode}
          alpha={alpha}
          onChangeMode={setAggMode}
          onChangeAlpha={setAlpha}
        />
      </Section>

      
      <Section title="出牌评分（每局动态）">
        
<div style={{ fontSize:12, color:'#6b7280', marginBottom:6 }}>每局开始底色按“本局地主”的线色淡化显示；上传文件可替换/叠加历史，必要时点“刷新”。</div>
        <ScoreTimeline series={scoreSeries} bands={roundCuts} landlords={roundLords} labels={[0,1,2].map(i=>agentIdForIndex(i))} height={240} />
      </Section>
      <div style={{ marginTop:10 }}></div>
      <Section title="评分统计（每局汇总）">
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>
          {[0,1,2].map(i=>{
            const st = scoreStats[i];
            return (
              <div key={i} style={{ border:'1px solid #eee', borderRadius:8, padding:8, background:'#fff' }}>
                <div style={{ fontWeight:700, marginBottom:6 }}><SeatTitle i={i} /></div>
                <div style={{ fontSize:12, color:'#6b7280' }}>局数：{st.rounds}</div>
                <div style={{ fontSize:12, color:'#6b7280' }}>总体均值：{st.overallAvg.toFixed(3)}</div>
                <div style={{ fontSize:12, color:'#6b7280' }}>最近一局均值：{st.lastAvg.toFixed(3)}</div>
                <div style={{ fontSize:12, color:'#6b7280' }}>最好局均值：{st.best.toFixed(3)}</div>
                <div style={{ fontSize:12, color:'#6b7280' }}>最差局均值：{st.worst.toFixed(3)}</div>
                {/* 分布曲线（每局均值的分布） */}
                
                {/* 分布直方图（每手score汇总：横轴=score，纵轴=频次；固定20桶） */}
                {(() => {
                  const samples = (scoreSeries[i] || []).filter(v => typeof v === 'number' && !Number.isNaN(v)) as number[];
                  if (!samples.length) return null;
                  const pad = 6, W = 220, H = 72;
                  // μ & σ 基于所有出牌评分样本
                  const mu = samples.reduce((a,b)=>a+b,0) / samples.length;
                  const sg = Math.sqrt(Math.max(0, samples.reduce((a,b)=>a + (b-mu)*(b-mu), 0) / samples.length));
                  // 固定20桶
                  const bins = 20;
                  const lo = Math.min(...samples);
                  const hi0 = Math.max(...samples);
                  const hi = hi0===lo ? lo + 1 : hi0; // 防零宽
                  const x = (v:number)=> pad + (hi>lo ? (v-lo)/(hi-lo) : 0.5) * (W - 2*pad);
                  const barW = (W - 2*pad) / bins;
                  // 计数
                  const counts = new Array(bins).fill(0);
                  for (const v of samples) {
                    let k = Math.floor((v - lo) / (hi - lo) * bins);
                    if (k < 0) k = 0; if (k >= bins) k = bins - 1;
                    counts[k]++;
                  }
                  const binWidthVal = (hi - lo) / bins;
                  const densities = counts.map(c => c / (samples.length * (binWidthVal || 1)));
                  const maxD = Math.max(...densities) || 1;
                  const bars = densities.map((d, k) => {
                    const x0 = pad + k * barW + 0.5;
                    const h = (H - 2*pad) * (d / maxD);
                    const y0 = H - pad - h;
                    return <rect key={k} x={x0} y={y0} width={Math.max(1, barW - 1)} height={Math.max(0, h)} fill="#9ca3af" opacity={0.45} />;
                  });
                  // μ & ±1σ 标注
                  const meanX = x(mu);
                  const sigL = x(mu - sg);
                  const sigR = x(mu + sg);
                  return (
                    <svg width={W} height={H} style={{ display:'block', marginTop:6 }}>
                      <rect x={0} y={0} width={W} height={H} fill="#ffffff" stroke="#e5e7eb"/>
                      {bars}
                      <line x1={meanX} y1={pad} x2={meanX} y2={H-pad} stroke="#ef4444" strokeDasharray="4 3" />
                      <line x1={sigL} y1={pad} x2={sigL} y2={H-pad} stroke="#60a5fa" strokeDasharray="2 3" />
                      <line x1={sigR} y1={pad} x2={sigR} y2={H-pad} stroke="#60a5fa" strokeDasharray="2 3" />
                      <text x={meanX+4} y={12} fontSize={10} fill="#ef4444">μ={mu.toFixed(2)}</text>
                      <text x={sigL+4} y={24} fontSize={10} fill="#60a5fa">-1σ</text>
                      <text x={sigR+4} y={24} fontSize={10} fill="#60a5fa">+1σ</text>
                    </svg>
                  );
                })()}
        
              </div>
            );
          })}
        </div>
      </Section>

<Section title="手牌">
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:8 }}>
          {[0,1,2].map(i=>(
            <div key={i} style={{ border:'1px solid #eee', borderRadius:8, padding:8, position:'relative' }}>
                            <div style={{ position:'absolute', top:8, right:8, fontSize:16, fontWeight:800, background:'#fff', border:'1px solid #eee', borderRadius:6, padding:'2px 6px' }}>{totals[i]}</div>
<div style={{ marginBottom:6 }}>
                <SeatTitle i={i} /> {landlord === i && <span style={{ marginLeft:6, color:'#bf7f00' }}>（地主）</span>}
              </div>
              <Hand cards={hands[i]} />
            </div>
          ))}
        </div>
      </Section>

      <Section title="出牌">
        <div style={{ border:'1px dashed #eee', borderRadius:8, padding:'6px 8px' }}>
          {plays.length === 0
            ? <div style={{ opacity:0.6 }}>（尚无出牌）</div>
            : plays.map((p, idx) => <PlayRow key={idx} seat={p.seat} move={p.move} cards={p.cards} reason={p.reason} />)
          }
        </div>
      </Section>

      <Section title="结果">
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12 }}>
          <div style={{ border:'1px solid #eee', borderRadius:8, padding:10 }}>
            <div>倍数</div>
            <div style={{ fontSize:24, fontWeight:800 }}>{multiplier}</div>
          </div>
          <div style={{ border:'1px solid #eee', borderRadius:8, padding:10 }}>
            <div>胜者</div>
            <div style={{ fontSize:24, fontWeight:800 }}>{winner == null ? '—' : seatName(winner)}</div>
          </div>
          <div style={{ border:'1px solid #eee', borderRadius:8, padding:10 }}>
            <div>本局加减分</div>
            <div style={{ fontSize:20, fontWeight:700 }}>{delta ? delta.join(' / ') : '—'}</div>
          </div>
        </div>
      </Section>

      <div style={{ display:'flex', gap:8 }}>
        <button onClick={start} style={{ padding:'8px 12px', borderRadius:8, background:'#222', color:'#fff' }}>开始</button>
        <button onClick={stop} style={{ padding:'8px 12px', borderRadius:8 }}>停止</button>
      </div>

      <div style={{ marginTop:18 }}>
        <Section title="">
  <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
    <div style={{ fontWeight:700 }}>运行日志</div>
    <button
      onClick={() => { try { const lines=(allLogsRef.current||[]) as string[]; const ts=new Date().toISOString().replace(/[:.]/g,'-'); const text=lines.length?lines.join('\n'):'（暂无）'; const blob=new Blob([text],{type:'text/plain;charset=utf-8'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`run-log_${ts}.txt`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1200);} catch(e){ console.error('[runlog] save error', e); } }}
      style={{ padding:'6px 10px', border:'1px solid #e5e7eb', borderRadius:8, background:'#fff' }}
    >存档</button>
  </div>

<div style={{ border:'1px solid #eee', borderRadius:8, padding:'8px 10px', maxHeight:420, overflow:'auto', background:'#fafafa' }}>
            {log.length === 0 ? <div style={{ opacity:0.6 }}>（暂无）</div> : log.map((t, idx) => <LogLine key={idx} text={t} />)}
          </div>
        
</Section>
      </div>
    </div>
  );
}

function RadarPanel({
  aggStats, aggCount, aggMode, alpha,
  onChangeMode, onChangeAlpha,
}:{ aggStats: Score5[] | null; aggCount: number; aggMode:'mean'|'ewma'; alpha:number;
   onChangeMode:(m:'mean'|'ewma')=>void; onChangeAlpha:(a:number)=>void; }) {
  const [mode, setMode] = useState<'mean'|'ewma'>(aggMode);
  const [a, setA] = useState<number>(alpha);

  useEffect(()=>{ setMode(aggMode); }, [aggMode]);
  useEffect(()=>{ setA(alpha); }, [alpha]);

  return (
    <>
      <div style={{ display:'flex', gap:12, alignItems:'center', marginBottom:8 }}>
        <label>
          汇总方式
          <select value={mode} onChange={e=>{ const v=e.target.value as ('mean'|'ewma'); setMode(v); onChangeMode(v); }} style={{ marginLeft:6 }}>
            <option value="ewma">指数加权（推荐）</option>
            <option value="mean">简单平均</option>
          </select>
        </label>
        {mode === 'ewma' && (
          <label>
            α（0.05–0.95）
            <input type="number" min={0.05} max={0.95} step={0.05}
              value={a}
              onChange={e=>{
                const v = Math.min(0.95, Math.max(0.05, Number(e.target.value)||0.35));
                setA(v); onChangeAlpha(v);
              }}
              style={{ width:80, marginLeft:6 }}
            />
          </label>
        )}
        <div style={{ fontSize:12, color:'#6b7280' }}>
          {mode==='ewma' ? '越大越看重最近几局' : `已累计 ${aggCount} 局`}
        </div>
      </div>

      {aggStats
        ? (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12 }}>
            {[0,1,2].map(i=>(
              <RadarChart key={i} title={`${['甲','乙','丙'][i]}（累计）`} scores={aggStats[i]} />
            ))}
          </div>
        )
        : <div style={{ opacity:0.6 }}>（等待至少一局完成后生成累计画像）</div>
      }
    </>
  );
}

/* ========= 默认值（含“清空”按钮的重置） ========= */
const DEFAULTS = {
  enabled: true,
  rounds: 10,
  startScore: 100,
  rob: true,
  four2: 'both' as Four2Policy,
  farmerCoop: true,
  seatDelayMs: [1000,1000,1000] as number[],
  seats: ['built-in:greedy-max','built-in:greedy-min','built-in:random-legal'] as BotChoice[],
  // 让选择提供商时自动写入推荐模型；避免初始就带上 OpenAI 的模型名
  seatModels: ['', '', ''],
  seatKeys: [{ openai:'' }, { gemini:'' }, { httpBase:'', httpToken:'' }] as any[],
};

function Home() {
  const [resetKey, setResetKey] = useState<number>(0);
  const [enabled, setEnabled] = useState<boolean>(DEFAULTS.enabled);
  const [rounds, setRounds] = useState<number>(DEFAULTS.rounds);
  const [startScore, setStartScore] = useState<number>(DEFAULTS.startScore);
  const [turnTimeoutSecs, setTurnTimeoutSecs] = useState<number[]>([30,30,30]);

  const [turnTimeoutSec, setTurnTimeoutSec] = useState<number>(30);

  const [rob, setRob] = useState<boolean>(DEFAULTS.rob);
  const [four2, setFour2] = useState<Four2Policy>(DEFAULTS.four2);
  const [farmerCoop, setFarmerCoop] = useState<boolean>(DEFAULTS.farmerCoop);
  const [seatDelayMs, setSeatDelayMs] = useState<number[]>(DEFAULTS.seatDelayMs);
  const setSeatDelay = (i:number, v:number|string) => setSeatDelayMs(arr => { const n=[...arr]; n[i]=Math.max(0, Math.floor(Number(v)||0)); return n; });

  const [seats, setSeats] = useState<BotChoice[]>(DEFAULTS.seats);
  const [seatModels, setSeatModels] = useState<string[]>(DEFAULTS.seatModels);
  const [seatKeys, setSeatKeys] = useState(DEFAULTS.seatKeys);

  const [liveLog, setLiveLog] = useState<string[]>([]);

  const doResetAll = () => {
    setEnabled(DEFAULTS.enabled); setRounds(DEFAULTS.rounds); setStartScore(DEFAULTS.startScore);
    setRob(DEFAULTS.rob); setFour2(DEFAULTS.four2); setFarmerCoop(DEFAULTS.farmerCoop);
    setSeatDelayMs([...DEFAULTS.seatDelayMs]); setSeats([...DEFAULTS.seats]);
    setSeatModels([...DEFAULTS.seatModels]); setSeatKeys(DEFAULTS.seatKeys.map((x:any)=>({ ...x })));
    setLiveLog([]); setResetKey(k => k + 1);
    try { localStorage.removeItem('ddz_ladder_store_v1'); } catch {}
    try { window.dispatchEvent(new Event('ddz-all-refresh')); } catch {}
  };
  // —— 统一统计（TS + Radar + 出牌评分 + 评分统计）外层上传入口 ——
  const allFileRef = useRef<HTMLInputElement|null>(null);
  const handleAllFileUploadHome = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const obj = JSON.parse(String(rd.result || '{}'));
        window.dispatchEvent(new CustomEvent('ddz-all-upload', { detail: obj }));
      } catch (err) {
        console.error('[ALL-UPLOAD] parse error', err);
      } finally {
        if (allFileRef.current) allFileRef.current.value = '';
      }
    };
    rd.readAsText(f);
  };
  return (
    <div style={{ maxWidth: 1080, margin:'24px auto', padding:'0 16px' }}>
      <h1 style={{ fontSize:28, fontWeight:900, margin:'6px 0 16px' }}>斗地主 · Fight the Landlord</h1>

      <div style={{ border:'1px solid #eee', borderRadius:12, padding:14, marginBottom:16 }}>
        <div style={{ fontSize:18, fontWeight:800, marginBottom:6 }}>对局设置</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap:12, gridAutoFlow:'row dense' }}>
          <div>
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <label style={{ display:'flex', alignItems:'center', gap:8 }}>
                启用对局
                <input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)} />
              </label>
              <button onClick={doResetAll} style={{ padding:'4px 10px', border:'1px solid #e5e7eb', borderRadius:8, background:'#fff' }}>
                清空
              </button>
            </div>
            <div style={{ fontSize:12, color:'#6b7280', marginTop:4 }}>关闭后不可开始/继续对局；再次勾选即可恢复。</div>
          </div>

          <label>局数
            <input type="number" min={1} step={1} value={rounds} onChange={e=>setRounds(Math.max(1, Math.floor(Number(e.target.value)||1)))} style={{ width:'100%' }}/>
          </label>
          
          
<div style={{ gridColumn:'1 / 2' }}>
  <div style={{ display:'flex', alignItems:'center', gap:24 }}>
    <label style={{ display:'flex', alignItems:'center', gap:8 }}>
      可抢地主
      <input type="checkbox" checked={rob} onChange={e=>setRob(e.target.checked)} />
    </label>
    <label style={{ display:'flex', alignItems:'center', gap:8 }}>
      农民配合
      <input type="checkbox" checked={farmerCoop} onChange={e=>setFarmerCoop(e.target.checked)} />
    </label>
  </div>
  <div style={{ display:'flex', alignItems:'center', gap:10, marginTop:6, flexWrap:'wrap' }}>
    <label style={{ display:'flex', alignItems:'center', gap:8 }}>
      天梯  /  TrueSkill
    <input
      ref={allFileRef}
      type="file"
      accept="application/json"
      style={{ display:'none' }}
      onChange={handleAllFileUploadHome}
    />
    <button
      onClick={()=>allFileRef.current?.click()}
      style={{ padding:'3px 10px', border:'1px solid #e5e7eb', borderRadius:8, background:'#fff' }}
    >上传</button>
    
    </label>
<button
      onClick={()=>window.dispatchEvent(new Event('ddz-all-save'))}
      style={{ padding:'3px 10px', border:'1px solid #e5e7eb', borderRadius:8, background:'#fff' }}
    >存档</button>
  </div>
</div>
<div style={{ gridColumn:'2 / 3' }}>
  <label>初始分
          <input type="number" step={10} value={startScore}
           onChange={e=>setStartScore(Number(e.target.value)||0)}
           style={{ width:'100%' }} />
          </label>
</div>
          <div style={{ gridColumn:'2 / 3' }}>
  <label>4带2 规则
            <select value={four2} onChange={e=>setFour2(e.target.value as Four2Policy)} style={{ width:'100%' }}>
              <option value="both">都可</option>
              <option value="2singles">两张单牌</option>
              <option value="2pairs">两对</option>
            </select>
          </label>
</div>
        </div>

        <div style={{ marginTop:10, borderTop:'1px dashed #eee', paddingTop:10 }}>
          <div style={{ fontWeight:700, marginBottom:6 }}>每家 AI 设置（独立）</div>

          <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12 }}>
            {[0,1,2].map(i=>(
              <div key={i} style={{ border:'1px dashed #ccc', borderRadius:8, padding:10 }}>
                <div style={{ fontWeight:700, marginBottom:8 }}><SeatTitle i={i} /></div>

                <label style={{ display:'block', marginBottom:6 }}>
                  选择
                  <select
                    value={seats[i]}
                    onChange={e=>{
                      const v = e.target.value as BotChoice;
                      setSeats(arr => { const n=[...arr]; n[i] = v; return n; });
                      // 新增：切换提供商时，把当前输入框改成该提供商的推荐模型
                      setSeatModels(arr => { const n=[...arr]; n[i] = defaultModelFor(v); return n; });
                    }}
                    style={{ width:'100%' }}
                  >
                    <optgroup label="内置">
                      <option value="built-in:greedy-max">Greedy Max</option>
                      <option value="built-in:greedy-min">Greedy Min</option>
                      <option value="built-in:random-legal">Random Legal</option>
                      <option value="built-in:mininet">MiniNet</option>
                      <option value="built-in:ally-support">AllySupport</option>
                      <option value="built-in:endgame-rush">EndgameRush</option>
                    </optgroup>
                    <optgroup label="AI">
                      <option value="ai:openai">OpenAI</option>
                      <option value="ai:gemini">Gemini</option>
                      <option value="ai:grok">Grok</option>
                      <option value="ai:kimi">Kimi</option>
                      <option value="ai:qwen">Qwen</option>
                      <option value="ai:deepseek">DeepSeek</option>
                      <option value="http">HTTP</option>
                    </optgroup>
                  </select>
                </label>

                {seats[i].startsWith('ai:') && (
                  <label style={{ display:'block', marginBottom:6 }}>
                    模型（可选）
                    <input
                      type="text"
                      value={seatModels[i]}
                      placeholder={defaultModelFor(seats[i])}
                      onChange={e=>{
                        const v = e.target.value;
                        setSeatModels(arr => { const n=[...arr]; n[i] = v; return n; });
                      }}
                      style={{ width:'100%' }}
                    />
                    <div style={{ fontSize:12, color:'#777', marginTop:4 }}>
                      留空则使用推荐：{defaultModelFor(seats[i])}
                    </div>
                  </label>
                )}

                {seats[i] === 'ai:openai' && (
                  <label style={{ display:'block', marginBottom:6 }}>
                    OpenAI API Key
                    <input type="password" value={seatKeys[i]?.openai||''}
                      onChange={e=>{
                        const v = e.target.value;
                        setSeatKeys(arr => { const n=[...arr]; n[i] = { ...(n[i]||{}), openai:v }; return n; });
                      }}
                      style={{ width:'100%' }} />
                  </label>
                )}

                {seats[i] === 'ai:gemini' && (
                  <label style={{ display:'block', marginBottom:6 }}>
                    Gemini API Key
                    <input type="password" value={seatKeys[i]?.gemini||''}
                      onChange={e=>{
                        const v = e.target.value;
                        setSeatKeys(arr => { const n=[...arr]; n[i] = { ...(n[i]||{}), gemini:v }; return n; });
                      }}
                      style={{ width:'100%' }} />
                  </label>
                )}

                {seats[i] === 'ai:grok' && (
                  <label style={{ display:'block', marginBottom:6 }}>
                    xAI (Grok) API Key
                    <input type="password" value={seatKeys[i]?.grok||''}
                      onChange={e=>{
                        const v = e.target.value;
                        setSeatKeys(arr => { const n=[...arr]; n[i] = { ...(n[i]||{}), grok:v }; return n; });
                      }}
                      style={{ width:'100%' }} />
                  </label>
                )}

                {seats[i] === 'ai:kimi' && (
                  <label style={{ display:'block', marginBottom:6 }}>
                    Kimi API Key
                    <input type="password" value={seatKeys[i]?.kimi||''}
                      onChange={e=>{
                        const v = e.target.value;
                        setSeatKeys(arr => { const n=[...arr]; n[i] = { ...(n[i]||{}), kimi:v }; return n; });
                      }}
                      style={{ width:'100%' }} />
                  </label>
                )}

                {seats[i] === 'ai:qwen' && (
                  <label style={{ display:'block', marginBottom:6 }}>
                    Qwen API Key
                    <input type="password" value={seatKeys[i]?.qwen||''}
                      onChange={e=>{
                        const v = e.target.value;
                        setSeatKeys(arr => { const n=[...arr]; n[i] = { ...(n[i]||{}), qwen:v }; return n; });
                      }}
                      style={{ width:'100%' }} />
                  </label>
                )}

                {seats[i] === 'ai:deepseek' && (
                  <label style={{ display:'block', marginBottom:6 }}>
                    DeepSeek API Key
                    <input type="password" value={seatKeys[i]?.deepseek||''}
                      onChange={e=>{
                        const v = e.target.value;
                        setSeatKeys(arr => { const n=[...arr]; n[i] = { ...(n[i]||{}), deepseek:v }; return n; });
                      }}
                      style={{ width:'100%' }} />
                  </label>
                )}

                {seats[i] === 'http' && (
                  <>
                    <label style={{ display:'block', marginBottom:6 }}>
                      HTTP Base / URL
                      <input type="text" value={seatKeys[i]?.httpBase||''}
                        onChange={e=>{
                          const v = e.target.value;
                          setSeatKeys(arr => { const n=[...arr]; n[i] = { ...(n[i]||{}), httpBase:v }; return n; });
                        }}
                        style={{ width:'100%' }} />
                    </label>
                    <label style={{ display:'block', marginBottom:6 }}>
                      HTTP Token（可选）
                      <input type="password" value={seatKeys[i]?.httpToken||''}
                        onChange={e=>{
                          const v = e.target.value;
                          setSeatKeys(arr => { const n=[...arr]; n[i] = { ...(n[i]||{}), httpToken:v }; return n; });
                        }}
                        style={{ width:'100%' }} />
                    </label>
                  </>
                )}
              </div>
            ))}
          </div>

          <div style={{ marginTop:12 }}>
            <div style={{ fontWeight:700, marginBottom:6 }}>每家出牌最小间隔 (ms)</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12 }}>
              {[0,1,2].map(i=>(
                <div key={i} style={{ border:'1px dashed #eee', borderRadius:6, padding:10 }}>
                  <div style={{ fontWeight:700, marginBottom:8 }}>{seatName(i)}</div>
                  <label style={{ display:'block' }}>
                    最小间隔 (ms)
                    <input
                      type="number" min={0} step={100}
                      value={ (seatDelayMs[i] ?? 0) }
                      onChange={e=>setSeatDelay(i, e.target.value)}
                      style={{ width:'100%' }}
                    />
                  </label>
                </div>

              ))}
            </div>
          </div>
          <div style={{ marginTop:12 }}>
            <div style={{ fontWeight:700, marginBottom:6 }}>每家思考超时（秒）</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12 }}>
              {[0,1,2].map(i=>(
                <div key={i} style={{ border:'1px dashed #eee', borderRadius:6, padding:10 }}>
                  <div style={{ fontWeight:700, marginBottom:8 }}>{seatName(i)}</div>
                  <label style={{ display:'block' }}>
                    弃牌时间（秒）
                    <input
                      type="number" min={5} step={1}
                      value={ (turnTimeoutSecs[i] ?? 30) }
                      onChange={e=>{
                        const v = Math.max(5, Math.floor(Number(e.target.value)||0));
                        setTurnTimeoutSecs(arr=>{ const cp=[...(arr||[30,30,30])]; cp[i]=v; return cp; });
                      }}
                      style={{ width:'100%' }}
                    />
                  </label>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div style={{ border:'1px solid #eee', borderRadius:12, padding:14 }}>
        {/* —— 天梯图 —— */}
      <LadderPanel />
<div style={{ fontSize:18, fontWeight:800, marginBottom:6 }}>对局</div>
        <LivePanel
          key={resetKey}
          rounds={rounds}
          startScore={startScore}
          seatDelayMs={seatDelayMs}
          enabled={enabled}
          rob={rob}
          four2={four2}
          seats={seats}
          seatModels={seatModels}
          seatKeys={seatKeys}
          farmerCoop={farmerCoop}
          onLog={setLiveLog}
        
          turnTimeoutSecs={turnTimeoutSecs}
        />
      </div>
    </div>
  );
}

export default Home;

/* ================ 实时曲线：每手牌得分（按地主淡色分局） ================= */
function ScoreTimeline(
  { series, bands = [], landlords = [], labels = ['甲','乙','丙'], height = 220 }:
  { series:(number|null)[][]; bands?:number[]; landlords?:number[]; labels?:string[]; height?:number }
) {
  const ref = useRef<HTMLDivElement|null>(null);
  const [w, setW] = useState(600);
  const [hover, setHover] = useState<null | { si:number; idx:number; x:number; y:number; v:number }>(null);

  useEffect(()=>{
    const el = ref.current; if(!el) return;
    const ro = new ResizeObserver(()=> setW(el.clientWidth || 600));
    ro.observe(el);
    return ()=> ro.disconnect();
  }, []);

  const data = series || [[],[],[]];
  const n = Math.max(data[0]?.length||0, data[1]?.length||0, data[2]?.length||0);
  const values:number[] = [];
  for (const arr of data) for (const v of (arr||[])) if (typeof v==='number') values.push(v);
  const vmin = values.length ? Math.min(...values) : -5;
  const vmax = values.length ? Math.max(...values) : 5;
  const pad = (vmax - vmin) * 0.15 + 1e-6;
  const y0 = vmin - pad, y1 = vmax + pad;

  const width = Math.max(320, w);
  const heightPx = height;
  const left = 36, right = 10, top = 10, bottom = 22;
  const iw = Math.max(10, width - left - right);
  const ih = Math.max(10, heightPx - top - bottom);

  const x = (i:number)=> (n<=1 ? 0 : (i/(n-1))*iw);
  const y = (v:number)=> ih - ( (v - y0) / (y1 - y0) ) * ih;

  const colorLine = ['#ef4444', '#3b82f6', '#10b981'];
  const colorBand = ['rgba(239,68,68,0.08)','rgba(59,130,246,0.08)','rgba(16,185,129,0.10)'];
  const colors = colorLine;

  const cuts = Array.isArray(bands) && bands.length ? [...bands] : [0];
  cuts.sort((a,b)=>a-b);
  if (cuts[0] !== 0) cuts.unshift(0);
  if (cuts[cuts.length-1] !== n) cuts.push(n);

  const landlordsArr = Array.isArray(landlords) ? landlords.slice(0) : [];
  while (landlordsArr.length < Math.max(0, cuts.length-1)) landlordsArr.push(-1);

  // —— 底色兜底：把未知地主段回填为最近一次已知的地主（前向填充 + 首段回填） ——
  const segCount = Math.max(0, cuts.length - 1);
  const landlordsFilled = landlordsArr.slice(0, segCount);
  while (landlordsFilled.length < segCount) landlordsFilled.push(-1);
  for (let j=0; j<landlordsFilled.length; j++) {
    const v = landlordsFilled[j];
    if (!(v===0 || v===1 || v===2)) landlordsFilled[j] = j>0 ? landlordsFilled[j-1] : landlordsFilled[j];
  }
  if (landlordsFilled.length && !(landlordsFilled[0]===0 || landlordsFilled[0]===1 || landlordsFilled[0]===2)) {
    const k = landlordsFilled.findIndex(v => v===0 || v===1 || v===2);
    if (k >= 0) { for (let j=0; j<k; j++) landlordsFilled[j] = landlordsFilled[k]; }
  }

  const makePath = (arr:(number|null)[])=>{
    let d=''; let open=false;
    const cutSet = new Set(cuts);
    for (let i=0;i<n;i++){
      if (cutSet.has(i) && i!==0) { open = false; }
      const v = arr[i];
      if (typeof v !== 'number') { open=false; continue; }
      const px = x(i), py = y(v);
      d += (open? ` L ${px} ${py}` : `M ${px} ${py}`);
      open = true;
    }
    return d;
  };

  // x 轴刻度（最多 12 个）
  const ticks = []; const maxTicks = 12;
  for (let i=0;i<n;i++){
    const step = Math.ceil(n / maxTicks);
    if (i % step === 0) ticks.push(i);
  }
  // y 轴刻度（5 条）
  const yTicks = []; for (let k=0;k<=4;k++){ yTicks.push(y0 + (k/4)*(y1-y0)); }

  // —— 悬浮处理 —— //
  const seatName = (i:number)=> labels?.[i] ?? ['甲','乙','丙'][i];
  const showTip = (si:number, idx:number, v:number) => {
    setHover({ si, idx, v, x: x(idx), y: y(v) });
  };
  const hideTip = () => setHover(null);

  // 估算文本宽度（无需测量 API）
  const tipText = hover ? `${seatName(hover.si)} 第${hover.idx+1}手：${hover.v.toFixed(2)}` : '';
  const tipW = 12 + tipText.length * 7;  // 近似
  const tipH = 20;
  const tipX = hover ? Math.min(Math.max(0, hover.x + 10), Math.max(0, iw - tipW)) : 0;
  const tipY = hover ? Math.max(0, hover.y - (tipH + 10)) : 0;

  return (
    <div ref={ref} style={{ width:'100%' }}>
      <svg width={width} height={heightPx} style={{ display:'block', width:'100%' }}>
        <g transform={`translate(${left},${top})`} onMouseLeave={hideTip}>
          {/* 按地主上色的局间底色 */}
          {cuts.slice(0, Math.max(0, cuts.length-1)).map((st, i)=>{
            const ed = cuts[i+1];
            if (ed <= st) return null;
            const x0 = x(st);
            const x1 = x(Math.max(st, ed-1));
            const w  = Math.max(0.5, x1 - x0);
            const lord = landlordsFilled[i] ?? -1;
            const fill = (lord===0||lord===1||lord===2) ? colorBand[lord] : (i%2===0 ? '#ffffff' : '#f8fafc');
            return <rect key={'band'+i} x={x0} y={0} width={w} height={ih} fill={fill} />;
          })}

          {/* 网格 + 轴 */}
          <line x1={0} y1={ih} x2={iw} y2={ih} stroke="#e5e7eb" />
          <line x1={0} y1={0} x2={0} y2={ih} stroke="#e5e7eb" />
          {yTicks.map((v,i)=>(
            <g key={i} transform={`translate(0,${y(v)})`}>
              <line x1={0} y1={0} x2={iw} y2={0} stroke="#f3f4f6" />
              <text x={-6} y={4} fontSize={10} fill="#6b7280" textAnchor="end">{v.toFixed(1)}</text>
            </g>
          ))}
          {ticks.map((i,idx)=>(
            <g key={idx} transform={`translate(${x(i)},0)`}>
              <line x1={0} y1={0} x2={0} y2={ih} stroke="#f8fafc" />
              <text x={0} y={ih+14} fontSize={10} fill="#6b7280" textAnchor="middle">{i+1}</text>
            </g>
          ))}

          {/* 三条曲线 + 数据点 */}
          {data.map((arr, si)=>(
            <g key={'g'+si}>
              <path d={makePath(arr)} fill="none" stroke={colors[si]} strokeWidth={2} />
              {arr.map((v,i)=> (typeof v==='number') && (
                <circle
                  key={'c'+si+'-'+i}
                  cx={x(i)} cy={y(v)} r={2.5} fill={colors[si]}
                  style={{ cursor:'crosshair' }}
                  onMouseEnter={()=>showTip(si, i, v)}
                  onMouseMove={()=>showTip(si, i, v)}
                  onMouseLeave={hideTip}
                >
                  {/* 备用：系统 tooltip（可保留） */}
                  <title>{`${seatName(si)} 第${i+1}手：${v.toFixed(2)}`}</title>
                </circle>
              ))}
            </g>
          ))}

          {/* 悬浮提示框 */}
          {hover && (
            <g transform={`translate(${tipX},${tipY})`} pointerEvents="none">
              <rect x={0} y={0} width={tipW} height={tipH} rx={6} ry={6} fill="#111111" opacity={0.9} />
              <text x={8} y={13} fontSize={11} fill="#ffffff">{tipText}</text>
            </g>
          )}
        </g>
      </svg>

      {/* 图例 */}
      <div style={{ display:'flex', gap:12, marginTop:6, fontSize:12, color:'#374151' }}>
        {[0,1,2].map(i=>(
          <div key={i} style={{ display:'flex', alignItems:'center', gap:6 }}>
            <span style={{ width:10, height:10, borderRadius:5, background:colors[i], display:'inline-block' }} />
            <span>{labels?.[i] ?? ['甲','乙','丙'][i]}</span>
          </div>
        ))}
        <div style={{ marginLeft:'auto', color:'#6b7280' }}>横轴：第几手牌 ｜ 纵轴：score</div>
      </div>
    </div>
  );
}

/* ================ 雷达图（0~5） ================= */
function RadarChart({ title, scores }: { title: string; scores: Score5 }) {
  const vals = [scores.coop, scores.agg, scores.cons, scores.eff, scores.rob];
  const labels = ['配合','激进','保守','效率','抢地主'];
  const size = 180, R = 70, cx = size/2, cy = size/2;

  const ang = (i:number)=> (-90 + i*(360/5)) * Math.PI/180;

  const ringPoints = (r:number)=> Array.from({length:5}, (_,i)=> {
    return `${cx + r * Math.cos(ang(i))},${cy + r * Math.sin(ang(i))}`;
  }).join(' ');

  const valuePoints = Array.from({length:5}, (_,i)=> {
    const r = Math.max(0, Math.min(5, vals[i] ?? 0)) / 5 * R;
    return `${cx + r * Math.cos(ang(i))},${cy + r * Math.sin(ang(i))}`;
  }).join(' ');

  return (
    <div style={{ display:'flex', gap:10, alignItems:'center' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* 环形网格 */}
        {[1,2,3,4].map(k=>{
          const r = (k/4) * R;
          return <polygon key={k} points={ringPoints(r)} fill="none" stroke="#e5e7eb"/>;
        })}
        {/* 轴线 */}
        {Array.from({length:5}, (_,i)=>{
          return <line key={i} x1={cx} y1={cy} x2={cx + R * Math.cos(ang(i))} y2={cy + R * Math.sin(ang(i))} stroke="#e5e7eb"/>;
        })}
        {/* 值多边形 */}
        <polygon points={valuePoints} fill="rgba(59,130,246,0.25)" stroke="#3b82f6" strokeWidth={2}/>
        {/* 标签 */}
        {labels.map((lab, i)=>{
          const lx = cx + (R + 14) * Math.cos(ang(i));
          const ly = cy + (R + 14) * Math.sin(ang(i));
          return <text key={i} x={lx} y={ly} fontSize={11} textAnchor="middle" dominantBaseline="middle" fill="#374151">{lab}</text>;
        })}
      </svg>
      <div style={{ minWidth:60, fontSize:12, color:'#374151' }}>{title}</div>
    </div>
  );
}