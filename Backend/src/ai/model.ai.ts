import { ChatGoogle } from "@langchain/google";
import { ChatGroq } from "@langchain/groq";
import { ChatCohere } from "@langchain/cohere";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import z from "zod";
import config from "../config/config.js";
import type { ModelId, Pricing } from "./types.js";

const score = z.number().min(0).max(10);
const criteria = z.object({
    accuracy: score,
    clarity: score,
    creativity: score,
    conciseness: score,
});

// What the judge must return. Answers are labelled A/B (not by model) and shown in random order.
export const judgeVerdictSchema = z.object({
    answer_a: criteria,
    answer_b: criteria,
    answer_a_reasoning: z.string(),
    answer_b_reasoning: z.string(),
    confidence: z.number().min(0).max(100),
});
export type JudgeVerdict = z.infer<typeof judgeVerdictSchema>;

export interface StreamChunk {
    text: string;
    usage?: { input: number; output: number };
}

// The small surface the battle engine needs from a model. Real models are wrapped by fromLangChain();
// tests pass plain objects, so nothing else in the engine depends on LangChain.
export interface BattleModel {
    stream(prompt: string, signal?: AbortSignal): AsyncIterable<StreamChunk>;
    judge(
        system: string,
        user: string,
        signal?: AbortSignal,
    ): Promise<{ verdict: JudgeVerdict; usage?: { input: number; output: number } }>;
}

export function fromLangChain(model: BaseChatModel): BattleModel {
    return {
        async *stream(prompt, signal) {
            const chunks = await model.stream(prompt, signal ? { signal } : {});
            for await (const chunk of chunks) {
                // The chunk type does not expose usage_metadata for every provider, but most send it
                const usage = (chunk as unknown as { usage_metadata?: { input_tokens: number; output_tokens: number } }).usage_metadata;
                yield {
                    text: chunk.text,
                    ...(usage ? { usage: { input: usage.input_tokens, output: usage.output_tokens } } : {}),
                };
            }
        },
        async judge(system, user, signal) {
            const structured = model.withStructuredOutput(judgeVerdictSchema, { includeRaw: true });
            const out = await structured.invoke(
                [new SystemMessage(system), new HumanMessage(user)],
                signal ? { signal } : {},
            );
            if (!out.parsed) {
                throw new Error("The judge did not return a structured verdict");
            }
            const raw = out.raw as { usage_metadata?: { input_tokens: number; output_tokens: number } };
            return {
                verdict: out.parsed,
                ...(raw.usage_metadata
                    ? { usage: { input: raw.usage_metadata.input_tokens, output: raw.usage_metadata.output_tokens } }
                    : {}),
            };
        },
    };
}

export interface ModelInfo {
    id: ModelId;
    label: string;
    provider: string;
    model: BattleModel;
    pricing: Pricing;
}

export type ModelRegistry = Record<ModelId, ModelInfo>;

// Static list for the model picker. Kept separate from the registry so listing models never builds a real client.
export const MODEL_OPTIONS: { id: ModelId; label: string; provider: string }[] = [
    { id: "groq", label: "GPT OSS 120B", provider: "Groq" },
    { id: "cohere", label: "Cohere Command A", provider: "Cohere" },
    { id: "gemini", label: "Gemini Flash", provider: "Google" },
];

// Create the real models lazily so importing this file never needs API keys
let cached: ModelRegistry | undefined;

export function getRealRegistry(): ModelRegistry {
    cached ??= {
        groq: {
            id: "groq",
            label: "GPT OSS 120B",
            provider: "Groq",
            model: fromLangChain(new ChatGroq({
                model: "openai/gpt-oss-120b",
                apiKey: config.GROQ_API_KEY,
            })),
            pricing: config.PRICING.groq,
        },
        cohere: {
            id: "cohere",
            label: "Cohere Command A",
            provider: "Cohere",
            model: fromLangChain(new ChatCohere({
                model: "command-a-03-2025",
                apiKey: config.COHERE_API_KEY,
            })),
            pricing: config.PRICING.cohere,
        },
        gemini: {
            id: "gemini",
            label: "Gemini Flash",
            provider: "Google",
            model: fromLangChain(new ChatGoogle({
                model: "gemini-flash-latest",
                apiKey: config.GOOGLE_API_KEY,
            })),
            pricing: config.PRICING.gemini,
        },
    };
    return cached;
}
