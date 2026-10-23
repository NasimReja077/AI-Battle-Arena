import { useState, useEffect, useRef, useCallback } from 'react';
import {
  LuBrain,
  LuSend,
  LuPaperclip,
  LuTrash2,
  LuFileText,
  LuX,
  LuHistory,
  LuSquare,
} from 'react-icons/lu';
import { FiAlertTriangle, FiHelpCircle } from 'react-icons/fi';

import BattleView from './components/BattleView';
import BattleActions from './components/BattleActions';
import SettingsBar from './components/SettingsBar';
import HistoryDrawer from './components/HistoryDrawer';
import SharedPage from './components/SharedPage';
import {
  ApiError,
  deleteBattle,
  getBattle,
  getHealth,
  getModels,
  listBattles,
  streamBattle,
} from './api';
import { applyEvents, fromStored, makeDemoResult, newLiveBattle } from './lib/battle';

const FALLBACK_MODELS = [
  { id: 'mistral', label: 'Mistral Medium' },
  { id: 'cohere', label: 'Cohere Command A' },
  { id: 'gemini', label: 'Gemini Flash' },
];
const DEFAULT_SETTINGS = { models: ['mistral', 'cohere'], judge: 'gemini', rounds: 1 };
const SETTINGS_KEY = 'battle-arena-settings';
const MAX_ATTACHMENT_CHARS = 100000;
const HISTORY_PAGE = 20;

const QUICK_PROMPTS = [
  { title: 'The Robotics "Hands Problem" Story', prompt: 'Give short story for The "hands problem" in robotics, in 25 words' },
  { title: 'Code Optimization Check', prompt: 'Write a function to check if a string is palindrome in Python, optimized' },
  { title: 'Quantum Entanglement Metaphor', prompt: 'Explain Quantum Entanglement like I am 5 years old using a metaphor' },
  {
    title: 'Top 10 Countries with Highest AI Adoption Rates in 2026',
    prompt: 'Explain Top 10 Countries with Highest AI Adoption Rates in 2026, what drives adoption in each country, where the talent pools are deepest, and what these trends mean for building global engineering teams.',
  },
];

// Saved choices must still be valid after the model list changes
function loadSettings(validIds) {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
    const ok =
      saved &&
      Array.isArray(saved.models) &&
      saved.models.length === 2 &&
      saved.models[0] !== saved.models[1] &&
      saved.models.every((id) => validIds.includes(id)) &&
      validIds.includes(saved.judge) &&
      (saved.rounds === 1 || saved.rounds === 2);
    if (ok) return saved;
  } catch {
    // Storage can be blocked or hold junk: fall through to the defaults
  }
  return DEFAULT_SETTINGS;
}

const shareIdFromHash = () => {
  const match = window.location.hash.match(/^#\/s\/([A-Za-z0-9_-]{8,64})$/);
  return match ? match[1] : null;
};

function App() {
  // A #/s/<id> link opens the read-only shared page instead of the arena
  const [sharedId, setSharedId] = useState(shareIdFromHash);
  useEffect(() => {
    const onHash = () => setSharedId(shareIdFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (sharedId) return <SharedPage shareId={sharedId} />;
  return <Arena />;
}

function Arena() {
  const [battles, setBattles] = useState([]);
  const [prompt, setPrompt] = useState('');
  const [backendOnline, setBackendOnline] = useState(false);
  const [historyOn, setHistoryOn] = useState(false);
  const [mode, setMode] = useState('live'); // 'live' or 'demo'
  const [attachedFile, setAttachedFile] = useState(null); // { name, content } | null
  const [errorBanner, setErrorBanner] = useState('');
  const [models, setModels] = useState(FALLBACK_MODELS);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState({ items: [], loading: false, error: '', hasMore: false });

  const chatEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const abortRef = useRef(null);
  const demoTimerRef = useRef(null);
  const keyRef = useRef(0);
  const queueRef = useRef([]);
  const frameRef = useRef(0);

  const running = battles.some((b) => b.status === 'running');

  // Backend status and model list (the health route does not call any AI model)
  useEffect(() => {
    getHealth()
      .then((health) => {
        setBackendOnline(true);
        setHistoryOn(Boolean(health.history));
        setMode('live');
      })
      .catch(() => {
        setBackendOnline(false);
        setHistoryOn(false);
        setMode('demo');
      });

    getModels()
      .then((data) => {
        setModels(data.models);
        setSettings(loadSettings(data.models.map((m) => m.id)));
      })
      .catch(() => setSettings(loadSettings(FALLBACK_MODELS.map((m) => m.id))));
  }, []);

  const changeSettings = (next) => {
    setSettings(next);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch {
      // Not saving the choice is fine
    }
  };

  // Keep the newest content in view while text streams in
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [battles.length, running]);

  // Tokens can arrive far faster than the screen refreshes, so apply them once per frame
  const flushEvents = useCallback(() => {
    frameRef.current = 0;
    const batch = queueRef.current;
    queueRef.current = [];
    if (batch.length === 0) return;
    setBattles((prev) =>
      prev.map((b) => {
        const mine = batch.filter((item) => item.key === b.key).flatMap((item) => item.events);
        return mine.length > 0 ? applyEvents(b, mine) : b;
      }),
    );
  }, []);

  const enqueue = useCallback((key, events) => {
    queueRef.current.push({ key, events });
    if (!frameRef.current) frameRef.current = requestAnimationFrame(flushEvents);
  }, [flushEvents]);

  useEffect(() => () => {
    cancelAnimationFrame(frameRef.current);
    clearTimeout(demoTimerRef.current);
    abortRef.current?.abort();
  }, []);

  const patchBattle = (key, patch) =>
    setBattles((prev) => prev.map((b) => (b.key === key ? { ...b, ...patch } : b)));

  // ----- History -----

  const loadHistory = useCallback(async ({ more = false } = {}) => {
    setHistory((h) => ({ ...h, loading: true, error: '' }));
    try {
      const before = more ? history.items.at(-1)?.id : undefined;
      const data = await listBattles({ limit: HISTORY_PAGE, ...(before ? { before } : {}) });
      setHistory((h) => ({
        items: more ? [...h.items, ...data.battles] : data.battles,
        loading: false,
        error: '',
        hasMore: data.battles.length === HISTORY_PAGE,
      }));
    } catch (err) {
      setHistory((h) => ({ ...h, loading: false, error: err instanceof Error ? err.message : 'Could not load history.' }));
    }
  }, [history.items]);

  const openHistory = () => {
    setHistoryOpen(true);
    loadHistory();
  };

  const openSaved = async (id) => {
    try {
      const data = await getBattle(id);
      keyRef.current += 1;
      const loaded = fromStored(data.battle, `saved-${keyRef.current}`);
      // Opening the same battle twice moves it to the end instead of duplicating it
      setBattles((prev) => [...prev.filter((b) => b.id !== id), loaded]);
      setHistoryOpen(false);
    } catch (err) {
      setHistory((h) => ({ ...h, error: err instanceof Error ? err.message : 'Could not open that battle.' }));
    }
  };

  const removeSaved = async (item) => {
    if (!window.confirm('Delete this battle from history? Any share link for it stops working.')) return;
    try {
      await deleteBattle(item.id);
      setHistory((h) => ({ ...h, items: h.items.filter((x) => x.id !== item.id) }));
      setBattles((prev) => prev.filter((b) => b.id !== item.id));
    } catch (err) {
      setHistory((h) => ({ ...h, error: err instanceof Error ? err.message : 'Could not delete that battle.' }));
    }
  };

  // ----- Running a battle -----

  const handleSend = async (e) => {
    e?.preventDefault();
    const input = prompt.trim();
    if (!input || running) return;

    const attachment = attachedFile;
    const config = { models: settings.models, judge: settings.judge, rounds: settings.rounds };
    keyRef.current += 1;
    const key = `live-${keyRef.current}`;

    setPrompt('');
    setAttachedFile(null);
    setErrorBanner('');
    setBattles((prev) => [...prev, newLiveBattle({ key, problem: input, attachment: attachment?.name ?? null, config })]);

    if (mode === 'demo') {
      const labelOf = (id) => models.find((m) => m.id === id)?.label ?? id;
      const labels = { solution_1: labelOf(config.models[0]), solution_2: labelOf(config.models[1]), judge: labelOf(config.judge) };
      demoTimerRef.current = setTimeout(() => {
        patchBattle(key, { result: makeDemoResult({ problem: input, config, labels }), labels, status: 'done', demo: true });
      }, 1500);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamBattle({
        body: { input, ...(attachment && { attachment }), ...config },
        signal: controller.signal,
        onEvents: (events) => enqueue(key, events),
      });
    } catch (err) {
      if (controller.signal.aborted) {
        patchBattle(key, { status: 'stopped' });
      } else if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
        // Rejected input: show the reason and put the user's text back. Never replace it with fake data.
        setBattles((prev) => prev.filter((b) => b.key !== key));
        setErrorBanner(err.details.length > 0 ? err.details.join(' ') : err.message);
        setPrompt(input);
        setAttachedFile(attachment);
      } else {
        // Make sure queued token events are applied before the error is shown
        cancelAnimationFrame(frameRef.current);
        flushEvents();
        const offline = !(err instanceof ApiError);
        patchBattle(key, {
          status: 'error',
          error: offline
            ? 'Lost contact with the server. Check that the backend is running, or switch to Sandbox Demo.'
            : err.message,
        });
        if (offline) setBackendOnline(false);
      }
    } finally {
      cancelAnimationFrame(frameRef.current);
      flushEvents();
      abortRef.current = null;
    }
  };

  // The result event carries the saved battle's id; refresh the history list when one was saved
  const lastSavedKey = battles.findLast?.((b) => b.saved)?.key;
  useEffect(() => {
    if (lastSavedKey && historyOpen) loadHistory();
    // Only react to a newly saved battle, not to every history change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastSavedKey]);

  const handleStop = () => {
    abortRef.current?.abort();
    clearTimeout(demoTimerRef.current);
    setBattles((prev) => prev.map((b) => (b.status === 'running' ? { ...b, status: 'stopped' } : b)));
  };

  const clearChat = () => {
    handleStop();
    setBattles([]);
  };

  // ----- Attachments -----

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow picking the same file again later
    if (!file) return;

    setErrorBanner('');
    try {
      const content = await file.text();
      if (content.includes('\u0000') || content.includes('�')) {
        throw new Error('Only text files can be attached (for example .txt, .md, .csv, .json or code files).');
      }
      if (content.length > MAX_ATTACHMENT_CHARS) {
        throw new Error('That file is too large. The limit is 100,000 characters.');
      }
      setAttachedFile({ name: file.name, content });
    } catch (err) {
      setAttachedFile(null);
      setErrorBanner(err instanceof Error ? err.message : 'Could not read that file.');
    }
  };

  const statusText = !backendOnline
    ? 'Sandbox Mode'
    : `Server Active${historyOn ? ' · History on' : ' · History off'}`;

  return (
    <div className="min-h-screen flex flex-col justify-between max-w-5xl mx-auto px-4 md:px-8 py-6 relative z-1">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-violet-600/5 rounded-full blur-[120px] pointer-events-none -z-10" />

      <header className="flex flex-wrap justify-between items-center gap-3 py-4 border-b border-white/5 mb-8 backdrop-blur-md sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-violet-600/10 border border-violet-500/20 shadow-[0_0_15px_rgba(139,92,246,0.1)]">
            <LuBrain className="w-6 h-6 text-violet-400" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white m-0">AI BATTLE ARENA</h1>
            <p className="text-[10px] text-neutral-500 font-mono tracking-wider">AI EVALUATION PLAYGROUND</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center bg-neutral-950/80 border border-white/5 rounded-full p-1 text-xs font-mono">
            <button
              onClick={() => setMode('live')}
              disabled={!backendOnline || running}
              className={`px-3 py-1 rounded-full transition-all cursor-pointer ${mode === 'live'
                ? 'bg-violet-600/20 text-violet-400 border border-violet-500/30'
                : 'text-neutral-400 hover:text-neutral-200 disabled:opacity-50 disabled:cursor-not-allowed'
                }`}
            >
              Live API
            </button>
            <button
              onClick={() => setMode('demo')}
              disabled={running}
              className={`px-3 py-1 rounded-full transition-all cursor-pointer disabled:cursor-not-allowed ${mode === 'demo'
                ? 'bg-amber-600/10 text-amber-400 border border-amber-500/20'
                : 'text-neutral-400 hover:text-neutral-200'
                }`}
            >
              Sandbox Demo
            </button>
          </div>

          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-neutral-950/60 border border-white/5 text-xs font-mono">
            <span className={`w-2 h-2 rounded-full ${backendOnline ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]'}`} />
            <span className="text-neutral-400 hidden sm:inline">{statusText}</span>
          </div>

          <button
            onClick={openHistory}
            disabled={!historyOn}
            title={historyOn ? 'Past battles' : 'History needs a database (set MONGODB_URI on the server)'}
            className="p-2 rounded-lg bg-white/[0.02] border border-white/10 text-neutral-300 hover:text-white hover:bg-white/[0.05] transition-all flex items-center gap-1.5 text-xs font-mono cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <LuHistory className="w-3.5 h-3.5" />
            <span className="hidden md:inline">History</span>
          </button>

          {battles.length > 0 && (
            <button
              onClick={clearChat}
              className="p-2 rounded-lg bg-red-950/10 border border-red-500/20 text-red-400 hover:bg-red-950/30 transition-all flex items-center gap-1.5 text-xs font-mono cursor-pointer"
              title="Clear the arena (saved battles stay in History)"
            >
              <LuTrash2 className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Clear Arena</span>
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 flex flex-col justify-start mb-8 min-h-[50vh]">
        {battles.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center py-12 px-4 animate-fade-in">
            <div className="relative mb-6">
              <div className="absolute inset-0 bg-violet-600/10 rounded-full blur-xl scale-125" />
              <div className="p-5 rounded-full bg-neutral-950/80 border border-violet-500/20 relative shadow-[0_0_30px_rgba(139,92,246,0.15)] animate-pulse">
                <LuBrain className="w-12 h-12 text-violet-400" />
              </div>
            </div>
            <h2 className="text-2xl font-semibold text-white tracking-tight mb-2">Start comparing AI responses</h2>
            <p className="text-neutral-400 max-w-md text-sm leading-relaxed mb-8">
              Pick two models and a judge below, enter a prompt, and watch both answers stream in.
            </p>

            <div className="w-full max-w-xl">
              <p className="mono-label text-neutral-500 mb-3 flex items-center justify-center gap-1">
                <FiHelpCircle className="w-3.5 h-3.5" />
                Select a test query to launch
              </p>
              <div className="flex flex-col gap-2">
                {QUICK_PROMPTS.map((item) => (
                  <button
                    key={item.title}
                    onClick={() => setPrompt(item.prompt)}
                    className="w-full text-left p-3.5 rounded-lg border border-white/5 bg-white/[0.01] hover:bg-white/[0.03] hover:border-violet-500/30 hover:shadow-[0_0_15px_rgba(139,92,246,0.05)] transition-all cursor-pointer flex justify-between items-center group"
                  >
                    <div>
                      <span className="text-xs font-semibold text-neutral-300 group-hover:text-violet-400 block mb-0.5">{item.title}</span>
                      <span className="text-[11px] text-neutral-500 line-clamp-1 font-mono">{item.prompt}</span>
                    </div>
                    <span className="text-[10px] font-mono text-neutral-600 group-hover:text-violet-400 border border-neutral-800 group-hover:border-violet-500/30 px-2 py-0.5 rounded-full transition-all">
                      Select
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-12">
            {battles.map((battle) => (
              <BattleView
                key={battle.key}
                battle={battle}
                actions={
                  battle.status === 'done' && !battle.demo ? (
                    <BattleActions
                      key={battle.id ?? battle.key}
                      id={battle.id}
                      saved={battle.saved}
                      historyOn={historyOn}
                      initialShareId={battle.shareId ?? null}
                    />
                  ) : null
                }
              />
            ))}
          </div>
        )}
        <div ref={chatEndRef} />
      </main>

      <footer className="sticky bottom-0 bg-[#050505]/90 backdrop-blur-md pt-4 pb-4 border-t border-white/5 z-30">
        <form onSubmit={handleSend} className="w-full max-w-4xl mx-auto flex flex-col gap-3 relative">
          <SettingsBar models={models} settings={settings} onChange={changeSettings} disabled={running} />

          {attachedFile && (
            <div className="flex">
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-violet-600/10 border border-violet-500/20 text-violet-400 text-xs font-mono animate-fade-in shadow-md">
                <LuFileText className="w-3.5 h-3.5" />
                <span>{attachedFile.name}</span>
                <button
                  type="button"
                  onClick={() => setAttachedFile(null)}
                  className="text-neutral-400 hover:text-red-400 ml-1 transition-all cursor-pointer"
                  title="Remove attachment"
                  aria-label="Remove attachment"
                >
                  <LuX className="w-3 h-3" />
                </button>
              </div>
            </div>
          )}

          {errorBanner && (
            <div role="alert" className="flex items-center gap-2 p-3 rounded-lg border border-red-500/20 bg-red-500/5 text-red-400 text-xs font-mono">
              <FiAlertTriangle className="w-4 h-4 shrink-0" />
              <span>{errorBanner}</span>
            </div>
          )}

          <div className="glass-panel rounded-2xl active-input-glow flex items-center border border-white/10 p-2 pl-4 transition-all pr-3 bg-neutral-950/80">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={running}
              className="p-2.5 rounded-xl bg-white/[0.02] border border-white/5 text-neutral-400 hover:text-white hover:bg-white/[0.05] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed mr-2.5"
              title="Attach a text file as context"
              aria-label="Attach a text file"
            >
              <LuPaperclip className="w-4 h-4" />
            </button>
            <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" />

            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Compare responses from multiple AI models..."
              aria-label="Prompt"
              disabled={running}
              rows={2}
              maxLength={4000}
              className="flex-1 bg-transparent border-0 outline-none text-white text-[14px] placeholder-neutral-500 resize-none py-1 focus:ring-0 leading-relaxed font-light"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />

            {running ? (
              <button
                type="button"
                onClick={handleStop}
                className="h-11 px-5 rounded-xl font-medium text-xs font-mono flex items-center justify-center gap-2 select-none border border-red-500/40 bg-red-950/20 text-red-300 hover:bg-red-950/40 transition-all cursor-pointer"
              >
                <LuSquare className="w-3.5 h-3.5" />
                <span>Stop</span>
              </button>
            ) : (
              <button
                type="submit"
                disabled={!prompt.trim()}
                className={`h-11 px-5 rounded-xl font-medium text-xs font-mono flex items-center justify-center gap-2 select-none border transition-all ${prompt.trim()
                  ? 'bg-violet-600 border-violet-500 text-white hover:bg-violet-500 hover:shadow-[0_0_15px_rgba(139,92,246,0.3)] shadow-[0_0_10px_rgba(139,92,246,0.15)] cursor-pointer'
                  : 'bg-neutral-900 border-white/5 text-neutral-500 cursor-not-allowed'
                  }`}
              >
                <span>Send</span>
                <LuSend className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex justify-between items-center px-2 text-[10px] text-neutral-500 font-mono">
            <span>{mode === 'demo' ? 'Sandbox Demo: sample data, no API calls' : 'Live: each battle uses your API credits'}</span>
            <span className="hidden sm:inline">Press Enter to send, Shift+Enter for new line</span>
          </div>
        </form>
      </footer>

      <HistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        items={history.items}
        loading={history.loading}
        error={history.error}
        hasMore={history.hasMore}
        onOpen={openSaved}
        onDelete={removeSaved}
        onMore={() => loadHistory({ more: true })}
      />
    </div>
  );
}

export default App;
