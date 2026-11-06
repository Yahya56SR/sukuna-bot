import type { Message, TextChannel } from 'discord.js';
import { Events } from 'discord.js';
import { AutoReply } from '../../db/models/AutoReply.js';
import EmbedBuilderUtil from '../../utils/shared-embeds.js';

/**
 * Auto-Reply system (ported from astralcraft).
 * Uses Mongoose (AutoReply). Keeps astralcraft's keyword/regex/exact matching
 * plus the server-IP / server-status / modpack-help shortcuts.
 */
const IP_KEYWORDS = ['ip', 'server ip', 'address', 'connect', 'server address', 'ip address'];
const STATUS_KEYWORDS = ['status', 'online?', 'is the server up', 'server status', 'server online'];
const MODPACK_KEYWORDS = [
	'how to install', 'how to download', 'install modpack', 'download modpack',
	'modpack install', 'modpack download', 'how install', 'how download',
	'sklauncher', 'mjlauncher', 'launcher', 'modpack help',
];

export class AutoReplySystem {
	private cooldowns = new Map<string, number>(); // userId+trigger -> timestamp
	private cooldownMs = 10_000; // 10 seconds per user per trigger

	async getAutoReplies(guildId: string, channelId?: string) {
		const query: any = { guildId, enabled: true };
		if (channelId) query.$or = [{ channelId }, { channelId: null }, { channelId: { $exists: false } }];
		return AutoReply.find(query).lean();
	}

	async addAutoReply(data: {
		guildId: string; triggerType: 'keyword' | 'regex' | 'exact'; triggerValue: string; response: string; channelId?: string;
	}): Promise<any> {
		return AutoReply.create(data);
	}

	async removeAutoReply(guildId: string, id: string): Promise<any> {
		return AutoReply.deleteOne({ _id: id, guildId });
	}

	checkCooldown(userId: string, trigger: string): boolean {
		const key = `${userId}:${trigger}`;
		const now = Date.now();
		const lastUsed = this.cooldowns.get(key);

		if (lastUsed && (now - lastUsed) < this.cooldownMs) {
			return false;
		}

		this.cooldowns.set(key, now);
		if (this.cooldowns.size > 1000) {
			for (const [k, v] of this.cooldowns.entries()) {
				if (now - v > this.cooldownMs * 2) {
					this.cooldowns.delete(k);
				}
			}
		}
		return true;
	}

	async processMessage(message: Message): Promise<boolean> {
		if (message.author.bot || !message.guild || !message.content) return false;

		const content = message.content.toLowerCase();
		const channelId = message.channel.id;
		const userId = message.author.id;

		// 1. Check for Server IP requests
		const ipReply = await this.checkServerIP(content, channelId);
		if (ipReply && this.checkCooldown(userId, `ip:${channelId}`)) {
			await message.reply({ embeds: [ipReply], allowedMentions: { repliedUser: false } });
			return true;
		}

		// 2. Check for Server Status requests
		const statusReply = await this.checkServerStatus(content, channelId);
		if (statusReply && this.checkCooldown(userId, `status:${channelId}`)) {
			await message.reply({ embeds: [statusReply], allowedMentions: { repliedUser: false } });
			return true;
		}

		// 3. Check for Modpack installation help
		const modpackReply = this.checkModpackHelp(content);
		if (modpackReply && this.checkCooldown(userId, 'modpack')) {
			await message.reply({ embeds: [modpackReply], allowedMentions: { repliedUser: false } });
			return true;
		}

		// 4. Check database auto-replies
		const dbReply = await this.checkDatabaseReplies(message.guild.id, content, channelId);
		if (dbReply && this.checkCooldown(userId, `db:${dbReply.id}`)) {
			await message.reply({ content: dbReply.response, allowedMentions: { repliedUser: false } });
			return true;
		}

		return false;
	}

	async checkServerIP(content: string, channelId: string): Promise<import('discord.js').EmbedBuilder | null> {
		const matched = IP_KEYWORDS.some(kw => content.includes(kw));
		if (!matched) return null;

		const replies = await this.getAutoReplies('', channelId);
		for (const reply of replies) {
			if (reply.channelId && reply.channelId !== channelId) continue;
			if (reply.triggerType === 'keyword' && reply.triggerValue.toLowerCase() === 'ip') {
				return EmbedBuilderUtil.info(
					'🌐 Server IP',
					`**Server IP:** \`${reply.response.replace('Server IP: ', '').replace(/`/g, '')}\`\n\nUse this IP to connect to the server!`,
					[{ name: '📋 Copy', value: reply.response, inline: false }],
				);
			}
		}

		return null;
	}

	async checkServerStatus(content: string, channelId: string): Promise<import('discord.js').EmbedBuilder | null> {
		const matched = STATUS_KEYWORDS.some(kw => content.includes(kw));
		if (!matched) return null;

		return EmbedBuilderUtil.info(
			'📊 Server Status',
			'Use `/serverstatus [server]` to check the status of a specific server.',
			[{ name: '💡 Tip', value: 'Each server has its own status channel with live updates!', inline: false }],
		);
	}

	checkModpackHelp(content: string): import('discord.js').EmbedBuilder | null {
		const matched = MODPACK_KEYWORDS.some(kw => content.includes(kw));
		if (!matched) return null;

		return EmbedBuilderUtil.modpackTutorial?.() ?? EmbedBuilderUtil.info(
			'📦 Modpack Help',
			'Use a launcher like SKLauncher or MJLauncher to install modpacks.',
		);
	}

	async checkDatabaseReplies(guildId: string, content: string, channelId: string): Promise<any | null> {
		const replies = await this.getAutoReplies(guildId, channelId);

		for (const reply of replies) {
			// Check channel restriction
			if (reply.channelId && reply.channelId !== channelId) continue;

			let matched = false;

			switch (reply.triggerType) {
			case 'keyword':
				matched = content.includes(reply.triggerValue.toLowerCase());
				break;
			case 'regex':
				try {
					const regex = new RegExp(reply.triggerValue, 'i');
					matched = regex.test(content);
				}
				catch (e) {
					continue;
				}
				break;
			case 'exact':
				matched = content === reply.triggerValue.toLowerCase();
				break;
			}

			if (matched) {
				return reply;
			}
		}

		return null;
	}

	// For ticket auto-reply
	async getTicketAutoReply(content: string): Promise<{ embed: import('discord.js').EmbedBuilder; buttons: any[] } | null> {
		const matched = MODPACK_KEYWORDS.some(kw => content.toLowerCase().includes(kw));
		if (!matched) return null;

		return {
			embed: EmbedBuilderUtil.modpackTutorial?.() ?? EmbedBuilderUtil.info(
				'📦 Modpack Help',
				'Use a launcher like SKLauncher or MJLauncher to install modpacks.',
			),
			buttons: [
				{ customId: 'ticket_modpack_helped_yes', label: '✅ Yes, it helped!', style: 3 },
				{ customId: 'ticket_modpack_helped_no', label: '❌ No, need staff', style: 4 },
			],
		};
	}
}

export const autoReply = new AutoReplySystem();

export const messageCreateAutoreply = {
	name: Events.MessageCreate as keyof import('discord.js').ClientEvents,
	execute: async (_client: any, message: Message) => {
		try { await autoReply.processMessage(message).catch(() => {}); } catch {}
	},
};
