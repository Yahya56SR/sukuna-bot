import { Events } from 'discord.js';
import { autoReply } from '../systems/autoreply/index.js';
import { mediaReactions } from '../systems/mediareactions/index.js';

export const messageSystemsEvent = {
	name: Events.MessageCreate as keyof import('discord.js').ClientEvents,
	execute: async (client: any, message: any) => {
		if (message.author?.bot || !message.guild) return;
		await autoReply.processMessage(message).catch((err) => client.logger?.warn({ err }, 'autoreply failed'));
		await mediaReactions.processMessage(message).catch((err) => client.logger?.warn({ err }, 'media reactions failed'));
	},
};
