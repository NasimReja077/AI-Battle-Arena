import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApp } from "../src/app.js";
import { MemoryStore } from "../src/store/memory.store.js";
import type { BattleModel, JudgeVerdict, ModelRegistry } from "../src/ai/model.ai.js";
import type { BattleEvent, BattleResult } from "../src/ai/types.js";

const criteria = (n: number) => ({ accuracy: n, clarity: n, creativity: n, conciseness: n });

interface FakeOptions {
    reply?: string;
    failStream?: boolean;
    emptyStream?: boolean;
    usage?: boolean;
    verdict?: Partial<JudgeVerdict>;
    failJudge?: boolean;
    seen?: { prompts: string[]; judgeUsers: string[] };
}

// A model that streams a fixed reply in word-sized chunks. No network, no API keys.
function fake(options: FakeOptions = {}): BattleModel {
    return {
        async *stream(prompt) {
            options.seen?.prompts.push(prompt);
            if (options.failStream) throw new Error("provider exploded: secret-key-123");
            if (options.emptyStream) return;
            const words = (options.reply ?? "hello world from the model").split(" ");
            for (let i = 0; i < words.length; i++) {
                const last = i === words.length - 1;
                yield {
                    text: words[i] + (last ? "" : " "),
                    ...(options.usage && last ? { usage: { input: 100, output: 50 } } : {}),
                };
            }
        },
        async judge(_system, user) {
            options.seen?.judgeUsers.push(user);
            if (options.failJudge) throw new Error("judge exploded");
            // Answer A is always better by default, whatever model is behind it
            return {
                verdict: {
                    answer_a: criteria(8),
                    answer_b: criteria(4),
                    answer_a_reasoning: "Answer A is clearer.",
                    answer_b_reasoning: "Answer B is vague.",
                    confidence: 77,
                    ...options.verdict,
                },
            };
        },
    };
}

const pricing = { inputPerM: 1_000_000, outputPerM: 2_000_000 }; // $1 per input token, $2 per output token: easy maths

function registry(models: Partial<Record<"groq" | "cohere" | "gemini", BattleModel>> = {}): ModelRegistry {
    const make = (id: "groq" | "cohere" | "gemini", label: string, model?: BattleModel) =>
        ({ id, label, provider: "test", model: model ?? fake({ reply: `${label} says hi` }), pricing });
    return {
        groq: make("groq", "Groq", models.groq),
        cohere: make("cohere", "Cohere", models.cohere),
        gemini: make("gemini", "Gemini", models.gemini),
    };
}

async function start(reg: ModelRegistry, store = new MemoryStore(true)) {
    const app = createApp({ store, registry: reg });
    const server: Server = await new Promise((resolve) => {
        const s = app.listen(0, () => resolve(s));
    });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return { base, store, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

const post = (base: string, path: string, body: unknown) =>
    fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

async function readSse(res: Response): Promise<(BattleEvent | { type: "result"; id: string | null; saved: boolean; result: BattleResult } | { type: "error"; message: string })[]> {
    const text = await res.text();
    return text
        .split("\n\n")
        .filter((chunk) => chunk.startsWith("data: "))
        .map((chunk) => JSON.parse(chunk.slice(6)));
}

test("streaming: tokens arrive before the result, in order, with stages", async () => {
    const app = await start(registry());
    try {
        const res = await post(app.base, "/battle/stream", { input: "hi" });
        assert.equal(res.status, 200);
        assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);
        const events = await readSse(res);

        assert.equal(events[0]?.type, "start");
        assert.equal(events.at(-1)?.type, "result");

        const tokens1 = events.filter((e) => e.type === "token" && e.side === "solution_1");
        assert.ok(tokens1.length > 1, "answer should arrive in several chunks");
        const joined = tokens1.map((e) => (e.type === "token" ? e.text : "")).join("");
        assert.equal(joined, "Groq says hi");

        const firstToken = events.findIndex((e) => e.type === "token");
        const resultIndex = events.findIndex((e) => e.type === "result");
        assert.ok(firstToken > 0 && firstToken < resultIndex);

        const stages = events.filter((e) => e.type === "stage").map((e) => (e.type === "stage" ? `${e.stage}:${e.status}` : ""));
        assert.deepEqual(stages, ["answer:start", "answer:end", "judge:start", "judge:end"]);
    } finally {
        await app.close();
    }
});

test("model selector: chosen models and judge are used, bad choices are rejected", async () => {
    const app = await start(registry());
    try {
        const ok = await post(app.base, "/battle", { input: "hi", models: ["gemini", "cohere"], judge: "groq" });
        const body = await ok.json();
        assert.equal(body.result.labels.solution_1, "Gemini");
        assert.equal(body.result.labels.solution_2, "Cohere");
        assert.equal(body.result.labels.judge, "Groq");
        assert.equal(body.result.solution_1, "Gemini says hi");

        const same = await post(app.base, "/battle", { input: "hi", models: ["cohere", "cohere"] });
        assert.equal(same.status, 400);
        const unknown = await post(app.base, "/battle", { input: "hi", models: ["cohere", "gpt-9"] });
        assert.equal(unknown.status, 400);
        const badRounds = await post(app.base, "/battle", { input: "hi", rounds: 3 });
        assert.equal(badRounds.status, 400);
        const empty = await post(app.base, "/battle", { input: "   " });
        assert.equal(empty.status, 400);
    } finally {
        await app.close();
    }
});

test("per-criteria judging: criteria are mapped back correctly whichever order the judge saw", async () => {
    // Answer A always wins in the fake judge, so the winner must be whichever side was shown as A.
    // Run several times so both orders happen, and check the judge's view matches the mapping each time.
    const seen = { prompts: [] as string[], judgeUsers: [] as string[] };
    const app = await start(registry({ gemini: fake({ seen }) }));
    try {
        let swappedCount = 0;
        for (let i = 0; i < 24; i++) {
            const res = await post(app.base, "/battle", { input: "q", models: ["groq", "cohere"], judge: "gemini" });
            const { result } = (await res.json()) as { result: BattleResult };
            const user = seen.judgeUsers.at(-1) ?? "";
            const shownAFirst = user.indexOf("Groq says hi") < user.indexOf("Cohere says hi");
            assert.equal(result.judge.position_swapped, !shownAFirst);
            if (result.judge.position_swapped) swappedCount++;

            const expectedWinner = shownAFirst ? "solution_1" : "solution_2";
            assert.equal(result.winner, expectedWinner);
            const winnerCriteria = result.judge[`${expectedWinner}_criteria`];
            assert.deepEqual(winnerCriteria, criteria(8));
            assert.equal(result.judge[`${expectedWinner}_score`], 8);
            assert.equal(result.judge.confidence, 77);

            // "Answer A" in the reasoning is rewritten to the real model name
            const winnerName = shownAFirst ? "Groq" : "Cohere";
            assert.equal(result.judge[`${expectedWinner}_reasoning`], `${winnerName} is clearer.`);
            // The judge never sees model names
            assert.ok(!user.includes("Groq:") && !/model\s+(alpha|beta)/i.test(user));
        }
        assert.ok(swappedCount > 0 && swappedCount < 24, `order should be random (swapped ${swappedCount}/24)`);
    } finally {
        await app.close();
    }
});

test("metrics: reported usage is used for cost, missing usage is estimated and flagged", async () => {
    const app = await start(registry({
        groq: fake({ reply: "a b", usage: true }), // reports 100 in / 50 out
        cohere: fake({ reply: "twelve chars" }),        // reports nothing
    }));
    try {
        const res = await post(app.base, "/battle", { input: "hi", models: ["groq", "cohere"] });
        const { result } = (await res.json()) as { result: BattleResult };
        const m1 = result.metrics.solution_1;
        assert.equal(m1.inputTokens, 100);
        assert.equal(m1.outputTokens, 50);
        assert.equal(m1.estimated, false);
        assert.equal(m1.costUsd, 100 * 1 + 50 * 2);
        assert.ok(m1.latencyMs >= 0);

        const m2 = result.metrics.solution_2;
        assert.equal(m2.estimated, true);
        assert.equal(m2.outputTokens, Math.ceil("twelve chars".length / 4));
        assert.equal(m2.inputTokens, Math.ceil("hi".length / 4));

        const total = result.metrics.solution_1.costUsd + result.metrics.solution_2.costUsd + result.metrics.judge.costUsd;
        assert.equal(result.totalCostUsd, total);
        assert.ok(result.metrics.judge.costUsd > 0);
    } finally {
        await app.close();
    }
});

test("multi-round: critique and revision run, the judge sees the revised answers, costs add up", async () => {
    const seen = { prompts: [] as string[], judgeUsers: [] as string[] };
    const app = await start(registry({
        groq: fake({ reply: "alpha", usage: true, seen }),
        cohere: fake({ reply: "beta", usage: true }),
        gemini: fake({ seen }), // the default judge
    }));
    try {
        const res = await post(app.base, "/battle/stream", { input: "q", rounds: 2 });
        const events = await readSse(res);
        const stages = events.filter((e) => e.type === "stage").map((e) => (e.type === "stage" ? `${e.stage}:${e.status}` : ""));
        assert.deepEqual(stages, [
            "answer:start", "answer:end", "critique:start", "critique:end",
            "revision:start", "revision:end", "judge:start", "judge:end",
        ]);

        const final = events.at(-1);
        assert.equal(final?.type, "result");
        if (final?.type !== "result") return;
        const r = final.result;
        assert.equal(r.solution_1, "alpha");
        assert.equal(r.critique_1, "alpha"); // fake models always say the same thing
        assert.equal(r.revised_1, "alpha");

        // Each model was called 3 times (answer, critique, revision) at 100 in / 50 out
        assert.equal(r.metrics.solution_1.inputTokens, 300);
        assert.equal(r.metrics.solution_1.outputTokens, 150);

        // Critique prompt contains both answers; revision prompt contains the critique it received
        assert.ok(seen.prompts.some((p) => p.includes("Your opponent's answer") && p.includes("beta")));
        assert.ok(seen.prompts.some((p) => p.includes("Your opponent's critique of your answer")));
        assert.ok(seen.judgeUsers.at(-1)?.includes("critique"));

        // Round-2 tokens are tagged with their stage so the UI can route them
        const stagesWithTokens = new Set(events.filter((e) => e.type === "token").map((e) => (e.type === "token" ? e.stage : "")));
        assert.deepEqual([...stagesWithTokens].sort(), ["answer", "critique", "revision"]);
    } finally {
        await app.close();
    }
});

test("one round skips critique and revision", async () => {
    const app = await start(registry());
    try {
        const res = await post(app.base, "/battle", { input: "q", rounds: 1 });
        const { result } = (await res.json()) as { result: BattleResult };
        assert.equal(result.critique_1, "");
        assert.equal(result.revised_1, "");
    } finally {
        await app.close();
    }
});

test("partial failure: one model fails, the other answer survives, the judge is skipped, no raw error leaks", async () => {
    const app = await start(registry({ groq: fake({ failStream: true }) }));
    try {
        const res = await post(app.base, "/battle/stream", { input: "q", rounds: 2 });
        const events = await readSse(res);
        assert.ok(events.some((e) => e.type === "model_error" && e.side === "solution_1"));
        const final = events.at(-1);
        assert.equal(final?.type, "result");
        if (final?.type !== "result") return;
        assert.equal(final.result.solution_1, "");
        assert.equal(final.result.solution_2, "Cohere says hi");
        assert.equal(final.result.solution_1_error, "Groq failed to respond.");
        assert.equal(final.result.judge.skipped, true);
        assert.equal(final.result.winner, "none");
        // With only one answer there is no round 2
        assert.equal(final.result.critique_2, "");
        assert.ok(!JSON.stringify(events).includes("secret-key-123"));
    } finally {
        await app.close();
    }
});

test("both models failing returns an error event, not a result", async () => {
    const app = await start(registry({ groq: fake({ failStream: true }), cohere: fake({ emptyStream: true }) }));
    try {
        const events = await readSse(await post(app.base, "/battle/stream", { input: "q" }));
        assert.equal(events.at(-1)?.type, "error");
        assert.ok(!events.some((e) => e.type === "result"));

        const plain = await post(app.base, "/battle", { input: "q" });
        assert.equal(plain.status, 502);
    } finally {
        await app.close();
    }
});

test("judge failure keeps both answers and reports a warning", async () => {
    const app = await start(registry({ gemini: fake({ failJudge: true }) }));
    try {
        const res = await post(app.base, "/battle", { input: "q" });
        const body = await res.json();
        assert.equal(res.status, 200);
        assert.equal(body.result.solution_1, "Groq says hi");
        assert.equal(body.result.judge.skipped, true);
        assert.equal(body.result.winner, "none");
        assert.match(body.warnings[0], /judge/i);
    } finally {
        await app.close();
    }
});

test("history: battles are saved, listed newest first, loaded, deleted", async () => {
    const app = await start(registry());
    try {
        const a = await (await post(app.base, "/battle", { input: "first question" })).json();
        const b = await (await post(app.base, "/battle", { input: "second question", rounds: 2 })).json();
        assert.equal(a.saved, true);
        assert.ok(a.id && b.id && a.id !== b.id);

        const list = await (await fetch(`${app.base}/battles`)).json();
        assert.deepEqual(list.battles.map((x: { problem: string }) => x.problem), ["second question", "first question"]);
        assert.equal(list.battles[0].rounds, 2);

        const page = await (await fetch(`${app.base}/battles?limit=1&before=${b.id}`)).json();
        assert.deepEqual(page.battles.map((x: { problem: string }) => x.problem), ["first question"]);

        const one = await (await fetch(`${app.base}/battles/${a.id}`)).json();
        assert.equal(one.battle.problem, "first question");
        assert.equal(one.battle.solution_1, "Groq says hi");

        assert.equal((await fetch(`${app.base}/battles/${a.id}`, { method: "DELETE" })).status, 200);
        assert.equal((await fetch(`${app.base}/battles/${a.id}`)).status, 404);
        assert.equal((await fetch(`${app.base}/battles/${a.id}`, { method: "DELETE" })).status, 404);

        assert.equal((await fetch(`${app.base}/battles?limit=0`)).status, 400);
    } finally {
        await app.close();
    }
});

test("attachment: models get the file, history stores only the typed question", async () => {
    const seen = { prompts: [] as string[], judgeUsers: [] as string[] };
    const app = await start(registry({ groq: fake({ seen }) }));
    try {
        const body = await (await post(app.base, "/battle", {
            input: "summarise", attachment: { name: "notes.txt", content: "SECRET FILE TEXT" },
        })).json();
        assert.ok(seen.prompts[0]?.includes("SECRET FILE TEXT"));
        assert.equal(body.result.problem, "summarise");
        const stored = await (await fetch(`${app.base}/battles/${body.id}`)).json();
        assert.equal(stored.battle.problem, "summarise");
        assert.equal(stored.battle.attachmentName, "notes.txt");
        assert.ok(!JSON.stringify(stored).includes("SECRET FILE TEXT"));
    } finally {
        await app.close();
    }
});

test("without a database: battles still work, history routes say 503, saved is false", async () => {
    const app = await start(registry(), new MemoryStore(false));
    try {
        const body = await (await post(app.base, "/battle", { input: "q" })).json();
        assert.equal(body.success, true);
        assert.equal(body.saved, false);
        assert.equal(body.id, null);
        assert.equal((await fetch(`${app.base}/battles`)).status, 503);
        assert.equal((await fetch(`${app.base}/battles/abc/export.md`)).status, 503);
        const health = await (await fetch(`${app.base}/health`)).json();
        assert.deepEqual(health, { status: "ok", history: false });
    } finally {
        await app.close();
    }
});

test("share: link works without the db id, can be turned off; export is Markdown", async () => {
    const app = await start(registry());
    try {
        const created = await (await post(app.base, "/battle", { input: "share me", attachment: { name: "private.txt", content: "x" } })).json();

        // Not shared yet
        assert.equal((await fetch(`${app.base}/shared/nope-nope-nope`)).status, 404);

        const s1 = await (await fetch(`${app.base}/battles/${created.id}/share`, { method: "POST" })).json();
        const s2 = await (await fetch(`${app.base}/battles/${created.id}/share`, { method: "POST" })).json();
        assert.ok(/^[A-Za-z0-9_-]{8,64}$/.test(s1.shareId));
        assert.equal(s1.shareId, s2.shareId, "sharing twice keeps the same link");

        const shared = await (await fetch(`${app.base}/shared/${s1.shareId}`)).json();
        assert.equal(shared.battle.problem, "share me");
        assert.equal(shared.battle.id, undefined);
        assert.equal(shared.battle.attachmentName, undefined);
        assert.equal(shared.battle.shareId, undefined);

        const list = await (await fetch(`${app.base}/battles`)).json();
        assert.equal(list.battles[0].shared, true);

        assert.equal((await fetch(`${app.base}/shared/${"!".repeat(12)}`)).status, 404);

        assert.equal((await fetch(`${app.base}/battles/${created.id}/share`, { method: "DELETE" })).status, 200);
        assert.equal((await fetch(`${app.base}/shared/${s1.shareId}`)).status, 404);

        assert.equal((await fetch(`${app.base}/battles/missing/share`, { method: "POST" })).status, 404);

        const md = await fetch(`${app.base}/battles/${created.id}/export.md`);
        assert.equal(md.status, 200);
        assert.match(md.headers.get("content-type") ?? "", /text\/markdown/);
        assert.match(md.headers.get("content-disposition") ?? "", /attachment; filename="battle-/);
        const text = await md.text();
        for (const part of ["# AI Battle Arena result", "## Question", "share me", "## Judge verdict", "Speed, tokens and cost", "private.txt"]) {
            assert.ok(text.includes(part), `export should contain "${part}"`);
        }
        assert.equal((await fetch(`${app.base}/battles/missing/export.md`)).status, 404);
    } finally {
        await app.close();
    }
});

test("closing the connection aborts the battle so no more model calls are made", async () => {
    let started = 0;
    let aborted = 0;
    const slow: BattleModel = {
        async *stream(_prompt, signal) {
            started++;
            for (let i = 0; i < 100; i++) {
                if (signal?.aborted) { aborted++; return; }
                await new Promise((r) => setTimeout(r, 20));
                yield { text: "x " };
            }
        },
        async judge() { throw new Error("should not be reached"); },
    };
    const app = await start(registry({ groq: slow, cohere: slow }));
    try {
        const controller = new AbortController();
        const res = await fetch(`${app.base}/battle/stream`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ input: "q" }), signal: controller.signal,
        });
        const reader = res.body!.getReader();
        await reader.read();
        controller.abort();
        await new Promise((r) => setTimeout(r, 400));
        assert.equal(started, 2);
        assert.equal(aborted, 2);
    } finally {
        await app.close();
    }
});

test("models route and health", async () => {
    const app = await start(registry());
    try {
        const models = await (await fetch(`${app.base}/models`)).json();
        assert.deepEqual(models.models.map((m: { id: string }) => m.id), ["groq", "cohere", "gemini"]);
        assert.equal(models.defaults.rounds, 1);
        const health = await (await fetch(`${app.base}/health`)).json();
        assert.deepEqual(health, { status: "ok", history: true });
    } finally {
        await app.close();
    }
});
