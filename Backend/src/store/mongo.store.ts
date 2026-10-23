import mongoose, { Schema } from "mongoose";
import type { BattleResult } from "../ai/types.js";
import type { BattleStore, BattleSummary, ListOptions, NewBattle, StoredBattle } from "./types.js";

interface BattleDoc {
    _id: mongoose.Types.ObjectId;
    problem: string;
    attachmentName: string | null;
    shareId?: string | null;
    createdAt: Date;
    // The full battle result. Stored as one object because it is always read and written as a whole.
    data: BattleResult;
}

const battleSchema = new Schema<BattleDoc>(
    {
        problem: { type: String, required: true },
        attachmentName: { type: String, default: null },
        shareId: { type: String },
        data: { type: Schema.Types.Mixed, required: true },
    },
    { timestamps: { createdAt: true, updatedAt: false } },
);

// Only documents that have a share id take part in the unique index
battleSchema.index({ shareId: 1 }, { unique: true, partialFilterExpression: { shareId: { $type: "string" } } });

const Battle = (mongoose.models.Battle as mongoose.Model<BattleDoc> | undefined)
    ?? mongoose.model<BattleDoc>("Battle", battleSchema);

const OBJECT_ID = /^[a-f0-9]{24}$/i;

const toStored = (doc: BattleDoc): StoredBattle => ({
    ...doc.data,
    attachmentName: doc.attachmentName ?? null,
    id: String(doc._id),
    createdAt: doc.createdAt.toISOString(),
    shareId: doc.shareId ?? null,
});

export class MongoStore implements BattleStore {
    isReady() {
        return mongoose.connection.readyState === 1;
    }

    async save(battle: NewBattle) {
        const { attachmentName, ...data } = battle;
        const doc = await Battle.create({ problem: battle.problem, attachmentName, data });
        return toStored(doc.toObject());
    }

    async list({ limit, before }: ListOptions): Promise<BattleSummary[]> {
        const filter = before && OBJECT_ID.test(before) ? { _id: { $lt: before } } : {};
        const docs = await Battle.find(filter).sort({ _id: -1 }).limit(limit).lean();
        return docs.map((doc) => {
            const battle = toStored(doc);
            return {
                id: battle.id,
                createdAt: battle.createdAt,
                problem: battle.problem.length > 200 ? `${battle.problem.slice(0, 200)}…` : battle.problem,
                models: battle.config.models,
                labels: battle.labels,
                winner: battle.winner,
                rounds: battle.config.rounds,
                shared: battle.shareId !== null,
            };
        });
    }

    async get(id: string) {
        if (!OBJECT_ID.test(id)) return null;
        const doc = await Battle.findById(id).lean();
        return doc ? toStored(doc) : null;
    }

    async getByShareId(shareId: string) {
        const doc = await Battle.findOne({ shareId }).lean();
        return doc ? toStored(doc) : null;
    }

    async setShareId(id: string, shareId: string | null) {
        if (!OBJECT_ID.test(id)) return null;
        const update = shareId ? { $set: { shareId } } : { $unset: { shareId: 1 } };
        const doc = await Battle.findByIdAndUpdate(id, update, { returnDocument: "after" }).lean();
        return doc ? toStored(doc) : null;
    }

    async remove(id: string) {
        if (!OBJECT_ID.test(id)) return false;
        const result = await Battle.deleteOne({ _id: id });
        return result.deletedCount > 0;
    }
}

// Connect without ever crashing the server: if MongoDB is down, battles still work and history is switched off.
// Keeps retrying in the background so starting MongoDB later is enough.
export function connectMongo(uri: string, retryMs = 15000) {
    const attempt = async () => {
        try {
            await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
            console.log("MongoDB connected: history is on");
        } catch (error) {
            console.warn(
                `MongoDB is not reachable (${error instanceof Error ? error.message : "unknown error"}). ` +
                `History is off, retrying in ${retryMs / 1000}s.`,
            );
            setTimeout(attempt, retryMs).unref();
        }
    };
    void attempt();
}
