// Shows which step of the battle is running: Answer, (Critique, Revise), Judge
const STEPS_1 = [['answer', 'Answer'], ['judge', 'Judge']];
const STEPS_2 = [['answer', 'Answer'], ['critique', 'Critique'], ['revision', 'Revise'], ['judge', 'Judge']];

function StageProgress({ stage, rounds }) {
  const steps = rounds === 2 ? STEPS_2 : STEPS_1;
  const current = Math.max(0, steps.findIndex(([id]) => id === stage));

  return (
    <ol className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider" aria-label="Battle progress">
      {steps.map(([id, label], i) => {
        const state = i < current ? 'done' : i === current ? 'active' : 'todo';
        return (
          <li key={id} className="flex items-center gap-2" aria-current={state === 'active' ? 'step' : undefined}>
            <span
              className={`px-2 py-0.5 rounded-full border ${state === 'active'
                ? 'text-violet-300 border-violet-500/40 bg-violet-600/10 animate-pulse'
                : state === 'done'
                  ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/5'
                  : 'text-neutral-600 border-white/5'
                }`}
            >
              {label}
            </span>
            {i < steps.length - 1 && <span className="text-neutral-700">›</span>}
          </li>
        );
      })}
    </ol>
  );
}

export default StageProgress;
