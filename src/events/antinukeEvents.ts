import { Events } from 'discord.js';
import { antinuke } from '../systems/antinuke/index.js';

export const antinukeAuditLogEvent = {
	name: Events.GuildAuditLogEntryCreate as keyof import('discord.js').ClientEvents,
	execute: async (client: any, entry: any, guild: any) => {
		await antinuke.handleAuditEntry(entry, guild).catch(() => {});
	},
};
