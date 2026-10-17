export interface LogEntry {
  at: number;
  level: string;
  message: string;
}

export class ActivityLog {
  private entriesList: LogEntry[] = [];

  constructor(private maxEntries = 500) {}

  log(level: string, message: string): void {
    this.entriesList.push({ at: Date.now(), level, message });
    if (this.entriesList.length > this.maxEntries) {
      this.entriesList.shift();
    }
  }

  entries(): readonly LogEntry[] {
    return this.entriesList;
  }
}
