"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AutomationService = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../database/schema");
class AutomationService {
    constructor(logger) {
        this.db = null;
        this.config = { enabled: true };
        this.jobs = new Map();
        this.timer = null;
        this.logger = logger;
    }
    setDb(db) {
        this.db = db;
    }
    async initialize() {
        this.logger.info('Automation Service', 'Automation system initialized');
        this.startScheduler();
    }
    startScheduler() {
        this.timer = setInterval(async () => {
            await this.checkJobs();
        }, 60000); // Check every minute
    }
    async checkJobs() {
        if (!this.config.enabled)
            return;
        if (!this.db)
            return;
        const now = Date.now();
        const jobs = await this.db.select().from(schema_1.automationJobs).where((0, drizzle_orm_1.eq)(schema_1.automationJobs.enabled, true));
        for (const job of jobs) {
            if (job.next_run && now >= job.next_run.getTime()) {
                await this.runJob(job);
            }
        }
    }
    async runJob(job) {
        this.logger.info('Automation Service', `Running job: ${job.id} (${job.type})`);
        // Job execution logic would go here
        // For now, just update last_run and next_run
        if (this.db) {
            await this.db.update(schema_1.automationJobs)
                .set({ last_run: new Date() })
                .where((0, drizzle_orm_1.eq)(schema_1.automationJobs.id, job.id));
        }
    }
    async addJob(job) {
        this.jobs.set(job.id, job);
        if (this.db) {
            await this.db.insert(schema_1.automationJobs).values({
                id: job.id,
                guild_id: job.guildId,
                type: job.type,
                cron_expression: job.cronExpression,
                enabled: job.enabled,
                config: JSON.stringify(job.config),
                last_run: job.lastRun,
                next_run: job.nextRun,
            });
        }
    }
    async removeJob(jobId) {
        this.jobs.delete(jobId);
        if (this.db) {
            await this.db.delete(schema_1.automationJobs).where((0, drizzle_orm_1.eq)(schema_1.automationJobs.id, jobId));
        }
    }
    async shutdown() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.jobs.clear();
        this.logger.info('Automation Service', 'Automation system shutdown');
    }
}
exports.AutomationService = AutomationService;
