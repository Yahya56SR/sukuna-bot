import mongoose from "mongoose";

let _conn: typeof mongoose | null = null;

export async function connectDatabase(uri: string): Promise<typeof mongoose> {
  if (_conn) return _conn;
  _conn = await mongoose.connect(uri);
  return _conn;
}

export async function disconnectDatabase(): Promise<void> {
  if (_conn) {
    await _conn.disconnect();
    _conn = null;
  }
}

export { mongoose };
export type Database = typeof mongoose;

// Guild & Config
export { readGuildConfig, getGuildId, updateGuildConfig } from './models/Guild.js';

// Tickets
export {
  TicketPanel,
  TicketDepartment,
  OpenTicket,
  TicketConfig,
  DEFAULT_DEPARTMENT,
  DEFAULT_PANEL_IMAGE,
  defaultTicketConfig,
  type ITicketPanel,
  type ITicketDepartment,
  type IOpenTicket,
  type ITicketConfig,
} from './models/Ticket.js';

// Users & Economy
export { getUser, updateUser } from './models/User.js';
export {
  xpForLevel,
  effectiveXp,
  getUserXp,
  addXp,
  setUserXp,
  getLeaderboard,
  countRanked,
  getRankPosition,
} from './utils.js';
export type { AddXpResult, UserXpRow, XpRow } from './utils.js';

// Moderation & Auto-Mod
export { AutoModRule, type IAutoModRule } from './models/AutoModRule.js';
export { Infraction, type IInfraction } from './models/Infraction.js';

// Reaction Roles
export { ReactionRolePanel, type IReactionRolePanel, type IReactionRoleOption } from './models/ReactionRolePanel.js';

// Custom Commands
export { CustomCommand, type ICustomCommand } from './models/CustomCommand.js';

// Logging
export { LogChannel, type ILogChannel, type LogEventType } from './models/LogChannel.js';

// Invites
export { InviteTracker, type IInviteTracker } from './models/InviteTracker.js';

// Starboard
export { StarboardConfig, StarboardEntry, type IStarboardConfig, type IStarboardEntry } from './models/Starboard.js';

// Suggestions
export { Suggestion, type ISuggestion } from './models/Suggestion.js';

// Reminders & AFK
export { Reminder, type IReminder } from './models/Reminder.js';
export { AFK, type IAFK } from './models/AFK.js';

// Social: Birthdays, Marriage, Pets
export { Birthday, type IBirthday } from './models/Birthday.js';
export { Marriage, type IMarriage } from './models/Marriage.js';
export { Pet, type IPet, type PetType } from './models/Pet.js';

// Games & Economy Extended
export { GameProfile, type IGameProfile } from './models/GameProfile.js';

// Welcome & Greetings
export { WelcomeConfig, type IWelcomeConfig } from './models/WelcomeConfig.js';

// Notifications & Feeds
export { NotificationFeed, type INotificationFeed, type FeedType } from './models/NotificationFeed.js';

// Visual: Themes & Color Roles
export { ThemeConfig, type IThemeConfig } from './models/ThemeConfig.js';
export { ColorRole, type IColorRole } from './models/ColorRole.js';

// Analytics
export { AnalyticsEvent, type IAnalyticsEvent, type AnalyticsEventType } from './models/AnalyticsEvent.js';