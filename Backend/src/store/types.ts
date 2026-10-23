import type { BattleResult, ModelId, Winner } from "../ai/types.js";

export type NewBattle = BattleResult & { attachmentName: string | null };

export interface StoredBattle extends NewBattle {
    id: string;
    createdAt: string;
    shareId: string | null;
}

export interface BattleSummary {
    id: string;
    createdAt: string;
    problem: string;
    models: [ModelId, ModelId];
    labels: BattleResult["labels"];
    winner: Winner;
    rounds: 1 | 2;
    shared: boolean;
}

export interface ListOptions {
    limit: number;
    // Return battles older than this id (for "load more")
    before?: string;
}

export interface BattleStore {
    // False when there is no database connection. Battles still run, they just are not saved.
    isReady(): boolean;
    save(battle: NewBattle): Promise<StoredBattle>;
    list(options: ListOptions): Promise<BattleSummary[]>;
    get(id: string): Promise<StoredBattle | null>;
    getByShareId(shareId: string): Promise<StoredBattle | null>;
    // Pass a share id to publish the battle, or null to make it private again
    setShareId(id: string, shareId: string | null): Promise<StoredBattle | null>;
    remove(id: string): Promise<boolean>;
}

export const summarize = (battle: StoredBattle): BattleSummary => ({
    id: battle.id,
    createdAt: battle.createdAt,
    problem: battle.problem.length > 200 ? `${battle.problem.slice(0, 200)}…` : battle.problem,
    models: battle.config.models,
    labels: battle.labels,
    winner: battle.winner,
    rounds: battle.config.rounds,
    shared: battle.shareId !== null,
});
