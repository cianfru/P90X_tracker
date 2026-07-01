import { useState, useEffect, useMemo, useRef } from "react";
import {
  Dumbbell, TrendingUp, Plus, Minus, Check, ChevronLeft, Flame,
  History, Activity, X, Calendar, Hash, Trophy
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid, ReferenceLine
} from "recharts";

// ---- Seed: real templates, exercise types, last-known numbers (from your sheet) ----
const SEED = {"templates":{"Chest & Back":["Std push","Wide pull","Military","Chin ups","Wide fly","Close grip pull","Decline push","Heavy P.","Diamond","Lawn.","Dive bomb","Back flys","Closed grip","Heavy p","Declined Push","Location","Form"],"Shoulders & Arms":["Alt should","In & out biceps","Tris","Swimmer press","Biceps","Dips","Upright rows","Static","Flip grip","Shoulder flys","Crouching biceps","Lay down tris","2 ways flys","Condon curls","Side tri rise","Location","Form"],"Legs & Back":["Lounges","Squats","Chin ups","Skaters","Wall squats","Pull ups","Step back","Side to side","Close grip","Dead lift","Swith grip","Lounch lounges","Chair","Toe roll","Wide pull","Graucho walk","Calf raises","Closed grip","DS","Switch grip","Location","Form"]},"types":{"Wide pull":"bodyweight","Closed grip":"bodyweight","Condon curls":"weighted","Static":"weighted","Heavy p":"weighted","Tris":"weighted","Close grip pull":"bodyweight","Lounch lounges":"weighted","Crouching biceps":"weighted","Wide fly":"bodyweight","Std push":"bodyweight","Side tri rise":"bodyweight","Heavy P.":"weighted","Form":"bodyweight","Pull ups":"bodyweight","Close grip":"bodyweight","Chair":"bodyweight","In & out biceps":"weighted","Flip grip":"weighted","Shoulder flys":"weighted","Alt should":"weighted","Chin ups":"bodyweight","Dive bomb":"bodyweight","Back flys":"weighted","Upright rows":"weighted","Wall squats":"bodyweight","DS":"bodyweight","Toe roll":"weighted","Location":"bodyweight","2 ways flys":"weighted","Biceps":"weighted","Declined Push":"bodyweight","Calf raises":"bodyweight","Diamond":"bodyweight","Dips":"bodyweight","Lounges":"weighted","Skaters":"weighted","Swimmer press":"weighted","Lawn.":"weighted","Squats":"weighted","Graucho walk":"bodyweight","Side to side":"weighted","Dead lift":"weighted","Lay down tris":"weighted","Military":"bodyweight","Decline push":"bodyweight","Switch grip":"bodyweight","Swith grip":"bodyweight","Step back":"weighted"},"last":{"Wide pull":{"reps":20,"weight":null},"Closed grip":{"reps":20,"weight":null},"Condon curls":{"reps":8,"weight":20},"Static":{"reps":16,"weight":18},"Heavy p":{"reps":8,"weight":40},"Tris":{"reps":12,"weight":20},"Close grip pull":{"reps":15,"weight":null},"Lounch lounges":{"reps":12,"weight":12},"Crouching biceps":{"reps":8,"weight":20},"Wide fly":{"reps":40,"weight":null},"Std push":{"reps":40,"weight":null},"Side tri rise":{"reps":35,"weight":null},"Heavy P.":{"reps":8,"weight":40},"Form":{"reps":7,"weight":null},"Pull ups":{"reps":20,"weight":null},"Close grip":{"reps":20,"weight":null},"Chair":{"reps":20,"weight":null},"In & out biceps":{"reps":16,"weight":20},"Flip grip":{"reps":8,"weight":20},"Shoulder flys":{"reps":16,"weight":14},"Alt should":{"reps":15,"weight":null},"Chin ups":{"reps":22,"weight":null},"Dive bomb":{"reps":20,"weight":null},"Back flys":{"reps":12,"weight":20},"Upright rows":{"reps":8,"weight":32},"Wall squats":{"reps":90,"weight":null},"DS":{"reps":30,"weight":null},"Toe roll":{"reps":20,"weight":14},"Location":{"reps":24,"weight":null},"2 ways flys":{"reps":16,"weight":12},"Biceps":{"reps":8,"weight":20},"Declined Push":{"reps":40,"weight":null},"Calf raises":{"reps":40,"weight":null},"Diamond":{"reps":40,"weight":null},"Dips":{"reps":30,"weight":null},"Lounges":{"reps":25,"weight":20},"Skaters":{"reps":15,"weight":14},"Swimmer press":{"reps":8,"weight":20},"Lawn.":{"reps":8,"weight":40},"Squats":{"reps":25,"weight":20},"Graucho walk":{"reps":12,"weight":null},"Side to side":{"reps":24,"weight":12},"Dead lift":{"reps":20,"weight":12},"Lay down tris":{"reps":8,"weight":20},"Military":{"reps":40,"weight":null},"Decline push":{"reps":30,"weight":null},"Switch grip":{"reps":20,"weight":null},"Swith grip":{"reps":26,"weight":null},"Step back":{"reps":15,"weight":14}}};

// Modifier vocabulary — typed, never freeform text again
const MODS = [
  { id: "no_kip", label: "no-kip", hint: "strict", tone: "amber" },
  { id: "L_sit",  label: "L",      hint: "L-sit legs", tone: "amber" },
  { id: "wide_X", label: "X",      hint: "wide legs", tone: "amber" },
  { id: "trx",    label: "TRX",    hint: "harder", tone: "amber" },
  { id: "full",   label: "full",   hint: "full ROM", tone: "sky" },
  { id: "band",   label: "band",   hint: "travel / lighter", tone: "sky" },
];
const uid = () => Math.random().toString(36).slice(2, 10);
const todayISO = () => new Date().toISOString().slice(0, 10);

// ---- persistence via artifact storage (no localStorage) with in-memory fallback ----
const store = {
  async get(k) {
    try { if (window.storage) { const r = await window.storage.get(k); return r ? JSON.parse(r.value) : null; } }
    catch { return null; }
    return window.__mem?.[k] ?? null;
  },
  async set(k, v) {
    try { if (window.storage) { await window.storage.set(k, JSON.stringify(v)); return; } } catch {}
    window.__mem = window.__mem || {}; window.__mem[k] = v;
  },
};

export default function App() {
  const [loaded, setLoaded] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [view, setView] = useState("home");
  const [activeId, setActiveId] = useState(null);
  const [monitorEx, setMonitorEx] = useState(null);

  useEffect(() => {
    (async () => {
      const s = await store.get("sessions");
      setSessions(Array.isArray(s) ? s : []);
      setLoaded(true);
    })();
  }, []);
  useEffect(() => { if (loaded) store.set("sessions", sessions); }, [sessions, loaded]);

  const active = sessions.find((s) => s.id === activeId) || null;

  function startSession(workout) {
    const existing = sessions.find((s) => s.date === todayISO() && s.workout === workout);
    if (existing) { setActiveId(existing.id); setView("session"); return; }
    const s = { id: uid(), date: todayISO(), workout, sets: [] };
    setSessions((p) => [s, ...p]); setActiveId(s.id); setView("session");
  }
  function addSet(set) {
    setSessions((p) => p.map((s) => s.id === activeId ? { ...s, sets: [...s.sets, set] } : s));
  }
  function removeSet(setId) {
    setSessions((p) => p.map((s) => s.id === activeId ? { ...s, sets: s.sets.filter((x) => x.id !== setId) } : s));
  }

  // last logged value for an exercise (prefill): scan sessions newest->oldest, else seed
  const lastFor = useMemo(() => (ex) => {
    for (const s of sessions) {
      const hits = s.sets.filter((x) => x.ex === ex);
      if (hits.length) { const h = hits[hits.length - 1]; return { reps: h.reps, weight: h.weight }; }
    }
    return SEED.last[ex] || { reps: null, weight: null };
  }, [sessions]);

  if (!loaded)
    return <div className="min-h-screen bg-zinc-950 text-zinc-500 flex items-center justify-center font-mono text-sm">loading…</div>;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100" style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <div className="max-w-md mx-auto pb-24">
        {view === "home" && <Home sessions={sessions} onStart={startSession} onMonitor={(e)=>{setMonitorEx(e);setView("monitor");}} />}
        {view === "session" && active && (
          <Session session={active} lastFor={lastFor} onAdd={addSet} onRemove={removeSet} onBack={() => setView("home")} />
        )}
        {view === "monitor" && (
          <Monitor sessions={sessions} initial={monitorEx} onBack={() => setView("home")} />
        )}
      </div>
      <NavBar view={view} setView={setView} disabled={view === "session"} />
    </div>
  );
}

function NavBar({ view, setView, disabled }) {
  if (disabled) return null;
  const item = (id, Icon, label) => (
    <button onClick={() => setView(id)}
      className={`flex-1 flex flex-col items-center gap-1 py-3 ${view === id ? "text-emerald-400" : "text-zinc-500"}`}>
      <Icon size={20} /><span className="text-xs font-medium tracking-wide">{label}</span>
    </button>
  );
  return (
    <div className="fixed bottom-0 inset-x-0 bg-zinc-900/95 backdrop-blur border-t border-zinc-800">
      <div className="max-w-md mx-auto flex">
        {item("home", Dumbbell, "Train")}
        {item("monitor", TrendingUp, "Monitor")}
      </div>
    </div>
  );
}

function Home({ sessions, onStart, onMonitor }) {
  const names = Object.keys(SEED.templates);
  const today = sessions.filter((s) => s.date === todayISO());
  const recent = sessions.slice(0, 4);
  return (
    <div className="px-4 pt-8">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Logbook</h1>
        <span className="font-mono text-xs text-zinc-500">{new Date().toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" })}</span>
      </div>
      <p className="text-zinc-500 text-sm mt-1">Tap a workout to start logging. Works fully offline.</p>

      {today.length > 0 && (
        <div className="mt-5">
          <Label>Resume today</Label>
          {today.map((s) => (
            <button key={s.id} onClick={() => onStart(s.workout)}
              className="w-full mt-2 flex items-center justify-between bg-emerald-500/10 border border-emerald-500/30 rounded-2xl px-4 py-3 active:scale-95 transition">
              <span className="font-semibold text-emerald-300">{s.workout}</span>
              <span className="font-mono text-xs text-emerald-400/80">{s.sets.length} sets · continue →</span>
            </button>
          ))}
        </div>
      )}

      <div className="mt-6">
        <Label>Start a workout</Label>
        <div className="space-y-2.5 mt-2">
          {names.map((n) => (
            <button key={n} onClick={() => onStart(n)}
              className="w-full flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-4 active:scale-95 transition hover:border-zinc-700">
              <span className="font-semibold">{n}</span>
              <span className="font-mono text-xs text-zinc-500">{SEED.templates[n].length} moves →</span>
            </button>
          ))}
        </div>
      </div>

      {recent.length > 0 && (
        <div className="mt-7">
          <Label>Recent sessions</Label>
          <div className="mt-2 space-y-1.5">
            {recent.map((s) => (
              <div key={s.id} className="flex items-center justify-between text-sm bg-zinc-900/60 rounded-xl px-3.5 py-2.5">
                <span className="text-zinc-300">{s.workout}</span>
                <span className="font-mono text-xs text-zinc-500">{fmtDate(s.date)} · {s.sets.length} sets</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Session({ session, lastFor, onAdd, onRemove, onBack }) {
  const exercises = SEED.templates[session.workout] || [];
  const [open, setOpen] = useState(exercises[0] || null);
  const totalSets = session.sets.length;
  const totalReps = session.sets.reduce((a, x) => a + (x.reps || 0), 0);
  const tonnage = session.sets.reduce((a, x) => a + (x.weight ? x.reps * x.weight : 0), 0);

  return (
    <div>
      <div className="sticky top-0 z-10 bg-zinc-950/95 backdrop-blur border-b border-zinc-800 px-4 py-3 flex items-center gap-3">
        <button onClick={onBack} className="text-zinc-400 active:text-zinc-200"><ChevronLeft size={22} /></button>
        <div className="flex-1">
          <div className="font-semibold leading-tight">{session.workout}</div>
          <div className="font-mono text-xs text-zinc-500">{fmtDate(session.date)}</div>
        </div>
        <div className="flex gap-3 font-mono text-xs text-zinc-400">
          <Stat n={totalSets} l="sets" /><Stat n={totalReps} l="reps" /><Stat n={tonnage} l="kg" />
        </div>
      </div>

      <div className="px-4 pt-4 space-y-2.5">
        {exercises.map((ex) => (
          <ExerciseCard key={ex} ex={ex} sets={session.sets.filter((s) => s.ex === ex)}
            last={lastFor(ex)} isOpen={open === ex} onToggle={() => setOpen(open === ex ? null : ex)}
            onAdd={onAdd} onRemove={onRemove} />
        ))}
      </div>
    </div>
  );
}

function ExerciseCard({ ex, sets, last, isOpen, onToggle, onAdd, onRemove }) {
  const weighted = SEED.types[ex] === "weighted";
  const [reps, setReps] = useState(last.reps ?? (weighted ? 10 : 20));
  const [weight, setWeight] = useState(last.weight ?? 20);
  const [mods, setMods] = useState([]);
  const [struggle, setStruggle] = useState(false);
  const round = sets.length + 1;

  function log() {
    onAdd({ id: uid(), ex, reps, weight: weighted ? weight : null, round, mods, struggle, ts: Date.now() });
    setMods([]); setStruggle(false);
  }
  const toggleMod = (m) => setMods((p) => p.includes(m) ? p.filter((x) => x !== m) : [...p, m]);

  return (
    <div className={`rounded-2xl border transition ${isOpen ? "bg-zinc-900 border-zinc-700" : "bg-zinc-900/50 border-zinc-800"}`}>
      <button onClick={onToggle} className="w-full flex items-center justify-between px-4 py-3.5">
        <div className="flex items-center gap-2.5 text-left">
          <span className="font-semibold">{ex}</span>
          {sets.length > 0 && <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400">{sets.length}×</span>}
        </div>
        <div className="flex items-center gap-2">
          {sets.length === 0 && last.reps != null && (
            <span className="font-mono text-xs text-zinc-500">last {last.reps}{weighted && last.weight ? `×${last.weight}` : ""}</span>
          )}
          <div className="flex gap-1">
            {sets.map((s) => (
              <span key={s.id} className="font-mono text-xs px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">
                {s.reps}{s.weight ? `×${s.weight}` : ""}{s.struggle ? "·" : ""}
              </span>
            ))}
          </div>
        </div>
      </button>

      {isOpen && (
        <div className="px-4 pb-4 pt-1 border-t border-zinc-800/70">
          <div className="flex items-center justify-between gap-3 mt-3">
            <Stepper label={`reps · R${round}`} value={reps} setValue={setReps} step={1} min={0} accent="emerald" />
            {weighted && <Stepper label="kg" value={weight} setValue={setWeight} step={1} min={0} accent="sky" />}
          </div>

          <div className="flex flex-wrap gap-1.5 mt-3">
            {MODS.map((m) => (
              <Chip key={m.id} active={mods.includes(m.id)} tone={m.tone} onClick={() => toggleMod(m.id)} title={m.hint}>{m.label}</Chip>
            ))}
            <Chip active={struggle} tone="rose" onClick={() => setStruggle((v) => !v)} title="hard set"><Flame size={11} className="inline -mt-0.5" /></Chip>
          </div>

          <button onClick={log}
            className="w-full mt-3.5 flex items-center justify-center gap-2 bg-emerald-500 text-zinc-950 font-bold rounded-xl py-3 active:scale-95 transition">
            <Check size={18} /> Log set R{round}
          </button>

          {sets.length > 0 && (
            <div className="mt-3 space-y-1">
              {sets.map((s) => (
                <div key={s.id} className="flex items-center justify-between text-xs font-mono text-zinc-400 bg-zinc-950/50 rounded-lg px-3 py-1.5">
                  <span>R{s.round} · {s.reps}{s.weight ? `×${s.weight}kg` : " reps"}{s.mods.length ? " · " + s.mods.map(labelOf).join(",") : ""}{s.struggle ? " · 🔥" : ""}</span>
                  <button onClick={() => onRemove(s.id)} className="text-zinc-600 active:text-rose-400"><X size={14} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Monitor({ sessions, initial, onBack }) {
  const exList = useMemo(() => {
    const set = new Set(); sessions.forEach((s) => s.sets.forEach((x) => set.add(x.ex)));
    return [...set].sort();
  }, [sessions]);
  const [ex, setEx] = useState(initial && exList.includes(initial) ? initial : exList[0] || null);
  const weighted = ex && SEED.types[ex] === "weighted";

  const series = useMemo(() => {
    if (!ex) return [];
    const rows = [];
    [...sessions].reverse().forEach((s) => {
      const hits = s.sets.filter((x) => x.ex === ex);
      if (!hits.length) return;
      const best = weighted ? Math.max(...hits.map((h) => (h.weight || 0))) : Math.max(...hits.map((h) => h.reps));
      rows.push({ date: s.date, value: best });
    });
    return rows;
  }, [ex, sessions, weighted]);

  const best = series.length ? Math.max(...series.map((r) => r.value)) : null;

  return (
    <div className="px-4 pt-8">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-zinc-400"><ChevronLeft size={22} /></button>
        <h1 className="text-2xl font-bold tracking-tight">Monitor</h1>
      </div>

      {exList.length === 0 ? (
        <div className="mt-10 text-center text-zinc-500 text-sm">
          <Activity className="mx-auto mb-3 opacity-40" /> No data yet — log a few sets and your trends show up here.
        </div>
      ) : (
        <>
          <div className="mt-4 flex gap-2 overflow-x-auto pb-1 -mx-4 px-4">
            {exList.map((e) => (
              <button key={e} onClick={() => setEx(e)}
                className={`whitespace-nowrap text-sm px-3 py-1.5 rounded-full border transition ${ex === e ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300" : "bg-zinc-900 border-zinc-800 text-zinc-400"}`}>
                {e}
              </button>
            ))}
          </div>

          <div className="mt-4 bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="font-semibold">{ex}</div>
                <div className="font-mono text-xs text-zinc-500">{weighted ? "top weight / session (kg)" : "best reps / session"}</div>
              </div>
              {best != null && (
                <div className="text-right">
                  <div className="flex items-center gap-1 justify-end text-amber-400"><Trophy size={13} /><span className="font-mono font-bold">{best}</span></div>
                  <div className="font-mono text-xs text-zinc-500">PR</div>
                </div>
              )}
            </div>
            <div style={{ height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series} margin={{ top: 5, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke="#27272a" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: "#71717a", fontSize: 10 }} tickFormatter={fmtDate} minTickGap={24} />
                  <YAxis tick={{ fill: "#71717a", fontSize: 10 }} domain={["dataMin-2", "dataMax+2"]} />
                  <Tooltip contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 12, fontSize: 12 }} labelFormatter={fmtDate} />
                  {best != null && <ReferenceLine y={best} stroke="#f59e0b" strokeDasharray="4 4" />}
                  <Line type="monotone" dataKey="value" stroke="#34d399" strokeWidth={2.5} dot={{ r: 2.5, fill: "#34d399" }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="mt-4">
            <Label>Sessions logged</Label>
            <div className="mt-2 space-y-1.5">
              {series.length === 0 && <div className="text-zinc-600 text-sm">No sessions for this move yet.</div>}
              {[...series].reverse().map((r, i) => (
                <div key={i} className="flex items-center justify-between text-sm bg-zinc-900/60 rounded-xl px-3.5 py-2.5">
                  <span className="font-mono text-xs text-zinc-500">{fmtDate(r.date)}</span>
                  <span className="font-mono text-zinc-200">{r.value}{weighted ? " kg" : " reps"}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---- small UI atoms ----
function Stepper({ label, value, setValue, step, min, accent }) {
  const ring = accent === "sky" ? "text-sky-400" : "text-emerald-400";
  const press = useRef(null);
  const hold = (dir) => { setValue((v) => Math.max(min, v + dir * step)); };
  return (
    <div className="flex-1">
      <div className="font-mono text-xs text-zinc-500 mb-1.5 tracking-wide uppercase">{label}</div>
      <div className="flex items-center gap-2">
        <button onClick={() => hold(-1)} className="w-11 h-11 rounded-xl bg-zinc-800 flex items-center justify-center active:scale-95 transition"><Minus size={18} /></button>
        <div className={`flex-1 text-center font-mono text-2xl font-bold ${ring}`}>{value}</div>
        <button onClick={() => hold(1)} className="w-11 h-11 rounded-xl bg-zinc-800 flex items-center justify-center active:scale-95 transition"><Plus size={18} /></button>
      </div>
    </div>
  );
}
function Chip({ active, tone, onClick, children, title }) {
  const tones = {
    amber: active ? "bg-amber-500/20 border-amber-500/50 text-amber-300" : "",
    sky: active ? "bg-sky-500/20 border-sky-500/50 text-sky-300" : "",
    rose: active ? "bg-rose-500/20 border-rose-500/50 text-rose-300" : "",
  };
  return (
    <button onClick={onClick} title={title}
      className={`text-xs font-medium px-2.5 py-1.5 rounded-lg border transition ${active ? tones[tone] : "bg-zinc-800/60 border-zinc-700 text-zinc-400"}`}>
      {children}
    </button>
  );
}
function Stat({ n, l }) { return <div className="text-center"><div className="text-zinc-200 font-semibold">{n}</div><div className="text-xs text-zinc-500 -mt-0.5">{l}</div></div>; }
function Label({ children }) { return <div className="font-mono text-xs tracking-widest uppercase text-zinc-500">{children}</div>; }
function labelOf(id) { const m = MODS.find((x) => x.id === id); return m ? m.label : id; }
function fmtDate(d) { const x = new Date(d); return x.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }); }
