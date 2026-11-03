import { interactionCreate } from './interactionCreate.js';
import { ready } from './ready.js';
import { messageCreate } from './messageCreate.js';
import { guildMemberAdd } from './guildMemberAdd.js';
import { voiceStateUpdate } from './voiceStateUpdate.js';

export const events = [
  ready,
  interactionCreate,
  messageCreate,
  guildMemberAdd,
  voiceStateUpdate,
];
