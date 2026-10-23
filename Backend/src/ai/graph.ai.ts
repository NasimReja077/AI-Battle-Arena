import { StateGraph, StateSchema, START, END, type GraphNode } from "@langchain/langgraph"
import z from "zod";
import { getRealRegistry, type ModelInfo, type ModelRegistry } from "./model.ai.js";
import { addCall, costOf, emptyMetrics, resolveUsage } from "./metrics.js";
import type {
    BattleConfig,
    BattleEvent,
    BattleResult,
    Criteria,
    JudgeResult,
    Metrics,
    Side,
    Stage,
    StreamStage,
    Usage,
    Winner,
} from "./types.js";

const metricsSchema = z.object({
    latencyMs: z.number(),
    inputTokens: z.number(),
    outputTokens: z.number(),
    costUsd: z.number(),
    estimated: z.boolean(),
});

const criteriaSchema = z.object({
    accuracy: z.number(),
    clarity: z.number(),
    creativity: z.number(),
    conciseness: z.number(),
});

const emptyCriteria = (): Criteria => ({ accuracy: 0, clarity: 0, creativity: 0, conciseness: 0 });

const skippedJudge = (reason: string): JudgeResult => ({
    solution_1_score: 0,
    solution_2_score: 0,
    solution_1_criteria: emptyCriteria(),
    solution_2_criteria: emptyCriteria(),
    solution_1_reasoning: reason,
    solution_2_reasoning: reason,
    confidence: 0,
    skipped: true,
    position_swapped: false,
});

// Define the state schema for the graph
const state = new StateSchema({
    problem: z.string().default(""),
    model_1: z.string().default(""),
    model_2: z.string().default(""),
    judge_model: z.string().default(""),
    rounds: z.number().default(1),

    // Round 1 answers. A non-empty *_error means that model failed or returned nothing.
    solution_1: z.string().default(""),
    solution_2: z.string().default(""),
    solution_1_error: z.string().default(""),
    solution_2_error: z.string().default(""),

    // Round 2 (critique and revise). critique_1 is what model 1 wrote about model 2's answer.
    critique_1: z.string().default(""),
    critique_2: z.string().default(""),
    revised_1: z.string().default(""),
    revised_2: z.string().default(""),

    warnings: z.array(z.string()).default(() => []),

    metrics: z.object({
        solution_1: metricsSchema,
        solution_2: metricsSchema,
        judge: metricsSchema,
    }).default(() => ({ solution_1: emptyMetrics(), solution_2: emptyMetrics(), judge: emptyMetrics() })),

    judge: z.object({
        solution_1_score: z.number(),
        solution_2_score: z.number(),
        solution_1_criteria: criteriaSchema,
        solution_2_criteria: criteriaSchema,
        solution_1_reasoning: z.string(),
        solution_2_reasoning: z.string(),
        confidence: z.number(),
        skipped: z.boolean(),
        position_swapped: z.boolean(),
    }).default(() => skippedJudge("")),
})

type GraphState = typeof state.State;
type NodeConfig = Parameters<GraphNode<typeof state>>[1];

const emit = (config: NodeConfig, event: BattleEvent) => {
    config.writer?.(event);
};

class EmptyResponseError extends Error { }

const modelFor = (registry: ModelRegistry, id: string): ModelInfo => {
    const info = (registry as Record<string, ModelInfo | undefined>)[id];
    if (!info) throw new Error(`Unknown model: ${id}`);
    return info;
};

interface Call {
    text: string;
    latencyMs: number;
    usage: Usage;
    costUsd: number;
}

// Stream one model's answer, forwarding tokens as they arrive and measuring latency, tokens and cost
async function streamCall(
    info: ModelInfo,
    prompt: string,
    side: Side,
    stage: StreamStage,
    config: NodeConfig,
): Promise<Call> {
    const started = Date.now();
    let text = "";
    let reported: { input: number; output: number } | undefined;

    for await (const chunk of info.model.stream(prompt, config.signal)) {
        if (chunk.text) {
            text += chunk.text;
            emit(config, { type: "token", side, stage, text: chunk.text });
        }
        if (chunk.usage) {
            // Providers either send usage once at the end or a running total, so the largest value is the final one
            reported = {
                input: Math.max(reported?.input ?? 0, chunk.usage.input),
                output: Math.max(reported?.output ?? 0, chunk.usage.output),
            };
        }
    }

    text = text.trim();
    if (!text) throw new EmptyResponseError();

    const latencyMs = Date.now() - started;
    const usage = resolveUsage(reported, prompt, text);
    const costUsd = costOf(usage, info.pricing);
    emit(config, {
        type: "model_done",
        side,
        stage,
        latencyMs,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        costUsd,
        estimated: usage.estimated,
    });
    return { text, latencyMs, usage, costUsd };
}

// Run one streamed call without letting a failure escape (the battle carries on with the other model)
async function settle(
    info: ModelInfo,
    prompt: string,
    side: Side,
    stage: StreamStage,
    config: NodeConfig,
): Promise<{ call?: Call; error?: string }> {
    try {
        return { call: await streamCall(info, prompt, side, stage, config) };
    } catch (error) {
        if (config.signal?.aborted) throw error;
        console.error(`${info.label} failed during ${stage}:`, error);
        // Generic message: raw provider errors can be long and are not useful to end users
        const message = error instanceof EmptyResponseError
            ? `${info.label} returned an empty response.`
            : `${info.label} failed to respond.`;
        emit(config, { type: "model_error", side, stage, message });
        return { error: message };
    }
}

const stageEvent = (config: NodeConfig, stage: Stage, status: "start" | "end") =>
    emit(config, { type: "stage", stage, status });

const critiquePrompt = (problem: string, own: string, opponent: string) =>
    `You are in a head-to-head battle with another AI model.

Problem:
${problem}

Your answer:
${own}

Your opponent's answer:
${opponent}

Write a short, specific critique of your opponent's answer: factual errors, missing parts, and any instructions it ignored (for example length or format limits). Be direct and stay under 120 words. Do not rewrite their answer.`;

const revisePrompt = (problem: string, own: string, critique: string) =>
    `Problem:
${problem}

Your original answer:
${own}

Your opponent's critique of your answer:
${critique}

Write your improved final answer. Fix the criticisms that are valid and ignore the ones that are not. Output only the final answer.`;

const JUDGE_SYSTEM = `You are an impartial judge comparing two answers to the same problem.
Score each answer from 0 to 10 on four criteria:
- accuracy: is it correct, and does it follow the problem's instructions (including any length or format limits)?
- clarity: is it easy to understand and well organized?
- creativity: is it original or insightful where the problem allows for that? For purely factual or technical problems, score on how well it explains rather than on novelty.
- conciseness: does it say what is needed without padding?
The order of the answers must not affect your scores. Refer to them only as "Answer A" and "Answer B".
Also give a confidence from 0 to 100: how sure you are about which answer is better overall. Use a low value when the answers are close in quality. Confidence is not a quality score.`;

const round1 = (n: number) => Math.round(n * 10) / 10;
const overall = (c: Criteria) => round1((c.accuracy + c.clarity + c.creativity + c.conciseness) / 4);

const winnerOf = (judge: JudgeResult): Winner =>
    judge.skipped
        ? "none"
        : judge.solution_1_score > judge.solution_2_score
            ? "solution_1"
            : judge.solution_2_score > judge.solution_1_score
                ? "solution_2"
                : "tie";

function buildGraph(registry: ModelRegistry) {

    // Round 1: both models answer the problem in parallel, streaming tokens as they go.
    // One failing model does not take the whole battle down.
    const solutionNode: GraphNode<typeof state> = async (state, config) => {
        stageEvent(config, "answer", "start");
        const first = modelFor(registry, state.model_1);
        const second = modelFor(registry, state.model_2);

        const [one, two] = await Promise.all([
            settle(first, state.problem, "solution_1", "answer", config),
            settle(second, state.problem, "solution_2", "answer", config),
        ]);

        if (one.error && two.error) {
            throw new Error("Both models failed to respond.");
        }

        stageEvent(config, "answer", "end");
        return {
            solution_1: one.call?.text ?? "",
            solution_2: two.call?.text ?? "",
            solution_1_error: one.error ?? "",
            solution_2_error: two.error ?? "",
            metrics: {
                ...state.metrics,
                solution_1: one.call ? addCall(state.metrics.solution_1, one.call) : state.metrics.solution_1,
                solution_2: two.call ? addCall(state.metrics.solution_2, two.call) : state.metrics.solution_2,
            },
        }
    }

    // Round 2, step 1: each model critiques the other's answer
    const critiqueNode: GraphNode<typeof state> = async (state, config) => {
        stageEvent(config, "critique", "start");
        const first = modelFor(registry, state.model_1);
        const second = modelFor(registry, state.model_2);

        const [one, two] = await Promise.all([
            settle(first, critiquePrompt(state.problem, state.solution_1, state.solution_2), "solution_1", "critique", config),
            settle(second, critiquePrompt(state.problem, state.solution_2, state.solution_1), "solution_2", "critique", config),
        ]);

        stageEvent(config, "critique", "end");
        return {
            critique_1: one.call?.text ?? "",
            critique_2: two.call?.text ?? "",
            warnings: [...state.warnings, ...[one.error, two.error].filter((m): m is string => Boolean(m))],
            metrics: {
                ...state.metrics,
                solution_1: one.call ? addCall(state.metrics.solution_1, one.call) : state.metrics.solution_1,
                solution_2: two.call ? addCall(state.metrics.solution_2, two.call) : state.metrics.solution_2,
            },
        }
    }

    // Round 2, step 2: each model rewrites its answer using the critique it received.
    // No critique (or a failed call) means the original answer stands.
    const reviseNode: GraphNode<typeof state> = async (state, config) => {
        stageEvent(config, "revision", "start");
        const first = modelFor(registry, state.model_1);
        const second = modelFor(registry, state.model_2);

        const [one, two] = await Promise.all([
            state.critique_2
                ? settle(first, revisePrompt(state.problem, state.solution_1, state.critique_2), "solution_1", "revision", config)
                : Promise.resolve<{ call?: Call; error?: string }>({}),
            state.critique_1
                ? settle(second, revisePrompt(state.problem, state.solution_2, state.critique_1), "solution_2", "revision", config)
                : Promise.resolve<{ call?: Call; error?: string }>({}),
        ]);

        stageEvent(config, "revision", "end");
        return {
            revised_1: one.call?.text ?? "",
            revised_2: two.call?.text ?? "",
            warnings: [...state.warnings, ...[one.error, two.error].filter((m): m is string => Boolean(m))],
            metrics: {
                ...state.metrics,
                solution_1: one.call ? addCall(state.metrics.solution_1, one.call) : state.metrics.solution_1,
                solution_2: two.call ? addCall(state.metrics.solution_2, two.call) : state.metrics.solution_2,
            },
        }
    }

    // The judge scores each answer on four criteria and reports its own confidence
    const judgeNode: GraphNode<typeof state> = async (state, config) => {
        // With only one answer there is nothing to compare, so do not invent scores.
        if (state.solution_1_error || state.solution_2_error) {
            return { judge: skippedJudge(state.solution_1_error || state.solution_2_error) }
        }

        stageEvent(config, "judge", "start");
        const judgeInfo = modelFor(registry, state.judge_model);
        const label1 = modelFor(registry, state.model_1).label;
        const label2 = modelFor(registry, state.model_2).label;

        // Judge the final answers: the revised one when there was a second round
        const final1 = state.revised_1 || state.solution_1;
        const final2 = state.revised_2 || state.solution_2;

        // LLM judges tend to favor whichever answer they read first, so randomize the order.
        const swap = Math.random() < 0.5;
        const [answerA, answerB] = swap ? [final2, final1] : [final1, final2];
        const [critiqueOfA, critiqueOfB] = swap
            ? [state.critique_1, state.critique_2]
            : [state.critique_2, state.critique_1];
        const nameA = swap ? label2 : label1;
        const nameB = swap ? label1 : label2;

        const critiques = state.critique_1 && state.critique_2
            ? `\n\nThe opponent's critique of Answer A: ${critiqueOfA}\nThe opponent's critique of Answer B: ${critiqueOfB}\n(Critiques are context only. Judge the answers themselves.)`
            : "";
        const user = `Problem: ${state.problem}\n\nAnswer A: ${answerA}\n\nAnswer B: ${answerB}${critiques}\n\nPlease evaluate the answers.`;

        const started = Date.now();
        try {
            const { verdict, usage: reported } = await judgeInfo.model.judge(JUDGE_SYSTEM, user, config.signal);
            const latencyMs = Date.now() - started;
            const usage = resolveUsage(reported, JUDGE_SYSTEM + user, JSON.stringify(verdict));
            const costUsd = costOf(usage, judgeInfo.pricing);
            emit(config, {
                type: "model_done", side: "judge", stage: "judge", latencyMs,
                inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd, estimated: usage.estimated,
            });
            stageEvent(config, "judge", "end");

            // The reasoning text mentions "Answer A/B"; rewrite it to the real model names.
            const relabel = (text: string) =>
                text.replace(/\banswer\s+([ab])\b/gi, (_match, letter: string) =>
                    letter.toLowerCase() === "a" ? nameA : nameB);

            // Map everything back to the original solution order.
            const first = swap
                ? { criteria: verdict.answer_b, reasoning: verdict.answer_b_reasoning }
                : { criteria: verdict.answer_a, reasoning: verdict.answer_a_reasoning };
            const second = swap
                ? { criteria: verdict.answer_a, reasoning: verdict.answer_a_reasoning }
                : { criteria: verdict.answer_b, reasoning: verdict.answer_b_reasoning };

            return {
                judge: {
                    solution_1_score: overall(first.criteria),
                    solution_2_score: overall(second.criteria),
                    solution_1_criteria: first.criteria,
                    solution_2_criteria: second.criteria,
                    solution_1_reasoning: relabel(first.reasoning),
                    solution_2_reasoning: relabel(second.reasoning),
                    confidence: Math.round(verdict.confidence),
                    skipped: false,
                    position_swapped: swap,
                },
                metrics: {
                    ...state.metrics,
                    judge: addCall(state.metrics.judge, { latencyMs, usage, costUsd }),
                },
            }
        } catch (error) {
            if (config.signal?.aborted) throw error;
            console.error(`Judge (${judgeInfo.label}) failed:`, error);
            const message = `The judge (${judgeInfo.label}) failed to produce a verdict.`;
            emit(config, { type: "model_error", side: "judge", stage: "judge", message });
            stageEvent(config, "judge", "end");
            return {
                judge: skippedJudge(message),
                warnings: [...state.warnings, message],
            }
        }
    }

    return new StateGraph(state)
        .addNode("solution", solutionNode)
        .addNode("critique", critiqueNode)
        .addNode("revise", reviseNode)
        .addNode("judge_node", judgeNode)
        .addEdge(START, "solution")
        // Round 2 only runs when asked for and when both models produced an answer
        .addConditionalEdges(
            "solution",
            (s: GraphState) =>
                s.rounds > 1 && !s.solution_1_error && !s.solution_2_error ? "critique" : "judge_node",
            ["critique", "judge_node"],
        )
        .addEdge("critique", "revise")
        .addEdge("revise", "judge_node")
        .addEdge("judge_node", END)
        .compile()
}

export interface RunOptions {
    problem: string;
    config: BattleConfig;
    registry?: ModelRegistry;
    signal?: AbortSignal;
    onEvent?: (event: BattleEvent) => void;
}

export async function runBattle(options: RunOptions): Promise<BattleResult> {
    const { problem, config, signal, onEvent } = options;
    const registry = options.registry ?? getRealRegistry();
    const graph = buildGraph(registry);
    const started = Date.now();

    const labels = {
        solution_1: modelFor(registry, config.models[0]).label,
        solution_2: modelFor(registry, config.models[1]).label,
        judge: modelFor(registry, config.judge).label,
    };
    onEvent?.({ type: "start", config, labels });

    // "custom" carries the token/stage events written by the nodes; "values" carries the full state after each step
    const stream = await graph.stream(
        {
            problem,
            model_1: config.models[0],
            model_2: config.models[1],
            judge_model: config.judge,
            rounds: config.rounds,
        },
        { streamMode: ["custom", "values"], ...(signal ? { signal } : {}) },
    );

    let final: GraphState | undefined;
    for await (const chunk of stream) {
        const [mode, payload] = chunk as unknown as [string, unknown];
        if (mode === "custom") onEvent?.(payload as BattleEvent);
        else if (mode === "values") final = payload as GraphState;
    }

    if (!final) throw new Error("The battle produced no result.");

    const metrics: { solution_1: Metrics; solution_2: Metrics; judge: Metrics } = final.metrics;

    return {
        config,
        labels,
        problem,
        solution_1: final.solution_1,
        solution_2: final.solution_2,
        solution_1_error: final.solution_1_error,
        solution_2_error: final.solution_2_error,
        critique_1: final.critique_1,
        critique_2: final.critique_2,
        revised_1: final.revised_1,
        revised_2: final.revised_2,
        judge: final.judge,
        metrics,
        warnings: final.warnings,
        winner: winnerOf(final.judge),
        durationMs: Date.now() - started,
        totalCostUsd: metrics.solution_1.costUsd + metrics.solution_2.costUsd + metrics.judge.costUsd,
    };
}
