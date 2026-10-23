import type { Side } from "../ai/types.js";
import type { StoredBattle } from "../store/types.js";

const quote = (text: string) => text.split("\n").map((line) => `> ${line}`).join("\n");
const money = (usd: number) => (usd < 0.01 ? `$${usd.toFixed(5)}` : `$${usd.toFixed(3)}`);
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

export function battleToMarkdown(battle: StoredBattle): string {
    const { labels, config, judge, metrics } = battle;
    const lines: string[] = [];

    const winnerText = battle.winner === "none"
        ? "No winner (the judge did not run)"
        : battle.winner === "tie"
            ? "Tie"
            : labels[battle.winner];

    lines.push("# AI Battle Arena result", "");
    lines.push(`- **Date:** ${battle.createdAt}`);
    lines.push(`- **Models:** ${labels.solution_1} vs ${labels.solution_2}`);
    lines.push(`- **Judge:** ${labels.judge}`);
    lines.push(`- **Rounds:** ${config.rounds === 2 ? "2 (answer, then critique and revise)" : "1 (answer only)"}`);
    lines.push(`- **Winner:** ${winnerText}`);
    if (!judge.skipped) lines.push(`- **Judge confidence:** ${judge.confidence}%`);
    lines.push("", "## Question", "", quote(battle.problem));
    if (battle.attachmentName) lines.push("", `_Attached file: ${battle.attachmentName}_`);

    const sides: Side[] = ["solution_1", "solution_2"];
    for (const side of sides) {
        const n = side === "solution_1" ? "1" : "2";
        const error = battle[`${side}_error`];
        const initial = battle[side];
        const revised = battle[`revised_${n}` as "revised_1" | "revised_2"];
        const critique = battle[`critique_${n}` as "critique_1" | "critique_2"];

        lines.push("", `## ${labels[side]}`);
        if (!judge.skipped) {
            const c = judge[`${side}_criteria`];
            lines.push("", `**Score: ${judge[`${side}_score`]}/10** (accuracy ${c.accuracy}, clarity ${c.clarity}, creativity ${c.creativity}, conciseness ${c.conciseness})`);
        }
        if (error) {
            lines.push("", `_${error}_`);
            continue;
        }
        if (revised) {
            lines.push("", "### Final answer (after revision)", "", revised);
            lines.push("", "### Initial answer", "", initial);
            if (critique) lines.push("", "### Critique of the opponent's answer", "", critique);
        } else {
            lines.push("", initial);
            if (critique) lines.push("", "### Critique of the opponent's answer", "", critique);
        }
    }

    lines.push("", "## Judge verdict", "");
    if (judge.skipped) {
        lines.push(`_${judge.solution_1_reasoning || "The judge did not run."}_`);
    } else {
        lines.push(`**${labels.solution_1}:** ${judge.solution_1_reasoning}`, "");
        lines.push(`**${labels.solution_2}:** ${judge.solution_2_reasoning}`);
    }

    lines.push("", "## Speed, tokens and cost", "");
    lines.push("| Role | Model | Latency | Input tokens | Output tokens | Est. cost |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    const row = (role: string, name: string, m: StoredBattle["metrics"]["judge"]) =>
        `| ${role} | ${name} | ${seconds(m.latencyMs)} | ${m.inputTokens}${m.estimated ? "*" : ""} | ${m.outputTokens}${m.estimated ? "*" : ""} | ${money(m.costUsd)} |`;
    lines.push(row("Contestant 1", labels.solution_1, metrics.solution_1));
    lines.push(row("Contestant 2", labels.solution_2, metrics.solution_2));
    lines.push(row("Judge", labels.judge, metrics.judge));
    lines.push("", `Total estimated cost: ${money(battle.totalCostUsd)}. Total time: ${seconds(battle.durationMs)}.`);
    lines.push("", "_Costs are estimates from list prices. Token counts marked * are estimated because the provider did not report usage._");

    if (battle.warnings.length > 0) {
        lines.push("", "## Warnings", "", ...battle.warnings.map((w) => `- ${w}`));
    }

    return lines.join("\n") + "\n";
}
