import { interactionCreate } from './interactionCreate.js';
import { ready } from './ready.js';
import { messageCreate } from './messageCreate.js';
import { guildMemberAdd } from './guildMemberAdd.js';
import { voiceStateUpdate } from './voiceStateUpdate.js';
import { reactionAdd, reactionRemove, guildMemberAdd as memberAdd, guildMemberRemove } from './reactionEvents.js';

export const events = [
  ready,
  interactionCreate,
  messageCreate,
  guildMemberAdd,
  memberAdd,
  guildMemberRemove,
  reactionAdd,
  reactionRemove,
  voiceStateUpdate,
];