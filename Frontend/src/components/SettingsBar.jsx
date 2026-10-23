const selectClass =
  'bg-neutral-950/80 border border-white/10 rounded-lg px-2 py-1.5 text-xs font-mono text-neutral-200 outline-none focus:border-violet-500/50 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer';

function ModelSelect({ label, value, options, onChange, disabled }) {
  return (
    <label className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-neutral-500">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className={selectClass}>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

// Choose the two contestants, the judge and how many rounds to play
function SettingsBar({ models, settings, onChange, disabled }) {
  // Picking the model the other side already uses swaps them, so the two are always different
  const setContestant = (index, id) => {
    const other = 1 - index;
    const next = [...settings.models];
    if (next[other] === id) next[other] = next[index];
    next[index] = id;
    onChange({ ...settings, models: next });
  };

  const judgeIsContestant = settings.models.includes(settings.judge);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1">
      <ModelSelect label="Model 1" value={settings.models[0]} options={models} disabled={disabled} onChange={(id) => setContestant(0, id)} />
      <span className="text-[10px] font-mono text-neutral-600">VS</span>
      <ModelSelect label="Model 2" value={settings.models[1]} options={models} disabled={disabled} onChange={(id) => setContestant(1, id)} />
      <ModelSelect label="Judge" value={settings.judge} options={models} disabled={disabled} onChange={(id) => onChange({ ...settings, judge: id })} />

      <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-neutral-500">
        <span>Rounds</span>
        <div className="flex bg-neutral-950/80 border border-white/10 rounded-lg p-0.5" role="group" aria-label="Rounds">
          {[1, 2].map((n) => (
            <button
              key={n}
              type="button"
              disabled={disabled}
              aria-pressed={settings.rounds === n}
              onClick={() => onChange({ ...settings, rounds: n })}
              title={n === 1 ? 'Each model answers once' : 'Answer, then each model critiques the other and revises (about 3x the cost)'}
              className={`px-2.5 py-1 rounded-md text-xs transition-all cursor-pointer disabled:cursor-not-allowed ${settings.rounds === n
                ? 'bg-violet-600/20 text-violet-300 border border-violet-500/30'
                : 'text-neutral-400 hover:text-neutral-200 border border-transparent'
                }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {judgeIsContestant && (
        <span className="text-[10px] font-mono text-amber-400/80" title="A model may favor answers that sound like its own">
          The judge is also a contestant
        </span>
      )}
    </div>
  );
}

export default SettingsBar;
