import { LuTrophy } from 'react-icons/lu';
import RadarChart from './RadarChart';
import MetricsRow from './MetricsRow';
import { CRITERIA } from '../lib/battle';
import { fmtCost, fmtSeconds } from '../lib/format';

const COLORS = ['#a78bfa', '#38bdf8'];

function Stat({ label, value }) {
  return (
    <div className="text-right">
      <span className="text-[9px] text-neutral-500 font-mono block uppercase">{label}</span>
      <span className="text-xs font-bold font-mono text-white uppercase">{value}</span>
    </div>
  );
}

// The judge's verdict: winner, confidence, per-criteria scores (radar + table) and reasoning
function JudgePanel({ view, demo }) {
  const { judge, labels, sides } = view;
  const skipped = !judge || judge.skipped;
  const s1 = judge?.solution_1_score ?? 0;
  const s2 = judge?.solution_2_score ?? 0;
  const winnerLabel = skipped ? 'No winner' : view.winner === 'tie' ? 'Draw (Tied)' : labels[view.winner];
  const winnerReasoning = skipped
    ? judge?.solution_1_reasoning || view.judgeError || 'The judge did not run, so there is nothing to compare.'
    : view.winner === 'solution_1' ? judge.solution_1_reasoning
      : view.winner === 'solution_2' ? judge.solution_2_reasoning
        : 'Both models scored the same, so this battle is a draw.';

  return (
    <div className="glass-panel p-6 rounded-xl border border-white/5 relative overflow-hidden bg-neutral-950/40">
      <div className="absolute top-0 bottom-0 left-0 w-1 bg-emerald-500" />

      <div className="flex flex-wrap justify-between items-center gap-4 mb-5 pb-4 border-b border-white/5">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
            <LuTrophy className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-400">Judge verdict</h4>
            <span className="text-[10px] font-mono text-neutral-500 uppercase">Judged by {view.judgeLabel}</span>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <Stat label="Winner" value={winnerLabel} />
          <Stat label="Top score" value={skipped ? '—' : `${Math.max(s1, s2).toFixed(1)}/10`} />
          <Stat label="Confidence" value={skipped ? '—' : `${judge.confidence}%`} />
        </div>
      </div>

      <div className="mb-6">
        <h5 className="text-[11px] font-mono text-neutral-400 mb-2 uppercase tracking-wide">
          {skipped ? 'Why there is no verdict' : view.winner === 'tie' ? 'Result' : 'Why it won'}
        </h5>
        <p className="text-neutral-300 text-sm leading-relaxed">{winnerReasoning}</p>
      </div>

      {!skipped && (
        <div className="pt-4 border-t border-white/5">
          <h5 className="text-[11px] font-mono text-neutral-400 mb-3 uppercase tracking-wide">Scores by criterion</h5>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
            <RadarChart
              axes={CRITERIA}
              series={[
                { name: labels.solution_1, color: COLORS[0], values: CRITERIA.map((c) => judge.solution_1_criteria[c]) },
                { name: labels.solution_2, color: COLORS[1], values: CRITERIA.map((c) => judge.solution_2_criteria[c]) },
              ]}
            />
            <table className="w-full text-xs font-mono">
              <caption className="sr-only">Scores out of 10 for each criterion</caption>
              <thead>
                <tr className="text-neutral-500 text-left">
                  <th className="font-normal pb-2 uppercase text-[10px] tracking-wider">Criterion</th>
                  {sides.map((s, i) => (
                    <th key={s.key} className="font-normal pb-2 text-right">
                      <span className="inline-flex items-center gap-1.5 justify-end">
                        <span className="w-2 h-2 rounded-full" style={{ background: COLORS[i] }} aria-hidden="true" />
                        <span className="truncate max-w-36">{s.label}</span>
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {CRITERIA.map((c) => (
                  <tr key={c} className="border-t border-white/5">
                    <td className="py-1.5 capitalize text-neutral-400">{c}</td>
                    <td className="py-1.5 text-right text-neutral-200">{judge.solution_1_criteria[c]}</td>
                    <td className="py-1.5 text-right text-neutral-200">{judge.solution_2_criteria[c]}</td>
                  </tr>
                ))}
                <tr className="border-t border-white/10 font-bold">
                  <td className="py-1.5 text-neutral-300">Overall</td>
                  <td className="py-1.5 text-right text-white">{s1.toFixed(1)}</td>
                  <td className="py-1.5 text-right text-white">{s2.toFixed(1)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
            {[judge.solution_1_reasoning, judge.solution_2_reasoning].map((reasoning, i) => (
              <div key={sides[i].key} className="p-4 rounded-lg bg-white/[0.01] border border-white/5">
                <span className="text-xs font-semibold text-neutral-300 block mb-2">{sides[i].label}</span>
                <p className="text-neutral-400 text-xs leading-relaxed font-light">{reasoning || 'No details available.'}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {view.judgeIsContestant && !skipped && (
        <p className="mt-4 text-[11px] font-mono text-amber-400/80">
          The judge also competed in this battle, so it may favor answers that sound like its own.
        </p>
      )}

      {demo ? (
        <p className="mt-4 text-[11px] font-mono text-amber-400">Sandbox demo: this is sample data, not real model output.</p>
      ) : (
        <>
          <MetricsRow metrics={view.judgeMetrics} />
          {view.totalCostUsd !== null && (
            <p className="mt-2 text-[11px] font-mono text-neutral-500">
              Whole battle: {fmtSeconds(view.durationMs)} · {fmtCost(view.totalCostUsd)} (judge row above is the judge alone)
            </p>
          )}
        </>
      )}
    </div>
  );
}

export default JudgePanel;
