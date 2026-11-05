import { model, Schema, Document } from "mongoose";

export interface IAnalyticsEvent extends Document {
  /** Event type */
  type: AnalyticsEventType;
  /** Guild ID (optional for global events) */
  guildId?: string;
  /** User ID (optional) */
  userId?: string;
  /** Event name */
  name: string;
  /** Event properties */
  properties: Record<string, unknown>;
  /** Timestamp */
  timestamp: Date;
  /** Session ID for grouping */
  sessionId?: string;
}

export type AnalyticsEventType =
  | 'command_used'
  | 'command_error'
  | 'message_received'
  | 'message_sent'
  | 'voice_join'
  | 'voice_leave'
  | 'voice_speak'
  | 'xp_gained'
  | 'level_up'
  | 'economy_transaction'
  | 'moderation_action'
  | 'automod_trigger'
  | 'reaction_role_add'
  | 'reaction_role_remove'
  | 'suggestion_created'
  | 'suggestion_voted'
  | 'ticket_created'
  | 'ticket_closed'
  | 'music_play'
  | 'music_skip'
  | 'invite_join'
  | 'invite_leave'
  | 'starboard_star'
  | 'reminder_triggered'
  | 'afk_set'
  | 'afk_removed'
  | 'birthday_announced'
  | 'marriage_propose'
  | 'marriage_accept'
  | 'marriage_divorce'
  | 'pet_adopt'
  | 'pet_feed'
  | 'pet_battle'
  | 'casino_play'
  | 'welcome_sent'
  | 'leave_sent'
  | 'notification_posted'
  | 'theme_changed'
  | 'color_role_picked'
  | 'dashboard_view'
  | 'dashboard_action'
  | 'bot_startup'
  | 'bot_shutdown'
  | 'error';

const analyticsEventSchema = new Schema<IAnalyticsEvent>(
  {
    type: {
      type: String,
      enum: [
        'command_used', 'command_error',
        'message_received', 'message_sent',
        'voice_join', 'voice_leave', 'voice_speak',
        'xp_gained', 'level_up',
        'economy_transaction',
        'moderation_action', 'automod_trigger',
        'reaction_role_add', 'reaction_role_remove',
        'suggestion_created', 'suggestion_voted',
        'ticket_created', 'ticket_closed',
        'music_play', 'music_skip',
        'invite_join', 'invite_leave',
        'starboard_star',
        'reminder_triggered',
        'afk_set', 'afk_removed',
        'birthday_announced',
        'marriage_propose', 'marriage_accept', 'marriage_divorce',
        'pet_adopt', 'pet_feed', 'pet_battle',
        'casino_play',
        'welcome_sent', 'leave_sent',
        'notification_posted',
        'theme_changed',
        'color_role_picked',
        'dashboard_view', 'dashboard_action',
        'bot_startup', 'bot_shutdown',
        'error',
      ],
      required: true,
      index: true,
    },
    guildId: { type: String, index: true },
    userId: { type: String, index: true },
    name: { type: String, required: true },
    properties: { type: Schema.Types.Mixed, default: {} },
    timestamp: { type: Date, default: Date.now, index: true },
    sessionId: { type: String },
  },
  { timestamps: false }, // We use custom timestamp
);

analyticsEventSchema.index({ type: 1, timestamp: -1 });
analyticsEventSchema.index({ guildId: 1, timestamp: -1 });
analyticsEventSchema.index({ userId: 1, timestamp: -1 });
analyticsEventSchema.index({ sessionId: 1 });

// TTL index - expire after 90 days
analyticsEventSchema.index({ timestamp: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export const AnalyticsEvent = model<IAnalyticsEvent>("AnalyticsEvent", analyticsEventSchema);