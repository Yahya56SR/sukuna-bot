import type { Message, Guild } from 'discord.js';
import { Events, MessageFlags } from 'discord.js';
import { MediaReactionConfig, type MediaKind, type EnforceMode } from '../../db/models/MediaReaction.js';

/**
 * Media Reactions system.
 * Uses Mongoose (MediaReactionConfig).
 */
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|avif|heic|heif|tiff?)$/i;
const VIDEO_EXT = /\.(mp4|mov|webm|mkv|avi|m4v|flac)$/i;

export class MediaReactionSystem {
	private handled = new Set<string>();

	async getConfig(guildId: string) {
		let cfg = await MediaReactionConfig.findOne({ guildId }).lean();
		if (!cfg) {
			cfg = await MediaReactionConfig.create({
				guildId, enabled: false,
				memeChannels: [], imageChannels: [],
				memeReactions: ['⭐', '😂'], imageReactions: ['📸'],
				enforceMode: 'warn',
			});
		}
		return cfg;
	}

	isEnabled(cfg: any): boolean {
		return cfg.enabled === true;
	}

	private matchChannel(channelId: string, cfg: any): { kind: MediaKind; reactions: string[]; enforce: EnforceMode } | null {
		const meme = cfg.memeChannels?.find((c: any) => c.id === channelId);
		if (meme) return { kind: 'memes', reactions: meme.reactions ?? cfg.memeReactions, enforce: meme.enforce ?? cfg.enforceMode };
		const img = cfg.imageChannels?.find((c: any) => c.id === channelId);
		if (img) return { kind: 'images', reactions: img.reactions ?? cfg.imageReactions, enforce: img.enforce ?? cfg.enforceMode };
		return null;
	}

	static hasMedia(message: Message): { has: boolean; isImage: boolean; isVideo: boolean } {
		let isImage = false;
		let isVideo = false;
		for (const att of message.attachments.values()) {
			const type = (att.contentType || '').toLowerCase();
			const name = att.name || '';
			if (type.startsWith('image/')) { isImage = true; continue; }
			if (type.startsWith('video/')) { isVideo = true; continue; }
			if (IMAGE_EXT.test(name)) { isImage = true; continue; }
			if (VIDEO_EXT.test(name)) { isVideo = true; continue; }
		}
		if (message.stickers.size) isImage = true;
		for (const embed of message.embeds) {
			if (embed.image || embed.thumbnail) { isImage = true; break; }
			if (embed.video) { isVideo = true; break; }
		}
		return { has: isImage || isVideo, isImage, isVideo };
	}

	async processMessage(message: Message): Promise<void> {
		if (!message.guild) return;
		const cfg = await this.getConfig(message.guild.id);
		if (!this.isEnabled(cfg)) return;
		const channel = this.matchChannel(message.channelId, cfg);
		if (!channel) return;
		if (this.handled.has(message.id)) return;
		this.handled.add(message.id);
		if (this.handled.size > 5000) this.handled.clear();

		const media = MediaReactionSystem.hasMedia(message);
		if (media.has) {
			await this.applyReactions(message, channel, media.isVideo);
			return;
		}
		await this.enforceMediaOnly(message, channel);
	}

	private async applyReactions(message: Message, channel: { reactions: string[] }, _isVideo: boolean): Promise<void> {
		const reactions = channel.reactions?.length ? channel.reactions : [];
		if (!reactions.length) return;
		for (const emoji of reactions) {
			await message.react(emoji).catch(() => {});
		}
	}

	private async enforceMediaOnly(message: Message, channel: { enforce: EnforceMode }): Promise<void> {
		const mode: EnforceMode = channel.enforce ?? 'warn';
		if (mode === 'off') return;
		const notice = '📎 This channel only accepts images and videos.';
		if (mode === 'warn') {
			await message.reply({ content: notice, flags: MessageFlags.Ephemeral as any })
				.then((r) => setTimeout(() => r.delete().catch(() => {}), 4000).unref?.())
				.catch(() => {});
			return;
		}
		await message.delete().catch(() => {});
		await message.author
			.send({ content: `Your message in <#${message.channelId}> was removed: ${notice}\nThis channel is for images and videos only.` })
			.catch(() => {});
	}

	status(guildId: string): Promise<{ cfg: any; known: number }> {
		return this.getConfig(guildId).then((cfg) => ({
			cfg,
			known: (cfg.memeChannels?.length ?? 0) + (cfg.imageChannels?.length ?? 0),
		}));
	}
}

export const mediaReactions = new MediaReactionSystem();

export const messageCreateMediaReactions = {
	name: Events.MessageCreate as keyof import('discord.js').ClientEvents,
	execute: async (_client: any, message: Message) => {
		try { await mediaReactions.processMessage(message).catch(() => {}); } catch {}
	},
};
