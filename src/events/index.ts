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
import { voiceStateUpdateVerification } from './verificationVoiceEvents.js';
import { antinukeAuditLogEvent } from './antinukeEvents.js';
import { messageSystemsEvent } from './messageSystemsEvent.js';
import { systemsInteractionEvent } from './systemsInteractionEvent.js';

// New systems ported from astralcraft
import { presentationPresenceUpdate } from '../systems/presentations/autostatus.js';
import { threadCreateSuggestions, messageReactionAddSuggestions, interactionCreateSuggestions } from '../systems/suggestions/index.js';
// Voice-state is owned solely by events/voiceStateUpdate.ts (which has the
// self-heal + XP integration). systems/tempvc handles panel buttons/modals only —
// registering its voice handler too created a second channel per join.
import { interactionCreateTempvc } from '../systems/tempvc/index.js';
import { interactionCreateTickets } from '../systems/tickets/index.js';

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
	voiceStateUpdateVerification,
	channelDelete,
	guildDelete,
	antinukeAuditLogEvent,
	boosterMemberUpdateEvent,
	presentationPresenceUpdate,
	threadCreateSuggestions,
	messageReactionAddSuggestions,
	interactionCreateSuggestions,
	interactionCreateTempvc,
	interactionCreateTickets,
];
