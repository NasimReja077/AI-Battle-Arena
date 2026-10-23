import { useEffect, useState } from 'react';
import { LuBrain } from 'react-icons/lu';
import BattleView from './BattleView';
import { getShared } from '../api';
import { fromStored } from '../lib/battle';

// Public, read-only page for a shared battle (opened from a #/s/<id> link)
function SharedPage({ shareId }) {
  const [state, setState] = useState({ status: 'loading', battle: null, error: '' });

  useEffect(() => {
    let cancelled = false;
    getShared(shareId)
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', battle: fromStored(data.battle, 'shared'), error: '' });
      })
      .catch((err) => {
        if (!cancelled) {
          setState({ status: 'error', battle: null, error: err instanceof Error ? err.message : 'Could not load this battle.' });
        }
      });
    return () => { cancelled = true; };
  }, [shareId]);

  return (
    <div className="min-h-screen max-w-5xl mx-auto px-4 md:px-8 py-6">
      <header className="flex justify-between items-center py-4 border-b border-white/5 mb-8">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-violet-600/10 border border-violet-500/20">
            <LuBrain className="w-6 h-6 text-violet-400" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white m-0">AI BATTLE ARENA</h1>
            <p className="text-[10px] text-neutral-500 font-mono tracking-wider">SHARED BATTLE · READ ONLY</p>
          </div>
        </div>
        <a href={`${window.location.pathname}`} className="text-xs font-mono text-violet-400 hover:text-violet-300">
          Open the arena
        </a>
      </header>

      {state.status === 'loading' && <p className="text-sm font-mono text-neutral-500">Loading…</p>}
      {state.status === 'error' && (
        <p role="alert" className="text-sm font-mono text-amber-400">{state.error}</p>
      )}
      {state.status === 'ready' && <BattleView battle={state.battle} />}
    </div>
  );
}

export default SharedPage;
