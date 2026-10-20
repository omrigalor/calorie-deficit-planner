import { useState, useEffect, useMemo } from 'react';

/* ════════════════════════════════════════════════════════════════════════════
   Calorie Tracker — goal-based deficit planner + food log with macro inference
   - Profile (sex, age, height, weight, activity, goal weight) → BMR (Mifflin-
     St Jeor) → TDEE.
   - User sets target daily intake (defaults to 1000, fully editable). Days-to-
     goal = (weight to lose × 7700 kcal/kg) ÷ (TDEE − intake).
   - Food log: each entry's calories are entered; protein / carbs / fat / fiber
     are inferred from a keyword nutrient database (per-100-kcal profiles) when
     the user doesn't supply them, then a daily diet-quality assessment +
     recommendation is produced.
   Persists to localStorage. Self-contained; no backend.
   ════════════════════════════════════════════════════════════════════════════ */

const KCAL_PER_KG = 7700;            // ~7700 kcal per kg of body fat
const LS_KEY = 'calorie_deficit_planner_v1';

// Local calendar date as YYYY-MM-DD — the per-day storage key. The food log
// and exercise are stored under today's key, so when the date rolls over the
// app naturally shows a fresh day while every past day is retained.
function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const EMPTY_DAY = { log: [], ex: { steps: '', elliptical: '' } };

// Load the dated store; migrate the legacy single-day blob into today's entry.
function loadStore() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    const profile = { ...DEFAULTS, ...(raw.profile || {}) };
    if (raw.days) return { profile, days: raw.days };
    if (raw.log || raw.ex) return { profile, days: { [todayKey()]: { log: raw.log || [], ex: raw.ex || { steps: '', elliptical: '' } } } };
    return { profile, days: {} };
  } catch { return { profile: { ...DEFAULTS }, days: {} }; }
}

// Activity multipliers (Harris-Benedict / Mifflin convention)
const ACTIVITY = [
  { id: 'sedentary',  label: 'Sedentary (little/no exercise)',        mult: 1.2 },
  { id: 'light',      label: 'Light (1–3 days/week)',                 mult: 1.375 },
  { id: 'moderate',   label: 'Moderate (3–5 days/week)',              mult: 1.55 },
  { id: 'active',     label: 'Active (6–7 days/week)',                mult: 1.725 },
  { id: 'very',       label: 'Very active (physical job / 2x day)',   mult: 1.9 },
];

/* ── Nutrient inference ──
   Each food keyword maps to grams of macro per 100 kcal of that food, plus
   fiber (g) per 100 kcal. Derived from USDA FoodData Central typical values.
   When a logged item matches a keyword we estimate macros from its calories;
   otherwise we fall back to a mixed-diet average. */
const FOOD_DB = [
  // [keywords],                         protein/100kcal, carb, fat, fiber
  { k: ['chicken','turkey','breast'],    p: 18.0, c: 0,    f: 2.2, fib: 0 },
  { k: ['beef','steak','burger'],        p: 11.0, c: 0,    f: 8.0, fib: 0 },
  { k: ['salmon','tuna','fish','cod'],   p: 14.0, c: 0,    f: 5.0, fib: 0 },
  { k: ['egg','eggs'],                   p: 8.0,  c: 1.0,  f: 7.0, fib: 0 },
  { k: ['tofu','tempeh'],                p: 11.0, c: 3.0,  f: 6.0, fib: 1.0 },
  { k: ['shrimp','prawn'],               p: 21.0, c: 1.0,  f: 1.5, fib: 0 },
  { k: ['yogurt','greek'],               p: 10.0, c: 6.0,  f: 2.5, fib: 0 },
  { k: ['milk','latte'],                 p: 5.3,  c: 8.0,  f: 5.0, fib: 0 },
  { k: ['cheese','cheddar','mozzarella'],p: 6.3,  c: 1.0,  f: 8.2, fib: 0 },
  { k: ['rice','white rice'],            p: 2.1,  c: 22.0, f: 0.2, fib: 0.3 },
  { k: ['brown rice','quinoa'],          p: 2.7,  c: 20.0, f: 0.8, fib: 1.5 },
  { k: ['bread','toast','bagel'],        p: 3.5,  c: 18.0, f: 1.2, fib: 1.2 },
  { k: ['pasta','noodle','spaghetti'],   p: 3.5,  c: 19.0, f: 0.6, fib: 1.0 },
  { k: ['potato','fries','chips'],       p: 1.3,  c: 14.0, f: 4.0, fib: 1.0 },
  { k: ['oat','oatmeal','granola'],      p: 3.4,  c: 16.0, f: 1.8, fib: 2.4 },
  { k: ['apple','banana','orange','fruit','berry','grape'], p: 0.5, c: 24.0, f: 0.3, fib: 3.0 },
  { k: ['salad','lettuce','spinach','kale','broccoli','vegetable','veggie','carrot'], p: 4.0, c: 14.0, f: 1.0, fib: 8.0 },
  { k: ['beans','lentil','chickpea','hummus'], p: 6.0, c: 16.0, f: 1.5, fib: 7.0 },
  { k: ['nuts','almond','peanut','cashew','walnut'], p: 3.6, c: 3.5, f: 8.5, fib: 1.5 },
  { k: ['avocado'],                      p: 1.2,  c: 5.0,  f: 9.0, fib: 4.0 },
  { k: ['pizza'],                        p: 4.0,  c: 11.0, f: 4.5, fib: 0.8 },
  { k: ['chocolate','candy','cookie','cake','donut','ice cream','dessert'], p: 1.2, c: 12.0, f: 5.5, fib: 0.5 },
  { k: ['soda','cola','juice','energy drink'], p: 0, c: 25.0, f: 0, fib: 0 },
  { k: ['beer','wine','alcohol','cocktail'], p: 0.3, c: 7.0, f: 0, fib: 0 },
  { k: ['protein shake','protein bar','whey'], p: 17.0, c: 5.0, f: 2.0, fib: 1.0 },
];
const MIXED = { p: 4.5, c: 12.5, f: 4.0, fib: 1.5 }; // fallback per 100 kcal

function inferMacros(name, kcal) {
  const lc = (name || '').toLowerCase();
  const hit = FOOD_DB.find(e => e.k.some(k => lc.includes(k)));
  const prof = hit || MIXED;
  const units = kcal / 100;
  return {
    protein: Math.round(prof.p * units),
    carbs:   Math.round(prof.c * units),
    fat:     Math.round(prof.f * units),
    fiber:   Math.round(prof.fib * units * 10) / 10,
    matched: !!hit,
  };
}

function mifflinBMR({ sex, weightKg, heightCm, age }) {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return Math.round(sex === 'female' ? base - 161 : base + 5);
}

/* ── Exercise → calories burned ──
   Steps: ~0.0005 kcal per step per kg bodyweight (≈0.04 kcal/step at 80kg),
   a standard pedometer approximation.
   Elliptical: MET formula kcal/min = MET × 3.5 × kg / 200. Moderate elliptical
   ≈ 5.0 METs. Both scale with the user's actual weight. */
function stepsToKcal(steps, weightKg) { return Math.round(steps * 0.0005 * weightKg); }
function ellipticalToKcal(minutes, weightKg) { return Math.round(minutes * 5.0 * 3.5 * weightKg / 200); }

const num = (v, d = 0) => { const n = parseFloat(v); return isNaN(n) ? d : n; };

const DEFAULTS = {
  // Stored in the current display units (imperial by default — pounds/inches).
  sex: 'male', age: '28', heightCm: '70', weightKg: '187', goalKg: '165',
  activity: 'sedentary', intake: '1000', units: 'imperial',
};

export default function CalorieTracker({ onBack }) {
  const [store, setStore] = useState(loadStore);
  const [food, setFood] = useState({ name: '', kcal: '', protein: '' });
  const [showSetup, setShowSetup] = useState(false);
  const [view, setView] = useState('today'); // 'today' | 'history'
  const [editDate, setEditDate] = useState(null); // YYYY-MM-DD when editing a past day from the calendar

  // Re-render at midnight so "today" rolls over without a manual refresh.
  const [today, setToday] = useState(todayKey());
  useEffect(() => {
    const id = setInterval(() => { const t = todayKey(); setToday(prev => prev !== t ? t : prev); }, 60000);
    return () => clearInterval(id);
  }, []);

  // Persist the whole store.
  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(store)); } catch {}
  }, [store]);

  // Profile persists across all days.
  const p = store.profile;
  const setP = (updater) => setStore(s => ({ ...s, profile: typeof updater === 'function' ? updater(s.profile) : updater }));

  // Today's food log + exercise live under today's date key (auto-resets daily).
  const dayData = store.days[today] || EMPTY_DAY;
  const log = dayData.log;
  const ex = dayData.ex;
  const setDay = (patch) => setStore(s => {
    const d = s.days[today] || EMPTY_DAY;
    return { ...s, days: { ...s.days, [today]: { ...d, ...patch } } };
  });
  const setLog = (updater) => setDay({ log: typeof updater === 'function' ? updater(dayData.log) : updater });
  const setEx = (updater) => setDay({ ex: typeof updater === 'function' ? updater(dayData.ex) : updater });

  // Write to an ARBITRARY day's entry — powers the calendar's per-day editor so
  // past days (e.g. items you forgot to log yesterday) can be amended.
  const setDayFor = (date, updater) => setStore(s => {
    const d = s.days[date] || EMPTY_DAY;
    const next = typeof updater === 'function' ? updater(d) : { ...d, ...updater };
    return { ...s, days: { ...s.days, [date]: next } };
  });

  const set = (k) => (e) => setP(prev => ({ ...prev, [k]: e.target.value }));
  const lbToKg = (lb) => lb * 0.453592, kgToLb = (kg) => kg * 2.20462;
  const inToCm = (i) => i * 2.54;
  const metric = p.units === 'metric';

  // Normalize to metric for the math regardless of display units
  const weightKg = metric ? num(p.weightKg) : lbToKg(num(p.weightKg));
  const goalKg   = metric ? num(p.goalKg)   : lbToKg(num(p.goalKg));
  const heightCm = metric ? num(p.heightCm) : inToCm(num(p.heightCm));

  const calc = useMemo(() => {
    const bmr = mifflinBMR({ sex: p.sex, weightKg, heightCm, age: num(p.age) });
    const mult = (ACTIVITY.find(a => a.id === p.activity) || ACTIVITY[0]).mult;
    const tdee = Math.round(bmr * mult);
    const intake = num(p.intake);
    const dailyDeficit = tdee - intake;             // kcal burned net per day
    const kgToLose = Math.max(0, weightKg - goalKg);
    const totalDeficit = kgToLose * KCAL_PER_KG;
    const days = dailyDeficit > 0 && kgToLose > 0 ? Math.ceil(totalDeficit / dailyDeficit) : null;
    const weeklyKg = dailyDeficit > 0 ? (dailyDeficit * 7) / KCAL_PER_KG : 0;
    // Safety: losing > ~1% bodyweight/week or intake below BMR-ish floor
    const aggressive = weeklyKg > weightKg * 0.0125 || intake < bmr * 0.55;
    const goalDate = days ? new Date(Date.now() + days * 86400000) : null;
    return { bmr, tdee, intake, dailyDeficit, kgToLose, days, weeklyKg, aggressive, goalDate, mult };
  }, [p.sex, p.activity, p.intake, p.age, weightKg, heightCm, goalKg]);

  // ── Exercise calories burned ──
  const stepsBurn = stepsToKcal(num(ex.steps), weightKg);
  const ellipBurn = ellipticalToKcal(num(ex.elliptical), weightKg);
  const exBurned = stepsBurn + ellipBurn;

  // ── Today's totals + diet quality ──
  const totals = log.reduce((a, f) => ({
    kcal: a.kcal + f.kcal, protein: a.protein + f.protein,
    carbs: a.carbs + f.carbs, fat: a.fat + f.fat, fiber: a.fiber + f.fiber,
  }), { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });

  // ── History: every past day, newest first (months of tracking) ──
  const history = useMemo(() => {
    return Object.entries(store.days)
      .filter(([k, d]) => k !== today && ((d.log && d.log.length) || num(d.ex?.steps) || num(d.ex?.elliptical)))
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, d]) => {
        const eaten   = (d.log || []).reduce((s, f) => s + (f.kcal || 0), 0);
        const protein = (d.log || []).reduce((s, f) => s + (f.protein || 0), 0);
        const burned  = stepsToKcal(num(d.ex?.steps), weightKg) + ellipticalToKcal(num(d.ex?.elliptical), weightKg);
        return { date, eaten, protein, burned, net: eaten - burned };
      });
  }, [store.days, today, weightKg]);
  const daysTracked = history.length + (log.length || num(ex.steps) || num(ex.elliptical) ? 1 : 0);

  // ── Forecasts: days-to-goal under three scenarios ──
  // (target intake, actual average so far, and today's live pace)
  const loggedDays = [
    ...history.map(h => ({ eaten: h.eaten, burned: h.burned })),
    ...((totals.kcal > 0 || exBurned > 0) ? [{ eaten: totals.kcal, burned: exBurned }] : []),
  ].filter(d => d.eaten > 0);
  const avgEaten  = loggedDays.length ? Math.round(loggedDays.reduce((s, d) => s + d.eaten, 0) / loggedDays.length) : 0;
  const avgBurned = loggedDays.length ? Math.round(loggedDays.reduce((s, d) => s + d.burned, 0) / loggedDays.length) : 0;
  const mkDays = (deficit) => (deficit > 0 && calc.kgToLose > 0) ? Math.ceil(calc.kgToLose * KCAL_PER_KG / deficit) : null;
  // Actual-average and today's-pace both use the real daily net (maintenance +
  // exercise − eaten), so on your first logged day they're identical. The
  // target column is the pure plan at your intake (no exercise).
  const daysTarget = mkDays(calc.tdee - num(p.intake));
  const daysAvg    = avgEaten ? mkDays(calc.tdee + avgBurned - avgEaten) : null;
  const daysToday  = mkDays(calc.tdee + exBurned - totals.kcal);
  const dateOf = (days) => days ? fmtDate(new Date(Date.now() + days * 86400000)) : '—';

  function addFood() {
    const kcal = num(food.kcal);
    if (!food.name.trim() || kcal <= 0) return;
    const m = inferMacros(food.name, kcal);
    // If the user typed a protein value, trust it over the estimate.
    const proteinManual = String(food.protein).trim() !== '' && !isNaN(parseFloat(food.protein));
    const protein = proteinManual ? Math.round(num(food.protein)) : m.protein;
    setLog(l => [...l, { id: Date.now(), name: food.name.trim(), kcal, ...m, protein, proteinManual }]);
    setFood({ name: '', kcal: '', protein: '' });
  }
  const removeFood = (id) => setLog(l => l.filter(f => f.id !== id));

  const uW = metric ? 'kg' : 'lb', uH = metric ? 'cm' : 'in';
  const fmtDate = (d) => d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

  const field = "w-full bg-white/5 border border-white/12 rounded-xl px-3 py-2.5 text-sm text-white/90 outline-none focus:border-white/30 transition-colors";
  const lbl = "text-xs text-white/50 mb-1.5 block";

  return (
    <div className="min-h-screen" style={{
      background: 'radial-gradient(1200px 600px at 50% -10%, rgba(34,197,94,0.10), transparent 60%), radial-gradient(900px 500px at 100% 100%, rgba(196,30,58,0.07), transparent 55%), #080c16',
    }}>
      <div className="sticky top-0 z-20 border-b border-white/10 px-4 py-3 flex items-center gap-3"
        style={{ background: 'rgba(8,12,22,0.85)', backdropFilter: 'blur(20px)' }}>
        {onBack && <button onClick={onBack} className="text-xs text-white/60 border border-white/12 rounded-full px-3 py-1.5 hover:text-white/90 hover:border-white/25 transition-colors">← Portfolio</button>}
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-lg flex items-center justify-center text-sm" style={{ background: 'linear-gradient(135deg, rgba(34,197,94,0.25), rgba(34,197,94,0.08))', border: '1px solid rgba(34,197,94,0.3)' }}>🔥</span>
          <h1 className="text-sm font-semibold text-white tracking-tight">Calorie Tracker</h1>
        </div>
        <div className="ml-auto flex rounded-lg overflow-hidden border border-white/12 text-xs">
          {[['today', 'Today'], ['history', 'History']].map(([v, label]) => (
            <button key={v} onClick={() => setView(v)} className="px-3.5 py-1.5 font-medium transition-colors"
              style={{ background: view === v ? 'rgba(34,197,94,0.22)' : 'transparent', color: view === v ? '#fff' : 'rgba(255,255,255,0.5)' }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-5 pb-20" style={{ fontFeatureSettings: '"tnum"' }}>
       {view === 'history' ? (
         <CalendarView days={store.days} today={today} target={num(p.intake)} tdee={calc.tdee}
           weightKg={weightKg} uW={uW} metric={metric} kcalPerKg={KCAL_PER_KG} fmtDate={fmtDate}
           onSelectDay={setEditDate} />
       ) : (<></>)}
       {view === 'today' && (<>


        {/* ── Remaining today (hero) — calories left + calories burned ── */}
        {(() => {
          const target = calc.intake || 0;
          const planLeft = target - totals.kcal;                 // plan budget only
          const over = planLeft < 0;
          const pct = target > 0 ? Math.min(100, Math.round(totals.kcal / target * 100)) : 0;
          const ringColor = over ? '#ef4444' : pct > 85 ? '#f59e0b' : '#22c55e';
          // ── Actual-rate forecast: driven by what you REALLY ate + burned
          // today (not the static target), so it changes day to day. ──
          const todayBurn  = calc.tdee + exBurned;        // maintenance + logged exercise
          const netDeficit = todayBurn - totals.kcal;     // + = losing today
          const losing     = netDeficit >= 0;
          const toUnit     = (kg) => metric ? kg : kg * 2.20462;
          const wPerDay    = toUnit(Math.abs(netDeficit) / KCAL_PER_KG);
          const wPerMonth  = wPerDay * 30.44;
          const daysActual = calc.kgToLose > 0 && netDeficit > 0
            ? Math.ceil(calc.kgToLose * KCAL_PER_KG / netDeficit) : null;
          const goalDateActual = daysActual ? new Date(Date.now() + daysActual * 86400000) : null;
          const paceC = losing ? '#22c55e' : '#ef4444';
          return (
            <section className="rounded-2xl p-6 relative overflow-hidden"
              style={{ background: `linear-gradient(135deg, ${ringColor}1f, ${ringColor}08 55%, transparent), rgba(255,255,255,0.02)`, border: `1px solid ${ringColor}38` }}>
              <div className="flex items-center justify-between gap-6">
                <div className="flex-1">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.16em] text-white/45 mb-1.5">Calories left</p>
                      <p className="text-4xl md:text-5xl font-extrabold leading-none tracking-tighter" style={{ color: ringColor }}>
                        {planLeft < 0 ? '−' : ''}{Math.abs(planLeft)}
                      </p>
                      <p className="text-[11px] text-white/45 mt-2">{target} − {totals.kcal} eaten</p>
                    </div>
                    <div className="border-l border-white/10 pl-4">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-white/45 mb-1.5">Burned<br/><span className="text-white/30">exercise</span></p>
                      <p className="text-4xl md:text-5xl font-extrabold leading-none tracking-tighter" style={{ color: '#4ade80' }}>
                        {exBurned}
                      </p>
                      <p className="text-[11px] text-white/45 mt-2">from today's workout</p>
                    </div>
                  </div>
                  <p className="text-sm text-white/60 mt-4">
                    {over
                      ? `You're over your plan by ${Math.abs(planLeft)} kcal today.`
                      : `Room for ${planLeft} more today${exBurned > 0 ? ` · ${exBurned} kcal burned in your workout` : ''}.`}
                  </p>
                </div>
                {/* progress ring */}
                <div className="relative w-24 h-24 shrink-0 hidden sm:block">
                  <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                    <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="9" />
                    <circle cx="50" cy="50" r="42" fill="none" stroke={ringColor} strokeWidth="9" strokeLinecap="round"
                      strokeDasharray={2 * Math.PI * 42}
                      strokeDashoffset={2 * Math.PI * 42 * (1 - pct / 100)}
                      style={{ transition: 'stroke-dashoffset 0.6s ease, stroke 0.3s' }} />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-lg font-bold" style={{ color: ringColor }}>{pct}%</span>
                    <span className="text-[9px] text-white/40 uppercase tracking-wide">eaten</span>
                  </div>
                </div>
              </div>

              {/* target intake (editable) + TODAY'S pace — recalculated from
                  what you've actually eaten and burned, so it moves daily */}
              <div className="mt-5 pt-4 border-t border-white/10 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-white/50">Daily target</span>
                  <input type="number" value={p.intake} onChange={set('intake')}
                    className="w-24 bg-white/8 border border-white/15 rounded-lg px-3 py-1.5 text-sm font-semibold text-white outline-none focus:border-white/35 transition-colors" />
                  <span className="text-xs text-white/40">kcal/day</span>
                </div>
                {calc.kgToLose <= 0 ? (
                  <div className="text-sm text-white/45">Set a goal weight below your current weight in <button onClick={() => setShowSetup(true)} className="underline hover:text-white/70">Body &amp; Goal</button>.</div>
                ) : (
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
                    <span className="text-[10px] uppercase tracking-[0.18em] text-white/40">At today's pace</span>
                    {netDeficit > 0 ? (<>
                      <span className="text-sm font-semibold" style={{ color: paceC }}>−{wPerDay.toFixed(2)} {uW}/day</span>
                      <span className="text-sm font-semibold" style={{ color: paceC }}>−{wPerMonth.toFixed(1)} {uW}/month</span>
                    </>) : (
                      <span className="text-sm" style={{ color: '#fca5a5' }}>No deficit today — you've eaten more than the {todayBurn} kcal you'll burn.</span>
                    )}
                  </div>
                )}
              </div>
            </section>
          );
        })()}

        {/* ── Time to Goal — target vs actual-average vs today's pace ── */}
        {calc.kgToLose > 0 && (
          <section className="glass rounded-2xl p-5">
            <SectionHead icon="⏳" title="Time to Goal"
              sub={`${(metric ? calc.kgToLose : calc.kgToLose * 2.20462).toFixed(1)} ${uW} to lose → ${p.goalKg} ${uW}`}
              color="#C41E3A" />
            <div className="grid grid-cols-3 gap-3">
              <div>
                <p className="text-[11px] text-white/45 mb-1">At your target</p>
                <p className="text-2xl md:text-3xl font-extrabold text-white leading-none tracking-tight">{daysTarget ?? '—'}<span className="text-xs font-normal text-white/40 ml-1">days</span></p>
                <p className="text-[10px] text-white/35 mt-1">{p.intake} kcal/day · {dateOf(daysTarget)}</p>
              </div>
              <div className="border-l border-white/10 pl-3">
                <p className="text-[11px] text-white/45 mb-1">At your actual average</p>
                <p className="text-2xl md:text-3xl font-extrabold leading-none tracking-tight" style={{ color: daysAvg ? '#C41E3A' : 'rgba(255,255,255,0.5)' }}>{daysAvg ?? '—'}<span className="text-xs font-normal text-white/40 ml-1">days</span></p>
                <p className="text-[10px] text-white/35 mt-1">{avgEaten ? `${avgEaten} kcal/day avg · ${dateOf(daysAvg)}` : 'log a day to see this'}</p>
              </div>
              <div className="border-l border-white/10 pl-3">
                <p className="text-[11px] text-white/45 mb-1">At today's pace</p>
                <p className="text-2xl md:text-3xl font-extrabold leading-none tracking-tight" style={{ color: daysToday ? '#22c55e' : 'rgba(255,255,255,0.5)' }}>{daysToday ?? '—'}<span className="text-xs font-normal text-white/40 ml-1">days</span></p>
                <p className="text-[10px] text-white/35 mt-1">{daysToday ? dateOf(daysToday) : 'no deficit yet today'}</p>
              </div>
            </div>
            {avgEaten > 0 && daysTarget && daysAvg && (
              <p className="text-sm text-white/55 mt-4 pt-3 border-t border-white/8">
                {daysAvg < daysTarget
                  ? `At your current habits (${avgEaten} kcal/day eaten${avgBurned ? `, ${avgBurned} burned` : ''}) you'll reach goal ${daysTarget - daysAvg} day${daysTarget - daysAvg === 1 ? '' : 's'} ahead of your ${p.intake}-target plan.`
                  : daysAvg > daysTarget
                  ? `At your current habits (${avgEaten} kcal/day eaten${avgBurned ? `, ${avgBurned} burned` : ''}) you're tracking ${daysAvg - daysTarget} day${daysAvg - daysTarget === 1 ? '' : 's'} behind your ${p.intake}-target plan.`
                  : `Your current habits land right on your ${p.intake}-target plan.`}
              </p>
            )}
          </section>
        )}

        {/* ── Exercise ── */}
        <section className="glass rounded-2xl p-5">
          <SectionHead icon="🏃" title="Today's Exercise" sub="Burned calories are added back to your budget" color="#4ade80" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={lbl}>Steps walked</label>
              <input type="number" value={ex.steps} onChange={e => setEx(s => ({ ...s, steps: e.target.value }))} placeholder="e.g. 8000" className={field} />
              <p className="text-[11px] text-white/40 mt-1">≈ {stepsBurn} kcal burned</p>
            </div>
            <div>
              <label className={lbl}>Elliptical (minutes)</label>
              <input type="number" value={ex.elliptical} onChange={e => setEx(s => ({ ...s, elliptical: e.target.value }))} placeholder="e.g. 30" className={field} />
              <p className="text-[11px] text-white/40 mt-1">≈ {ellipBurn} kcal burned</p>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-white/8 flex items-center justify-between">
            <span className="text-sm text-white/60">Total burned today</span>
            <span className="text-lg font-bold" style={{ color: '#4ade80' }}>{exBurned} <span className="text-xs font-normal text-white/40">kcal</span></span>
          </div>
        </section>

        {/* ── Food log ── */}
        <section className="glass rounded-2xl p-5">
          <SectionHead icon="🍽️" title="Today's Food Log" sub="Enter calories (and protein if you know it); the rest is estimated" color="#fbbf24" />
          <div className="flex flex-col sm:flex-row gap-2 mb-2">
            <input value={food.name} onChange={e => setFood(f => ({ ...f, name: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && addFood()}
              placeholder="e.g. grilled chicken salad" className={field + ' flex-1'} />
            <input value={food.kcal} onChange={e => setFood(f => ({ ...f, kcal: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && addFood()} type="number"
              placeholder="kcal" className={field + ' sm:w-24'} />
            <input value={food.protein} onChange={e => setFood(f => ({ ...f, protein: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && addFood()} type="number"
              placeholder="protein (g)" className={field + ' sm:w-32'} />
            <button onClick={addFood} className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-all shrink-0"
              style={{ background: '#C41E3A' }}>Add</button>
          </div>
          <p className="text-[11px] text-white/35 mb-4">Protein is optional — leave it blank and it's estimated from the food name; enter it to override the guess.</p>

          {log.length > 0 && (
            <div className="space-y-1.5 mb-4">
              {log.map(f => (
                <div key={f.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white/4 border border-white/8">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white/90 truncate">{f.name}</p>
                    <p className="text-[11px] text-white/45">
                      {f.protein}g P{f.proteinManual && <span className="text-emerald-400/80"> ✓</span>} · {f.carbs}g C · {f.fat}g F · {f.fiber}g fiber
                      {!f.matched && !f.proteinManual && <span className="text-white/30 ml-1.5">(est.)</span>}
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-white/80 shrink-0">{f.kcal}</span>
                  <button onClick={() => removeFood(f.id)} className="text-white/30 hover:text-red-400 text-lg leading-none shrink-0">×</button>
                </div>
              ))}
            </div>
          )}

          {/* Daily totals */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 pt-4 border-t border-white/8">
            <Stat label="Calories" value={`${totals.kcal}`} unit={calc.intake ? `/ ${calc.intake}` : ''} accent={totals.kcal > calc.intake * 1.08 ? '#ef4444' : '#22c55e'} />
            <Stat label="Protein" value={`${totals.protein}`} unit="g" />
            <Stat label="Carbs" value={`${totals.carbs}`} unit="g" />
            <Stat label="Fat" value={`${totals.fat}`} unit="g" />
            <Stat label="Fiber" value={`${Math.round(totals.fiber * 10) / 10}`} unit="g" />
          </div>
        </section>

        {/* ── Body & Goal (collapsible setup) ── */}
        <section className="glass rounded-2xl overflow-hidden">
          <button onClick={() => setShowSetup(s => !s)} className="w-full flex items-center justify-between p-5 text-left hover:bg-white/[0.03] transition-colors">
            <SectionHead icon="⚙️" title="Body & Goal"
              sub={`${p.weightKg} → ${p.goalKg} ${uW} · ${p.intake} kcal/day · ${p.sex === 'female' ? 'Female' : 'Male'}, ${p.age}`}
              color="#60a5fa" className="" />
            <span className="text-white/40 text-xs shrink-0 ml-3">{showSetup ? 'Hide ▲' : 'Edit ▼'}</span>
          </button>
          {showSetup && (
            <div className="px-5 pb-5 space-y-5 animate-[fadeIn_0.2s_ease]">
              <div className="flex justify-end">
                <div className="flex rounded-lg overflow-hidden border border-white/12 text-xs">
                  {['imperial','metric'].map(u => (
                    <button key={u} onClick={() => setP(prev => ({ ...prev, units: u }))}
                      className="px-3 py-1 transition-colors"
                      style={{ background: p.units === u ? 'rgba(96,165,250,0.25)' : 'transparent', color: p.units === u ? '#fff' : 'rgba(255,255,255,0.5)' }}>
                      {u === 'metric' ? 'kg/cm' : 'lb/in'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div>
                  <label className={lbl}>Sex</label>
                  <select value={p.sex} onChange={set('sex')} className={field}>
                    <option value="male">Male</option><option value="female">Female</option>
                  </select>
                </div>
                <div><label className={lbl}>Age</label><input type="number" value={p.age} onChange={set('age')} className={field} /></div>
                <div><label className={lbl}>Height ({uH})</label><input type="number" value={p.heightCm} onChange={set('heightCm')} className={field} /></div>
                <div><label className={lbl}>Current weight ({uW})</label><input type="number" value={p.weightKg} onChange={set('weightKg')} className={field} /></div>
                <div><label className={lbl}>Goal weight ({uW})</label><input type="number" value={p.goalKg} onChange={set('goalKg')} className={field} /></div>
                <div>
                  <label className={lbl}>Activity</label>
                  <select value={p.activity} onChange={set('activity')} className={field}>
                    {ACTIVITY.map(a => <option key={a.id} value={a.id}>{a.label.split(' (')[0]}</option>)}
                  </select>
                </div>
              </div>
            </div>
          )}
        </section>
       </>)}
      </div>

      {editDate && (
        <DayEditorModal
          date={editDate}
          day={store.days[editDate] || EMPTY_DAY}
          weightKg={weightKg} uW={uW} target={num(p.intake)} tdee={calc.tdee}
          onUpdate={(updater) => setDayFor(editDate, updater)}
          onClose={() => setEditDate(null)} />
      )}
    </div>
  );
}

/* ── History / Calendar tab ── */
function CalendarView({ days, today, target, tdee, weightKg, uW, metric, kcalPerKg, fmtDate, onSelectDay }) {
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const key = (day) => `${ym.y}-${String(ym.m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const dayStat = (dateKey) => {
    const d = days[dateKey];
    if (!d) return null;
    const eaten = (d.log || []).reduce((s, f) => s + (f.kcal || 0), 0);
    const burned = stepsToKcal(num(d.ex?.steps), weightKg) + ellipticalToKcal(num(d.ex?.elliptical), weightKg);
    if (eaten === 0 && burned === 0) return null;
    return { eaten, burned, net: tdee + burned - eaten };
  };

  // All-time stats across every logged day.
  const all = Object.keys(days).map(dayStatFromAll).filter(Boolean);
  function dayStatFromAll(k) {
    const d = days[k];
    const eaten = (d.log || []).reduce((s, f) => s + (f.kcal || 0), 0);
    const burned = stepsToKcal(num(d.ex?.steps), weightKg) + ellipticalToKcal(num(d.ex?.elliptical), weightKg);
    if (eaten === 0 && burned === 0) return null;
    return { eaten, burned, net: tdee + burned - eaten };
  }
  const n = all.length;
  const avg = (sel) => n ? Math.round(all.reduce((s, d) => s + sel(d), 0) / n) : 0;
  const avgEaten = avg(d => d.eaten), avgBurned = avg(d => d.burned), avgNet = avg(d => d.net);
  const totalLostKg = all.reduce((s, d) => s + d.net, 0) / kcalPerKg;
  const totalLost = (metric ? totalLostKg : totalLostKg * 2.20462);

  const firstDow = new Date(ym.y, ym.m, 1).getDay();
  const daysInMonth = new Date(ym.y, ym.m + 1, 0).getDate();
  const monthLabel = new Date(ym.y, ym.m, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const shift = (delta) => setYm(({ y, m }) => { const d = new Date(y, m + delta, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const cells = [...Array(firstDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  const Stat = ({ label, value, unit, color }) => (
    <div>
      <p className="text-[11px] text-white/45 mb-0.5">{label}</p>
      <p className="text-2xl font-extrabold leading-none tracking-tight" style={{ color: color || 'rgba(255,255,255,0.92)' }}>{value}<span className="text-xs font-normal text-white/40 ml-1">{unit}</span></p>
    </div>
  );

  return (
    <>
      <section className="glass rounded-2xl p-5">
        <SectionHead icon="📈" title="Your Averages" sub={`${n} day${n === 1 ? '' : 's'} tracked`} color="#a78bfa" />
        {n === 0 ? (
          <p className="text-sm text-white/45">No days logged yet — log food on the Today tab and it'll appear here.</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat label="Avg eaten" value={avgEaten} unit="kcal/day" />
            <Stat label="Avg burned (exercise)" value={avgBurned} unit="kcal/day" color="#4ade80" />
            <Stat label="Avg daily deficit" value={avgNet} unit="kcal" color={avgNet > 0 ? '#22c55e' : '#ef4444'} />
            <Stat label="Total lost so far" value={`${totalLost >= 0 ? '−' : '+'}${Math.abs(totalLost).toFixed(1)}`} unit={uW} color={totalLost >= 0 ? '#22c55e' : '#ef4444'} />
          </div>
        )}
      </section>

      <section className="glass rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <SectionHead icon="📅" title="Calendar" color="#a78bfa" className="" />
          <div className="flex items-center gap-3">
            <button onClick={() => shift(-1)} className="text-white/50 hover:text-white/90 px-2 text-lg leading-none">‹</button>
            <span className="text-sm font-medium text-white/80 w-32 text-center">{monthLabel}</span>
            <button onClick={() => shift(1)} className="text-white/50 hover:text-white/90 px-2 text-lg leading-none">›</button>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
            <div key={i} className="text-center text-[10px] uppercase tracking-wider text-white/30 pb-1">{d}</div>
          ))}
          {cells.map((day, i) => {
            if (day === null) return <div key={`b${i}`} />;
            const k = key(day);
            const st = dayStat(k);
            const isToday = k === today;
            const over = st && target > 0 && st.eaten > target;
            const bg = !st ? 'rgba(255,255,255,0.03)'
              : over ? 'rgba(239,68,68,0.14)' : 'rgba(34,197,94,0.14)';
            const bd = isToday ? '1px solid rgba(34,197,94,0.7)' : st ? `1px solid ${over ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}` : '1px solid rgba(255,255,255,0.06)';
            const future = k > today;
            return (
              <button key={k} type="button" disabled={future}
                onClick={() => onSelectDay?.(k)}
                className="rounded-lg p-1.5 min-h-[3.4rem] flex flex-col text-left transition-all enabled:hover:brightness-125 enabled:hover:border-white/30 disabled:cursor-default"
                style={{ background: bg, border: bd, opacity: future ? 0.4 : 1, cursor: future ? 'default' : 'pointer' }}>
                <span className="text-[10px] text-white/45">{day}</span>
                {st ? (<>
                  <span className="text-[11px] font-semibold text-white/85 mt-auto leading-tight">{st.eaten}</span>
                  <span className="text-[9px] text-white/40 leading-tight">eaten</span>
                </>) : (!future && <span className="text-[9px] text-white/25 mt-auto leading-tight">+ add</span>)}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-4 mt-4 pt-3 border-t border-white/8 text-[11px] text-white/45">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded" style={{ background: 'rgba(34,197,94,0.4)' }} /> at/under target</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded" style={{ background: 'rgba(239,68,68,0.4)' }} /> over target</span>
          <span className="ml-auto">tap a day to add/edit food · numbers = kcal eaten</span>
        </div>
      </section>
    </>
  );
}

/* ── Per-day editor (opened from the calendar) ──
   Amend any past/current day: add or remove food, edit that day's exercise.
   Writes straight to store.days[date], so the calendar + averages update live. */
function DayEditorModal({ date, day, weightKg, uW, target, tdee, onUpdate, onClose }) {
  const [food, setFood] = useState({ name: '', kcal: '', protein: '' });
  const log = day.log || [];
  const ex = day.ex || { steps: '', elliptical: '' };

  const eaten  = log.reduce((s, f) => s + (f.kcal || 0), 0);
  const burned = stepsToKcal(num(ex.steps), weightKg) + ellipticalToKcal(num(ex.elliptical), weightKg);
  const left   = target - eaten;
  const over   = target > 0 && eaten > target;

  function addFood() {
    const kcal = num(food.kcal);
    if (!food.name.trim() || kcal <= 0) return;
    const m = inferMacros(food.name, kcal);
    const proteinManual = String(food.protein).trim() !== '' && !isNaN(parseFloat(food.protein));
    const protein = proteinManual ? Math.round(num(food.protein)) : m.protein;
    onUpdate(d => ({ ...d, log: [...(d.log || []), { id: Date.now(), name: food.name.trim(), kcal, ...m, protein, proteinManual }] }));
    setFood({ name: '', kcal: '', protein: '' });
  }
  const removeFood = (id) => onUpdate(d => ({ ...d, log: (d.log || []).filter(f => f.id !== id) }));
  const setExField = (k) => (e) => onUpdate(d => ({ ...d, ex: { steps: '', elliptical: '', ...(d.ex || {}), [k]: e.target.value } }));

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const field = "w-full bg-white/5 border border-white/12 rounded-xl px-3 py-2.5 text-sm text-white/90 outline-none focus:border-white/30 transition-colors";
  const lbl = "text-xs text-white/50 mb-1.5 block";
  const dObj = new Date(date + 'T00:00:00');
  const longDate = dObj.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(4,7,14,0.7)', backdropFilter: 'blur(6px)' }} onClick={onClose}>
      <div className="w-full max-w-lg max-h-[88vh] overflow-y-auto rounded-2xl"
        style={{ background: '#0e1422', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 24px 60px rgba(0,0,0,0.5)' }}
        onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 flex items-center justify-between px-6 py-4 border-b border-white/10"
          style={{ background: '#0e1422' }}>
          <div>
            <h2 className="text-sm font-semibold text-white tracking-tight">{longDate}</h2>
            <p className="text-[11px] text-white/45 mt-0.5">
              {eaten} eaten{target > 0 && <> · <span style={{ color: over ? '#f87171' : '#4ade80' }}>{left < 0 ? `${Math.abs(left)} over` : `${left} left`}</span></>}
              {burned > 0 && <> · {burned} burned</>}
            </p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none px-1">×</button>
        </div>

        <div className="p-6 space-y-5">
          <div>
            <SectionHead icon="🍽️" title="Food" sub="Add anything you forgot to log that day" color="#fbbf24" />
            <div className="flex flex-col sm:flex-row gap-2 mb-2">
              <input value={food.name} onChange={e => setFood(f => ({ ...f, name: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && addFood()} autoFocus
                placeholder="e.g. late-night snack" className={field + ' flex-1'} />
              <input value={food.kcal} onChange={e => setFood(f => ({ ...f, kcal: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && addFood()} type="number"
                placeholder="kcal" className={field + ' sm:w-24'} />
              <input value={food.protein} onChange={e => setFood(f => ({ ...f, protein: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && addFood()} type="number"
                placeholder="protein (g)" className={field + ' sm:w-32'} />
              <button onClick={addFood} className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-all shrink-0"
                style={{ background: '#C41E3A' }}>Add</button>
            </div>

            {log.length > 0 ? (
              <div className="space-y-1.5 mt-3">
                {log.map(f => (
                  <div key={f.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white/4 border border-white/8">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white/90 truncate">{f.name}</p>
                      <p className="text-[11px] text-white/45">
                        {f.protein}g P{f.proteinManual && <span className="text-emerald-400/80"> ✓</span>} · {f.carbs}g C · {f.fat}g F · {f.fiber}g fiber
                        {!f.matched && !f.proteinManual && <span className="text-white/30 ml-1.5">(est.)</span>}
                      </p>
                    </div>
                    <span className="text-sm font-semibold text-white/80 shrink-0">{f.kcal}</span>
                    <button onClick={() => removeFood(f.id)} className="text-white/30 hover:text-red-400 text-lg leading-none shrink-0">×</button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-white/35 mt-2">No food logged this day yet.</p>
            )}
          </div>

          <div className="pt-4 border-t border-white/8">
            <SectionHead icon="🏃" title="Exercise" sub="Burned calories count toward this day's deficit" color="#4ade80" />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={lbl}>Steps walked</label>
                <input type="number" value={ex.steps} onChange={setExField('steps')} placeholder="e.g. 8000" className={field} />
                <p className="text-[11px] text-white/40 mt-1">≈ {stepsToKcal(num(ex.steps), weightKg)} kcal</p>
              </div>
              <div>
                <label className={lbl}>Elliptical (minutes)</label>
                <input type="number" value={ex.elliptical} onChange={setExField('elliptical')} placeholder="e.g. 30" className={field} />
                <p className="text-[11px] text-white/40 mt-1">≈ {ellipticalToKcal(num(ex.elliptical), weightKg)} kcal</p>
              </div>
            </div>
          </div>

          <button onClick={onClose} className="w-full py-2.5 rounded-xl text-sm font-semibold text-white/90 bg-white/8 border border-white/15 hover:bg-white/12 transition-colors">Done</button>
        </div>
      </div>
    </div>
  );
}

function SectionHead({ icon, title, sub, color = '#22c55e', className = 'mb-4' }) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <span className="w-9 h-9 rounded-xl flex items-center justify-center text-base shrink-0"
        style={{ background: `${color}1c`, border: `1px solid ${color}3a` }}>{icon}</span>
      <div>
        <h2 className="text-sm font-semibold text-white tracking-tight leading-tight">{title}</h2>
        {sub && <p className="text-[11px] text-white/45 leading-tight mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function Stat({ label, value, unit, hint, accent, big }) {
  return (
    <div>
      <p className="text-[11px] text-white/45 mb-0.5">{label}</p>
      <p className={`font-bold leading-none ${big ? 'text-3xl' : 'text-xl'}`} style={{ color: accent || 'rgba(255,255,255,0.92)' }}>
        {value}<span className="text-xs font-normal text-white/40 ml-1">{unit}</span>
      </p>
      {hint && <p className="text-[10px] text-white/35 mt-0.5">{hint}</p>}
    </div>
  );
}
