"use strict";
// Sukuna Bot - Logging Infrastructure
Object.defineProperty(exports, "__esModule", { value: true });
exports.Logger = void 0;
class Logger {
    constructor() {
        this.logs = [];
        this.maxLogs = 1000;
    }
    info(category, message, ...args) {
        const entry = {
            timestamp: new Date().toISOString(),
            category,
            level: 'info',
            message: message + (args.length ? ' ' + args.join(' ') : ''),
        };
        this.addLog(entry);
        console.log(`[${category}] ${message}`, ...args);
    }
    error(category, message, error) {
        const entry = {
            timestamp: new Date().toISOString(),
            category,
            level: 'error',
            message: message + (error ? ` - ${error.message}` : ''),
        };
        this.addLog(entry);
        console.error(`[${category}] ${message}`, error);
    }
    warn(category, message, ...args) {
        const entry = {
            timestamp: new Date().toISOString(),
            category,
            level: 'warn',
            message: message + (args.length ? ' ' + args.join(' ') : ''),
        };
        this.addLog(entry);
        console.warn(`[${category}] ${message}`, ...args);
    }
    getLogs(level, limit = 100) {
        let filtered = this.logs;
        if (level) {
            filtered = filtered.filter((l) => l.level === level);
        }
        return filtered.slice(-limit);
    }
    clearLogs() {
        this.logs = [];
    }
    addLog(entry) {
        this.logs.push(entry);
        if (this.logs.length > this.maxLogs) {
            this.logs = this.logs.slice(-this.maxLogs);
        }
    }
    async shutdown() {
        // No cleanup needed for console logging
    }
}
exports.Logger = Logger;
