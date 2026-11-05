import { interactionCreate } from './interactionCreate.js';
import { ready } from './ready.js';
import { messageCreate } from './messageCreate.js';
import { guildMemberAdd } from './guildMemberAdd.js';
import { voiceStateUpdate } from './voiceStateUpdate.js';
import { channelDelete } from './channelDelete.js';
import { guildDelete } from './guildDelete.js';
import { reactionAdd, reactionRemove, guildMemberAdd as memberAdd, guildMemberRemove } from './reactionEvents.js';
import { welcomeMemberAddEvent, welcomeMemberRemoveEvent } from './welcomeEvents.js';
import { boosterMemberUpdateEvent } from './boosterEvents.js';
import { verificationVoiceStateEvent } from './verificationVoiceEvents.js';
import { antinukeAuditLogEvent } from './antinukeEvents.js';
import { messageSystemsEvent } from './messageSystemsEvent.js';
import { systemsInteractionEvent } from './systemsInteractionEvent.js';

export const events = [
  ready,
  interactionCreate,
  systemsInteractionEvent,
  messageCreate,
  messageSystemsEvent,
  guildMemberAdd,
  welcomeMemberAddEvent,
  memberAdd,
  guildMemberRemove,
  welcomeMemberRemoveEvent,
  reactionAdd,
  reactionRemove,
  voiceStateUpdate,
  verificationVoiceStateEvent,
  channelDelete,
  guildDelete,
  antinukeAuditLogEvent,
  boosterMemberUpdateEvent,
];