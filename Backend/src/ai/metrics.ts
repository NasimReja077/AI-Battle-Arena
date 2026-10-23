import type { Metrics, Pricing, Usage } from "./types.js";

// Rough fallback when a provider does not report token usage: about 4 characters per token.
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

export const costOf = (usage: Usage, pricing: Pricing): number =>
    (usage.inputTokens * pricing.inputPerM + usage.outputTokens * pricing.outputPerM) / 1_000_000;

export const emptyMetrics = (): Metrics => ({
    latencyMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    estimated: false,
});

// Add one model call to a running total (a model can be called several times in a battle)
export const addCall = (
    total: Metrics,
    call: { latencyMs: number; usage: Usage; costUsd: number },
): Metrics => ({
    latencyMs: total.latencyMs + call.latencyMs,
    inputTokens: total.inputTokens + call.usage.inputTokens,
    outputTokens: total.outputTokens + call.usage.outputTokens,
    costUsd: total.costUsd + call.costUsd,
    estimated: total.estimated || call.usage.estimated,
});

// Use the provider's reported usage when there is any, otherwise estimate from the text
export const resolveUsage = (
    reported: { input: number; output: number } | undefined,
    promptText: string,
    outputText: string,
): Usage =>
    reported && (reported.input > 0 || reported.output > 0)
        ? { inputTokens: reported.input, outputTokens: reported.output, estimated: false }
        : { inputTokens: estimateTokens(promptText), outputTokens: estimateTokens(outputText), estimated: true };
