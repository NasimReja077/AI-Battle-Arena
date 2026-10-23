import { useState } from 'react';
import { LuTrophy, LuSparkles, LuCpu, LuChevronDown } from 'react-icons/lu';
import Markdown from './Markdown';
import MetricsRow from './MetricsRow';

function Collapsible({ title, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3 border-t border-white/5 pt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1 text-[11px] font-mono text-neutral-500 hover:text-neutral-300 cursor-pointer"
      >
        <LuChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
        {title}
      </button>
      {open && <div className="mt-2 text-[13px] text-neutral-400 leading-relaxed"><Markdown text={children} /></div>}
    </div>
  );
}

// One contestant: its answer (streaming or final), score, speed/cost and, in 2-round battles, critique and first draft
function SideCard({ side, index, score, isWinner, showScore }) {
  const Icon = index === 0 ? LuSparkles : LuCpu;
  const waiting = !side.text && !side.error && side.streaming;

  return (
    <div
      className={`glass-panel p-5 rounded-xl transition-all relative flex flex-col ${isWinner
        ? 'border-violet-500/60 shadow-[0_0_35px_rgba(139,92,246,0.22),_inset_0_0_12px_rgba(139,92,246,0.12)] bg-violet-950/[0.02]'
        : 'border-white/5 hover:border-white/10'
        }`}
    >
      {isWinner && (
        <div className="absolute -top-3 right-4 bg-violet-600 border border-violet-400 text-white text-[9px] font-mono tracking-widest px-2.5 py-0.5 rounded-full shadow-lg flex items-center gap-1 uppercase select-none">
          <LuTrophy className="w-2.5 h-2.5" /> Best Response
        </div>
      )}

      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-2">
          <div className={`p-1.5 rounded-lg border ${isWinner ? 'bg-violet-600/10 border-violet-500/30' : 'bg-neutral-900 border-white/5'}`}>
            <Icon className={`w-4 h-4 ${isWinner ? 'text-violet-400' : 'text-neutral-400'}`} />
          </div>
          <div>
            <h3 className={`text-xs font-bold tracking-wide uppercase ${isWinner ? 'text-violet-400' : 'text-neutral-300'}`}>{side.label}</h3>
            <p className="text-[9px] text-neutral-500 font-mono tracking-wider">
              MODEL {index + 1}{side.hasRevision ? ' · REVISED ANSWER' : ''}
            </p>
          </div>
        </div>

        {showScore && (
          <div className="flex flex-col items-end">
            <span className="text-[10px] text-neutral-500 font-mono uppercase tracking-wider">Score</span>
            <span className={`text-xl font-bold font-mono ${isWinner ? 'text-violet-400 text-neon-glow-violet' : 'text-neutral-300'}`}>
              {score.toFixed(1)}
            </span>
          </div>
        )}
      </div>

      <div className="text-neutral-300 text-[14px] leading-relaxed mb-4 font-normal min-h-12" aria-live="off">
        {side.error ? (
          <p className="text-amber-400 text-sm font-mono">{side.error}</p>
        ) : waiting ? (
          <div className="flex flex-col gap-2.5 animate-pulse" aria-label="Waiting for the first words">
            <div className="w-full h-3 bg-neutral-800 rounded" />
            <div className="w-11/12 h-3 bg-neutral-800 rounded" />
            <div className="w-3/5 h-3 bg-neutral-800 rounded" />
          </div>
        ) : (
          <>
            <Markdown text={side.text} />
            {side.streaming && <span className="inline-block w-1.5 h-4 ml-0.5 -mb-0.5 bg-violet-400 animate-pulse" aria-hidden="true" />}
          </>
        )}
      </div>

      {side.hasRevision && <Collapsible title="First draft (before revising)">{side.initial}</Collapsible>}
      {side.critique && <Collapsible title="Its critique of the other answer">{side.critique}</Collapsible>}

      <MetricsRow metrics={side.metrics} />
    </div>
  );
}

export default SideCard;
