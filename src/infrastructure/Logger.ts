// Sukuna Bot - Logging Infrastructure

export interface LogEntry {
  timestamp: string;
  category: string;
  level: 'info' | 'error' | 'warn';
  message: string;
}

export interface LoggerConfig {
  level: string;
  destinations: any[];
}

export class Logger {
  private logs: LogEntry[] = [];
  private maxLogs: number = 1000;

  constructor() {}

  public info(category: string, message: string, ...args: any[]): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      category,
      level: 'info',
      message: message + (args.length ? ' ' + args.join(' ') : ''),
    };
    this.addLog(entry);
    console.log(`[${category}] ${message}`, ...args);
  }

  public error(category: string, message: string, error?: Error): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      category,
      level: 'error',
      message: message + (error ? ` - ${error.message}` : ''),
    };
    this.addLog(entry);
    console.error(`[${category}] ${message}`, error);
  }

  public warn(category: string, message: string, ...args: any[]): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      category,
      level: 'warn',
      message: message + (args.length ? ' ' + args.join(' ') : ''),
    };
    this.addLog(entry);
    console.warn(`[${category}] ${message}`, ...args);
  }

  public getLogs(level?: 'info' | 'error' | 'warn', limit: number = 100): LogEntry[] {
    let filtered = this.logs;
    if (level) {
      filtered = filtered.filter((l) => l.level === level);
    }
    return filtered.slice(-limit);
  }

  public clearLogs(): void {
    this.logs = [];
  }

  private addLog(entry: LogEntry): void {
    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }
  }

  public async shutdown(): Promise<void> {
    // No cleanup needed for console logging
  }
}
