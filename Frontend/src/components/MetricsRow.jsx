import { LuTimer, LuCoins, LuHash } from 'react-icons/lu';
import { fmtCost, fmtSeconds, fmtTokens } from '../lib/format';

// Latency, tokens and cost for one model. "~" marks token counts that were estimated
// because the provider did not report usage.
function MetricsRow({ metrics }) {
  if (!metrics) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-3 mt-auto border-t border-white/5 text-[11px] font-mono text-neutral-500">
      <span className="flex items-center gap-1" title="Time spent generating (all rounds)">
        <LuTimer className="w-3 h-3" /> {fmtSeconds(metrics.latencyMs)}
      </span>
      <span
        className="flex items-center gap-1"
        title={metrics.estimated ? 'Estimated: the provider did not report token usage' : 'Input / output tokens'}
      >
        <LuHash className="w-3 h-3" />
        {fmtTokens(metrics.inputTokens)} in · {fmtTokens(metrics.outputTokens)} out{metrics.estimated ? ' (est.)' : ''}
      </span>
      <span className="flex items-center gap-1" title="Estimated from list prices">
        <LuCoins className="w-3 h-3" /> {fmtCost(metrics.costUsd)}
      </span>
    </div>
  );
}

export default MetricsRow;
