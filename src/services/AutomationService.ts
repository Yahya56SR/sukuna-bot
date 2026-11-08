import { Logger } from '../infrastructure/Logger';
import { eq } from 'drizzle-orm';
import { automationJobs } from '../database/schema';
import type { DrizzleDb } from '../types/database';

export interface AutomationJob {
  id: string;
  guildId: string;
  type: string;
  cronExpression: string;
  enabled: boolean;
  config: any;
  lastRun: number | null;
  nextRun: number;
}

export class AutomationService {
  private logger: Logger;
  private db: DrizzleDb | null = null;
  private jobs: Map<string, any> = new Map();
  private timer: NodeJS.Timeout | null = null;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  public setDb(db: DrizzleDb): void {
    this.db = db;
  }

  public async initialize(): Promise<void> {
    this.logger.info('Automation Service', 'Automation system initialized');
    this.startScheduler();
  }

  private startScheduler(): void {
    this.timer = setInterval(async () => {
      await this.checkJobs();
    }, 60000); // Check every minute
  }

  private async checkJobs(): Promise<void> {
    if (!this.db) return;
    const now = Date.now();
    const jobs = await this.db.select().from(automationJobs).where(eq(automationJobs.enabled, true));
    for (const job of jobs) {
      if (job.next_run && now >= job.next_run.getTime()) {
        await this.runJob(job);
      }
    }
  }

  private async runJob(job: any): Promise<void> {
    this.logger.info('Automation Service', `Running job: ${job.id} (${job.type})`);
    // Job execution logic would go here
    // For now, just update last_run and next_run
    if (this.db) {
      await this.db.update(automationJobs)
        .set({ last_run: new Date() })
        .where(eq(automationJobs.id, job.id));
    }
  }

  public async addJob(job: AutomationJob): Promise<void> {
    this.jobs.set(job.id, job);
    if (this.db) {
      await this.db.insert(automationJobs).values({
        id: job.id,
        guild_id: job.guildId,
        type: job.type,
        cron_expression: job.cronExpression,
        enabled: job.enabled,
        config: JSON.stringify(job.config),
        last_run: job.lastRun,
        next_run: job.nextRun,
      } as any);
    }
  }

  public async removeJob(jobId: string): Promise<void> {
    this.jobs.delete(jobId);
    if (this.db) {
      await this.db.delete(automationJobs).where(eq(automationJobs.id, jobId));
    }
  }

  public async shutdown(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.jobs.clear();
    this.logger.info('Automation Service', 'Automation system shutdown');
  }
}
