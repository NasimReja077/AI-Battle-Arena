import { randomBytes } from "node:crypto";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import cors from "cors";
import z from "zod";
import { runBattle } from "./ai/graph.ai.js";
import { MODEL_OPTIONS, type ModelRegistry } from "./ai/model.ai.js";
import { MODEL_IDS, type BattleConfig, type BattleEvent, type BattleResult } from "./ai/types.js";
import type { BattleStore } from "./store/types.js";
import { MemoryStore } from "./store/memory.store.js";
import { battleToMarkdown } from "./services/export.service.js";

export interface AppOptions {
    store?: BattleStore;
    // Tests pass fake models here. Production uses the real registry.
    registry?: ModelRegistry;
    corsOrigin?: string;
}

const modelId = z.enum(MODEL_IDS);

const battleSchema = z.object({
    input: z.string().trim().min(1, "Prompt cannot be empty").max(4000, "Prompt is too long (max 4000 characters)"),
    attachment: z.object({
        name: z.string().trim().min(1).max(200),
        content: z.string().max(100_000, "Attached file is too large (max 100,000 characters)"),
    }).optional(),
    models: z.tuple([modelId, modelId]).default(["groq", "cohere"]),
    judge: modelId.default("gemini"),
    rounds: z.union([z.literal(1), z.literal(2)]).default(1),
}).refine((value) => value.models[0] !== value.models[1], {
    message: "Pick two different models",
    path: ["models"],
});

const listSchema = z.object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    before: z.string().max(40).optional(),
});

const SHARE_ID = /^[A-Za-z0-9_-]{8,64}$/;

export function createApp(options: AppOptions = {}) {
    const app = express();
    const store = options.store ?? new MemoryStore(false);

    // Attached files are sent as text inside the JSON body, so allow a bit more than the default 100kb.
    app.use(express.json({ limit: "300kb" }));

    app.use(cors({
        origin: options.corsOrigin ?? "http://localhost:5173",
        methods: ["GET", "POST", "DELETE"],
        credentials: true,
    }));

    // Cheap liveness check. The frontend calls this on load instead of running the whole graph (and spending API credits).
    app.get("/health", (_req, res) => {
        res.status(200).json({ status: "ok", history: store.isReady() });
    });

    // Models the UI can offer in its pickers
    app.get("/models", (_req, res) => {
        res.json({
            models: MODEL_OPTIONS,
            defaults: { models: ["groq", "cohere"], judge: "gemini", rounds: 1 },
        });
    });

    const toConfig = (parsed: z.infer<typeof battleSchema>): BattleConfig => ({
        models: parsed.models,
        judge: parsed.judge,
        rounds: parsed.rounds,
    });

    const problemOf = (parsed: z.infer<typeof battleSchema>) =>
        parsed.attachment
            ? `${parsed.input}\n\nAttached file "${parsed.attachment.name}":\n${parsed.attachment.content}`
            : parsed.input;

    // Save a finished battle. Saving must never break the battle itself, so failures only become a flag.
    const persist = async (result: BattleResult, attachmentName: string | null) => {
        if (!store.isReady()) return { saved: false as const, id: null };
        try {
            const stored = await store.save({ ...result, attachmentName });
            return { saved: true as const, id: stored.id };
        } catch (error) {
            console.error("Saving the battle failed:", error);
            return { saved: false as const, id: null };
        }
    };

    // Plain request/response version (no streaming)
    app.post("/battle", async (req, res) => {
        const parsed = battleSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                message: "Invalid request",
                success: false,
                errors: parsed.error.issues.map((issue) => issue.message),
            });
        }

        try {
            // Show and store the question the user typed, not the question plus the whole attached file
            const result = {
                ...await runBattle({
                    problem: problemOf(parsed.data),
                    config: toConfig(parsed.data),
                    ...(options.registry ? { registry: options.registry } : {}),
                }),
                problem: parsed.data.input,
            };
            const saved = await persist(result, parsed.data.attachment?.name ?? null);
            res.status(200).json({
                message: "Battle completed",
                success: true,
                warnings: result.warnings,
                saved: saved.saved,
                id: saved.id,
                result,
            });
        } catch (error) {
            console.error("Battle failed:", error);
            res.status(502).json({
                message: "The battle could not be completed. Please try again.",
                success: false,
            });
        }
    });

    // Streaming version: Server-Sent Events. Each event is one line "data: {json}".
    app.post("/battle/stream", async (req, res) => {
        const parsed = battleSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                message: "Invalid request",
                success: false,
                errors: parsed.error.issues.map((issue) => issue.message),
            });
        }

        res.status(200).set({
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
        });
        res.flushHeaders();

        // Stop paying for model calls if the user closes the tab or presses Stop
        const controller = new AbortController();
        res.on("close", () => {
            if (!res.writableFinished) controller.abort();
        });

        const send = (event: BattleEvent | { type: "result"; id: string | null; saved: boolean; result: BattleResult } | { type: "error"; message: string }) => {
            if (!res.writableEnded && !res.destroyed) res.write(`data: ${JSON.stringify(event)}\n\n`);
        };

        try {
            const result = {
                ...await runBattle({
                    problem: problemOf(parsed.data),
                    config: toConfig(parsed.data),
                    signal: controller.signal,
                    onEvent: send,
                    ...(options.registry ? { registry: options.registry } : {}),
                }),
                problem: parsed.data.input,
            };
            const saved = await persist(result, parsed.data.attachment?.name ?? null);
            send({ type: "result", id: saved.id, saved: saved.saved, result });
        } catch (error) {
            if (!controller.signal.aborted) {
                console.error("Streaming battle failed:", error);
                send({ type: "error", message: "The battle could not be completed. Please try again." });
            }
        } finally {
            res.end();
        }
    });

    // ----- History -----

    const needHistory = (res: Response) => {
        if (store.isReady()) return true;
        res.status(503).json({ message: "History is not available because no database is connected.", success: false });
        return false;
    };

    app.get("/battles", async (req, res) => {
        if (!needHistory(res)) return;
        const parsed = listSchema.safeParse(req.query);
        if (!parsed.success) return res.status(400).json({ message: "Invalid query", success: false });
        try {
            const battles = await store.list({
                limit: parsed.data.limit,
                ...(parsed.data.before ? { before: parsed.data.before } : {}),
            });
            res.json({ success: true, battles });
        } catch (error) {
            console.error("Listing battles failed:", error);
            res.status(500).json({ message: "Could not load history.", success: false });
        }
    });

    app.get("/battles/:id", async (req, res) => {
        if (!needHistory(res)) return;
        try {
            const battle = await store.get(req.params.id);
            if (!battle) return res.status(404).json({ message: "Battle not found", success: false });
            res.json({ success: true, battle });
        } catch (error) {
            console.error("Loading a battle failed:", error);
            res.status(500).json({ message: "Could not load that battle.", success: false });
        }
    });

    app.delete("/battles/:id", async (req, res) => {
        if (!needHistory(res)) return;
        try {
            const removed = await store.remove(req.params.id);
            if (!removed) return res.status(404).json({ message: "Battle not found", success: false });
            res.json({ success: true });
        } catch (error) {
            console.error("Deleting a battle failed:", error);
            res.status(500).json({ message: "Could not delete that battle.", success: false });
        }
    });

    // ----- Share and export -----

    // Make a battle public. The link works for anyone who has it, until sharing is turned off.
    app.post("/battles/:id/share", async (req, res) => {
        if (!needHistory(res)) return;
        try {
            const existing = await store.get(req.params.id);
            if (!existing) return res.status(404).json({ message: "Battle not found", success: false });
            const shareId = existing.shareId ?? randomBytes(9).toString("base64url");
            const updated = existing.shareId ? existing : await store.setShareId(req.params.id, shareId);
            if (!updated) return res.status(404).json({ message: "Battle not found", success: false });
            res.json({ success: true, shareId });
        } catch (error) {
            console.error("Sharing a battle failed:", error);
            res.status(500).json({ message: "Could not create a share link.", success: false });
        }
    });

    app.delete("/battles/:id/share", async (req, res) => {
        if (!needHistory(res)) return;
        try {
            const updated = await store.setShareId(req.params.id, null);
            if (!updated) return res.status(404).json({ message: "Battle not found", success: false });
            res.json({ success: true });
        } catch (error) {
            console.error("Unsharing a battle failed:", error);
            res.status(500).json({ message: "Could not turn off sharing.", success: false });
        }
    });

    // Public read-only view of a shared battle. Returns only what the page needs: no database id, no attachment name.
    app.get("/shared/:shareId", async (req, res) => {
        if (!needHistory(res)) return;
        if (!SHARE_ID.test(req.params.shareId)) return res.status(404).json({ message: "Not found", success: false });
        try {
            const battle = await store.getByShareId(req.params.shareId);
            if (!battle) return res.status(404).json({ message: "This link is not available.", success: false });
            const { id: _id, attachmentName: _attachment, shareId: _share, ...publicBattle } = battle;
            res.json({ success: true, battle: publicBattle });
        } catch (error) {
            console.error("Loading a shared battle failed:", error);
            res.status(500).json({ message: "Could not load that battle.", success: false });
        }
    });

    app.get("/battles/:id/export.md", async (req, res) => {
        if (!needHistory(res)) return;
        try {
            const battle = await store.get(req.params.id);
            if (!battle) return res.status(404).json({ message: "Battle not found", success: false });
            res.set({
                "Content-Type": "text/markdown; charset=utf-8",
                "Content-Disposition": `attachment; filename="battle-${battle.id}.md"`,
            });
            res.send(battleToMarkdown(battle));
        } catch (error) {
            console.error("Exporting a battle failed:", error);
            res.status(500).json({ message: "Could not export that battle.", success: false });
        }
    });

    // Last-resort handler so malformed JSON or oversized bodies return JSON instead of an HTML error page
    app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
        const status = typeof err === "object" && err !== null && "status" in err && typeof err.status === "number"
            ? err.status
            : 500;
        res.status(status).json({
            message: status === 413 ? "Request body is too large" : status < 500 ? "Bad request" : "Internal server error",
            success: false,
        });
    });

    return app;
}
