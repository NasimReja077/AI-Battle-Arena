import type { BattleStore, ListOptions, NewBattle, StoredBattle } from "./types.js";
import { summarize } from "./types.js";

// In-memory store used by the tests (and handy for trying the API without a database)
export class MemoryStore implements BattleStore {
    private battles: StoredBattle[] = [];
    private counter = 0;

    constructor(private ready = true) { }

    setReady(ready: boolean) {
        this.ready = ready;
    }

    isReady() {
        return this.ready;
    }

    async save(battle: NewBattle) {
        this.counter += 1;
        const stored: StoredBattle = {
            ...battle,
            id: String(this.counter).padStart(24, "0"),
            createdAt: new Date().toISOString(),
            shareId: null,
        };
        this.battles.push(stored);
        return stored;
    }

    async list({ limit, before }: ListOptions) {
        return this.battles
            .filter((b) => (before ? b.id < before : true))
            .sort((a, b) => (a.id < b.id ? 1 : -1))
            .slice(0, limit)
            .map(summarize);
    }

    async get(id: string) {
        return this.battles.find((b) => b.id === id) ?? null;
    }

    async getByShareId(shareId: string) {
        return this.battles.find((b) => b.shareId === shareId) ?? null;
    }

    async setShareId(id: string, shareId: string | null) {
        const battle = this.battles.find((b) => b.id === id);
        if (!battle) return null;
        battle.shareId = shareId;
        return battle;
    }

    async remove(id: string) {
        const before = this.battles.length;
        this.battles = this.battles.filter((b) => b.id !== id);
        return this.battles.length < before;
    }
}
