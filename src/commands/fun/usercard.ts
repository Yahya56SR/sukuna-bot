// This file will be used by the usercard command, but we'll implement the rank card style
// Actually, let me put the usercard logic in a separate utility and reference it.

export interface UserCardData {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  level: number;
  totalXp: number;
  xpInLevel: number;
  xpForNext: number;
  roles: string[];
  joinedAt: string;
  createdAt: string;
}