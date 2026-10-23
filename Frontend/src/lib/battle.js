// Turns the stream of server events into something the UI can draw, and normalizes
// live, saved and shared battles into one shape (describe) so the same view renders all three.

export const CRITERIA = ['accuracy', 'clarity', 'creativity', 'conciseness'];

const emptyText = () => ({ answer: '', critique: '', revision: '' });

export function newLiveBattle({ key, problem, attachment, config }) {
  return {
    key,
    problem,
    attachment,
    config,
    labels: null,
    stage: 'answer',
    text: { solution_1: emptyText(), solution_2: emptyText() },
    errors: { solution_1: '', solution_2: '', judge: '' },
    liveMetrics: { solution_1: null, solution_2: null, judge: null },
    result: null,
    id: null,
    saved: false,
    status: 'running', // running | done | error | stopped
    error: '',
    demo: false,
  };
}

// A battle loaded from history (already finished)
export function fromStored(stored, key) {
  return {
    key,
    problem: stored.problem,
    attachment: stored.attachmentName ?? null,
    config: stored.config,
    labels: stored.labels,
    stage: 'judge',
    text: { solution_1: emptyText(), solution_2: emptyText() },
    errors: { solution_1: '', solution_2: '', judge: '' },
    liveMetrics: { solution_1: null, solution_2: null, judge: null },
    result: stored,
    id: stored.id ?? null,
    shareId: stored.shareId ?? null,
    saved: Boolean(stored.id),
    status: 'done',
    error: '',
    demo: false,
  };
}

const addMetrics = (total, event) => ({
  latencyMs: (total?.latencyMs ?? 0) + event.latencyMs,
  inputTokens: (total?.inputTokens ?? 0) + event.inputTokens,
  outputTokens: (total?.outputTokens ?? 0) + event.outputTokens,
  costUsd: (total?.costUsd ?? 0) + event.costUsd,
  estimated: Boolean(total?.estimated) || event.estimated,
});

export function applyEvents(battle, events) {
  let next = battle;
  for (const event of events) {
    switch (event.type) {
      case 'start':
        next = { ...next, labels: event.labels, config: event.config };
        break;
      case 'stage':
        if (event.status === 'start') next = { ...next, stage: event.stage };
        break;
      case 'token': {
        const side = next.text[event.side];
        next = {
          ...next,
          text: { ...next.text, [event.side]: { ...side, [event.stage]: side[event.stage] + event.text } },
        };
        break;
      }
      case 'model_done':
        next = { ...next, liveMetrics: { ...next.liveMetrics, [event.side]: addMetrics(next.liveMetrics[event.side], event) } };
        break;
      case 'model_error':
        next = { ...next, errors: { ...next.errors, [event.side]: event.message } };
        break;
      case 'result':
        next = { ...next, result: event.result, id: event.id, saved: event.saved, status: 'done' };
        break;
      case 'error':
        next = { ...next, status: 'error', error: event.message };
        break;
      default:
        break;
    }
  }
  return next;
}

const FALLBACK_LABELS = { solution_1: 'Model 1', solution_2: 'Model 2', judge: 'Judge' };

// One normalized description of a battle, whether it is still streaming or finished
export function describe(battle) {
  const r = battle.result;
  const labels = r?.labels ?? battle.labels ?? FALLBACK_LABELS;
  const running = battle.status === 'running';

  const side = (n) => {
    const key = `solution_${n}`;
    const live = battle.text[key];
    const revised = r ? r[`revised_${n}`] : live.revision;
    const initial = r ? r[key] : live.answer;
    return {
      key,
      label: labels[key],
      text: revised || initial,
      initial,
      hasRevision: Boolean(revised),
      critique: r ? r[`critique_${n}`] : live.critique,
      error: r ? r[`${key}_error`] : battle.errors[key],
      metrics: r ? r.metrics?.[key] ?? null : battle.liveMetrics[key],
      // The caret blinks while this side may still be receiving text
      streaming: running && !r && battle.stage !== 'judge' && !battle.errors[key],
    };
  };

  const judge = r?.judge ?? null;
  const winner = !r ? null : r.winner;

  return {
    labels,
    sides: [side(1), side(2)],
    judge,
    winner,
    judgeLabel: labels.judge,
    judgeMetrics: r ? r.metrics?.judge ?? null : battle.liveMetrics.judge,
    judgeError: battle.errors.judge,
    judging: running && !r && battle.stage === 'judge',
    rounds: r?.config?.rounds ?? battle.config?.rounds ?? 1,
    totalCostUsd: r && !battle.demo ? r.totalCostUsd : null,
    durationMs: r && !battle.demo ? r.durationMs : null,
    warnings: r?.warnings ?? [],
    judgeIsContestant: Boolean(
      (r?.config ?? battle.config) &&
      (r?.config ?? battle.config).models.includes((r?.config ?? battle.config).judge),
    ),
  };
}

// Sandbox demo: clearly fake data so the UI can be explored without a server or API keys
export function makeDemoResult({ problem, config, labels }) {
  const c = (accuracy, clarity, creativity, conciseness) => ({ accuracy, clarity, creativity, conciseness });
  const mean = (x) => Math.round(((x.accuracy + x.clarity + x.creativity + x.conciseness) / 4) * 10) / 10;
  const one = c(8, 7, 6, 9);
  const two = c(7, 9, 8, 6);
  return {
    config,
    labels,
    problem,
    solution_1: `**${labels.solution_1}** (demo): a direct answer to "${problem}". Short, technical and to the point.`,
    solution_2: `**${labels.solution_2}** (demo): a longer answer to "${problem}" that explains the background first, then the trade-offs.`,
    solution_1_error: '',
    solution_2_error: '',
    critique_1: config.rounds === 2 ? 'Demo critique: the other answer is longer than it needs to be.' : '',
    critique_2: config.rounds === 2 ? 'Demo critique: the other answer skips the background.' : '',
    revised_1: '',
    revised_2: '',
    judge: {
      solution_1_score: mean(one),
      solution_2_score: mean(two),
      solution_1_criteria: one,
      solution_2_criteria: two,
      solution_1_reasoning: `${labels.solution_1} is concise and accurate but has little depth. (Demo data)`,
      solution_2_reasoning: `${labels.solution_2} explains more and reads well, but is longer than needed. (Demo data)`,
      confidence: 60,
      skipped: false,
      position_swapped: false,
    },
    warnings: [],
    winner: mean(one) > mean(two) ? 'solution_1' : mean(two) > mean(one) ? 'solution_2' : 'tie',
  };
}
