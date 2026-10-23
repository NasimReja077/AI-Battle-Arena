// Types shared by the battle engine, the API routes and the stores.

export const MODEL_IDS = ["groq", "cohere", "gemini"] as const;
export type ModelId = (typeof MODEL_IDS)[number];

export type Side = "solution_1" | "solution_2";
export type Stage = "answer" | "critique" | "revision" | "judge";
export type StreamStage = Exclude<Stage, "judge">;

export interface Pricing {
    inputPerM: number;
    outputPerM: number;
}

export interface Usage {
    inputTokens: number;
    outputTokens: number;
    // True when the provider did not report usage and the counts are a rough estimate (about 4 characters per token)
    estimated: boolean;
}

export interface Metrics {
    latencyMs: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    estimated: boolean;
}

export interface Criteria {
    accuracy: number;
    clarity: number;
    creativity: number;
    conciseness: number;
}

export interface BattleConfig {
    models: [ModelId, ModelId];
    judge: ModelId;
    rounds: 1 | 2;
}

export type Winner = Side | "tie" | "none";

export interface JudgeResult {
    solution_1_score: number;
    solution_2_score: number;
    solution_1_criteria: Criteria;
    solution_2_criteria: Criteria;
    solution_1_reasoning: string;
    solution_2_reasoning: string;
    // 0-100: how sure the judge is about which answer is better (not how good the answers are)
    confidence: number;
    // True when the judge did not run or failed, so there are no scores
    skipped: boolean;
    // True when the answers were shown to the judge in swapped order
    position_swapped: boolean;
}

export interface BattleResult {
    config: BattleConfig;
    labels: { solution_1: string; solution_2: string; judge: string };
    problem: string;
    solution_1: string;
    solution_2: string;
    solution_1_error: string;
    solution_2_error: string;
    // Round 2 only. critique_1 is what model 1 wrote about model 2's answer, and the reverse for critique_2.
    critique_1: string;
    critique_2: string;
    revised_1: string;
    revised_2: string;
    judge: JudgeResult;
    metrics: { solution_1: Metrics; solution_2: Metrics; judge: Metrics };
    warnings: string[];
    winner: Winner;
    durationMs: number;
    totalCostUsd: number;
}

export type BattleEvent =
    | { type: "start"; config: BattleConfig; labels: BattleResult["labels"] }
    | { type: "stage"; stage: Stage; status: "start" | "end" }
    | { type: "token"; side: Side; stage: StreamStage; text: string }
    | {
        type: "model_done";
        side: Side | "judge";
        stage: Stage;
        latencyMs: number;
        inputTokens: number;
        outputTokens: number;
        costUsd: number;
        estimated: boolean;
    }
    | { type: "model_error"; side: Side | "judge"; stage: Stage; message: string };
