"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CardService = void 0;
const CardTemplates_1 = require("../config/CardTemplates");
/**
 * Holds the editable card templates (welcome / rank / leaderboard) in memory.
 * WebServer persists them to `service_configs` under key `cards` and
 * re-loads on startup, so values survive restarts.
 */
class CardService {
    constructor(logger) {
        this.config = (0, CardTemplates_1.getDefaultCardConfig)();
        this.logger = logger;
        this.config = (0, CardTemplates_1.getDefaultCardConfig)();
    }
    async initialize() {
        this.logger.info('Card Service', 'Card template service initialized');
    }
    getConfig() {
        return this.config;
    }
    setConfig(next) {
        // Deep-merge top-level sections so partial saves don't wipe other cards.
        for (const key of ['welcome', 'rank', 'leaderboard']) {
            if (next[key]) {
                const cur = this.config[key];
                const incoming = next[key];
                for (const k of Object.keys(incoming)) {
                    if (!(k in cur))
                        continue;
                    const prev = cur[k];
                    const val = incoming[k];
                    if (typeof prev === 'boolean')
                        cur[k] = Boolean(val);
                    else if (typeof prev === 'number') {
                        const n = Number(val);
                        if (Number.isFinite(n))
                            cur[k] = n;
                    }
                    else if (typeof prev === 'string')
                        cur[k] = String(val ?? '');
                    else
                        cur[k] = val;
                }
            }
        }
        this.logger.info('Card Service', 'Card templates updated');
        return this.config;
    }
    async shutdown() {
        this.logger.info('Card Service', 'Card template service shutdown');
    }
}
exports.CardService = CardService;
