import { Events } from 'discord.js';
import { boosters } from '../systems/boosters/index.js';

export const boosterMemberUpdateEvent = {
	name: Events.GuildMemberUpdate as keyof import('discord.js').ClientEvents,
	execute: async (client: any, oldMember: any, newMember: any) => {
		await boosters.handleMemberUpdate(oldMember, newMember).catch(() => {});
	},
};
