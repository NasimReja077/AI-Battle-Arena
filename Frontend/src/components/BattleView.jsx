import { FiAlertTriangle } from 'react-icons/fi';
import { LuFileText } from 'react-icons/lu';
import SideCard from './SideCard';
import JudgePanel from './JudgePanel';
import StageProgress from './StageProgress';
import { describe } from '../lib/battle';

// One battle: the question, the two answers, the judge. Renders live (streaming), saved and shared battles alike.
function BattleView({ battle, actions = null }) {
  const view = describe(battle);
  const hasJudgeScores = view.judge && !view.judge.skipped;
  const running = battle.status === 'running';
  const showJudge = Boolean(battle.result) || view.judging;

  return (
    <section className="flex flex-col gap-6 animate-fade-in" aria-label={`Battle: ${battle.problem.slice(0, 60)}`}>
      <div className="glass-panel p-5 rounded-xl border border-white/5 bg-white/[0.01]">
        <div className="flex flex-wrap justify-between items-center gap-2 mb-2">
          <span className="mono-label text-neutral-500 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400" />
            Arena Input Prompt
          </span>
          {battle.attachment && (
            <div className="flex items-center gap-1 text-[11px] font-mono text-violet-400 bg-violet-600/10 border border-violet-500/20 px-2 py-0.5 rounded-full">
              <LuFileText className="w-3 h-3" />
              <span>{battle.attachment}</span>
            </div>
          )}
        </div>
        <p className="text-[15px] text-white leading-relaxed font-medium whitespace-pre-line">{battle.problem}</p>
      </div>

      {running && !battle.result && <StageProgress stage={battle.stage} rounds={view.rounds} />}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {view.sides.map((side, i) => (
          <SideCard
            key={side.key}
            side={side}
            index={i}
            showScore={hasJudgeScores}
            score={i === 0 ? view.judge?.solution_1_score ?? 0 : view.judge?.solution_2_score ?? 0}
            isWinner={view.winner === side.key}
          />
        ))}
      </div>

      {view.warnings.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs font-mono text-amber-400">
          {view.warnings.map((w) => (
            <li key={w} className="flex items-center gap-2"><FiAlertTriangle className="w-3.5 h-3.5 shrink-0" />{w}</li>
          ))}
        </ul>
      )}

      {battle.status === 'error' && (
        <div role="alert" className="flex items-center gap-2 p-3 rounded-lg border border-red-500/20 bg-red-500/5 text-red-400 text-xs font-mono">
          <FiAlertTriangle className="w-4 h-4 shrink-0" />
          <span>{battle.error || 'Something went wrong.'}</span>
        </div>
      )}
      {battle.status === 'stopped' && (
        <p className="text-xs font-mono text-neutral-500">Stopped. This battle was not judged or saved.</p>
      )}

      {showJudge ? (
        <JudgePanel view={view} demo={battle.demo} />
      ) : null}

      {actions}
    </section>
  );
}

export default BattleView;
