import { Events } from 'discord.js';
import { verification } from '../systems/verification/index.js';
import { welcomer } from '../systems/welcomer/index.js';

export const welcomeMemberAddEvent = {
	name: Events.GuildMemberAdd as keyof import('discord.js').ClientEvents,
	execute: async (client: any, member: any) => {
		if (member.user?.bot) return;
		await verification.handleMemberAdd(member).catch((err) => client.logger?.warn({ err, userId: member.id }, 'verification join roles failed'));
		await welcomer.sendWelcome(member).catch((err) => client.logger?.warn({ err, userId: member.id }, 'welcomer failed'));
	},
};

export const welcomeMemberRemoveEvent = {
	name: Events.GuildMemberRemove as keyof import('discord.js').ClientEvents,
	execute: async (client: any, member: any) => {
		if (member.user?.bot) return;
		await welcomer.sendGoodbye(member).catch((err) => client.logger?.warn({ err, userId: member.id }, 'welcomer goodbye failed'));
	},
};
