import { Logger } from '../infrastructure/Logger';
import { getDefaultCardConfig, type CardConfig } from '../config/CardTemplates';

/**
 * Holds the editable card templates (welcome / rank / leaderboard) in memory.
 * WebServer persists them to `service_configs` under key `cards` and
 * re-loads on startup, so values survive restarts.
 */
export class CardService {
  private logger: Logger;
  public config: CardConfig = getDefaultCardConfig();

  constructor(logger: Logger) {
    this.logger = logger;
    this.config = getDefaultCardConfig();
  }

  public async initialize(): Promise<void> {
    this.logger.info('Card Service', 'Card template service initialized');
  }

  public getConfig(): CardConfig {
    return this.config;
  }

  public setConfig(next: Partial<CardConfig>): CardConfig {
    // Deep-merge top-level sections so partial saves don't wipe other cards.
    for (const key of ['welcome', 'rank', 'leaderboard'] as const) {
      if (next[key]) {
        const cur: any = (this.config as any)[key];
        const incoming: any = (next as any)[key];
        for (const k of Object.keys(incoming)) {
          if (!(k in cur)) continue;
          const prev = cur[k];
          const val = incoming[k];
          if (typeof prev === 'boolean') cur[k] = Boolean(val);
          else if (typeof prev === 'number') {
            const n = Number(val);
            if (Number.isFinite(n)) cur[k] = n;
          } else if (typeof prev === 'string') cur[k] = String(val ?? '');
          else cur[k] = val;
        }
      }
    }
    this.logger.info('Card Service', 'Card templates updated');
    return this.config;
  }

  public async shutdown(): Promise<void> {
    this.logger.info('Card Service', 'Card template service shutdown');
  }
}
