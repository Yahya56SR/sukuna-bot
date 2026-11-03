import { interactionCreate } from './interactionCreate.js';
import { ready } from './ready.js';
import { messageCreate } from './messageCreate.js';

export const events = [ready, interactionCreate, messageCreate];
