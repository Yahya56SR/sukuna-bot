import type { Message, TextChannel } from 'discord.js';
import { Events } from 'discord.js';
import { AutoReply } from '../../db/models/AutoReply.js';
import EmbedBuilderUtil from '../../utils/shared-embeds.js';

/**
 * Auto-Reply system.
 * Uses Mongoose (AutoReply).
 */
export class AutoReplySystem {
	private cooldowns = new Map<string, number>();
	private cooldownMs = 10_000;

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
		if (lastUsed && (now - lastUsed) < this.cooldownMs) return false;
		this.cooldowns.set(key, now);
		if (this.cooldowns.size > 1000) {
			for (const [k, v] of this.cooldowns.entries()) {
				if (now - v > this.cooldownMs * 2) this.cooldowns.delete(k);
			}
		}
		return true;
	}

	async processMessage(message: Message): Promise<boolean> {
		if (message.author.bot || !message.guild || !message.content) return false;

		const content = message.content.toLowerCase();
		const channelId = message.channel.id;
		const userId = message.author.id;

		// 1. Database auto-replies
		const replies = await this.getAutoReplies(message.guild.id, channelId);
		for (const reply of replies) {
			let matched = false;
			switch (reply.triggerType) {
				case 'keyword':
					matched = content.includes(reply.triggerValue.toLowerCase());
					break;
				case 'regex':
					try { matched = new RegExp(reply.triggerValue, 'i').test(content); } catch { continue; }
					break;
				case 'exact':
					matched = content === reply.triggerValue.toLowerCase();
					break;
			}
			if (matched && this.checkCooldown(userId, `db:${reply._id}`)) {
				await message.reply({ content: reply.response, allowedMentions: { repliedUser: false } });
				return true;
			}
		}
		return false;
	}
}

export const autoReply = new AutoReplySystem();

export const messageCreateAutoreply = {
	name: Events.MessageCreate as keyof import('discord.js').ClientEvents,
	execute: async (_client: any, message: Message) => {
		try { await autoReply.processMessage(message).catch(() => {}); } catch {}
	},
};
