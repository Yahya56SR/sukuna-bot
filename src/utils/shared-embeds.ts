import { EmbedBuilder, Colors } from 'discord.js';

/**
 * Shared reusable embed builders — pure discord.js, no DB dependency.
 */
export default class EmbedBuilderUtil {
	static success(title: string, description: string, fields: any[] = []): EmbedBuilder {
		return new EmbedBuilder()
			.setColor(Colors.Green)
			.setTitle(`✅ ${title}`)
			.setDescription(description)
			.addFields(fields)
			.setTimestamp();
	}

	static error(title: string, description: string, fields: any[] = []): EmbedBuilder {
		return new EmbedBuilder()
			.setColor(Colors.Red)
			.setTitle(`❌ ${title}`)
			.setDescription(description)
			.addFields(fields)
			.setTimestamp();
	}

	static warning(title: string, description: string, fields: any[] = []): EmbedBuilder {
		return new EmbedBuilder()
			.setColor(Colors.Yellow)
			.setTitle(`⚠️ ${title}`)
			.setDescription(description)
			.addFields(fields)
			.setTimestamp();
	}

	static info(title: string, description: string, fields: any[] = []): EmbedBuilder {
		return new EmbedBuilder()
			.setColor(Colors.Blue)
			.setTitle(`ℹ️ ${title}`)
			.setDescription(description)
			.addFields(fields)
			.setTimestamp();
	}

	static ticketPanel(title: string, description: string, options: any[] = []): EmbedBuilder {
		return new EmbedBuilder()
			.setColor(Colors.Purple)
			.setTitle(`🎫 ${title}`)
			.setDescription(description)
			.setFooter({ text: 'Select a category below to create a ticket' })
			.setTimestamp();
	}

	static ticketControl(ticketData: any): EmbedBuilder {
		return new EmbedBuilder()
			.setColor(Colors.DarkBlue)
			.setTitle(`🎫 Ticket #${ticketData.id}`)
			.addFields(
				{ name: '👤 Created by', value: `<@${ticketData.user_id}>`, inline: true },
				{ name: '📂 Type', value: ticketData.type, inline: true },
				{ name: '📊 Status', value: ticketData.status, inline: true },
				{ name: '👮 Claimed by', value: ticketData.claimed_by ? `<@${ticketData.claimed_by}>` : 'None', inline: true },
				{ name: '📅 Created', value: `<t:${Math.floor(new Date(ticketData.created_at).getTime() / 1000)}:R>`, inline: true },
			)
			.setTimestamp();
	}

	static suggestion(suggestion: any): EmbedBuilder {
		const colors: Record<string, number> = {
			pending: Colors.Blue,
			noted: Colors.Yellow,
			approved: Colors.Green,
			denied: Colors.Red,
			under_review: Colors.Orange,
		};
		return new EmbedBuilder()
			.setColor(colors[suggestion.status] || Colors.Default)
			.setTitle(`💡 ${suggestion.title}`)
			.setDescription(suggestion.content)
			.addFields(
				{ name: '👤 Author', value: `<@${suggestion.user_id}>`, inline: true },
				{ name: '👍 Upvotes', value: suggestion.votes_up?.toString() ?? '0', inline: true },
				{ name: '👎 Downvotes', value: suggestion.votes_down?.toString() ?? '0', inline: true },
				{ name: '📊 Status', value: suggestion.status, inline: true },
			)
			.setFooter({ text: `ID: ${suggestion.id} | Thread: ${suggestion.thread_id}` })
			.setTimestamp();
	}

	static suggestionReview(suggestion: any): EmbedBuilder {
		return new EmbedBuilder()
			.setColor(Colors.Gold)
			.setTitle(`📋 Suggestion Review: ${suggestion.title}`)
			.setDescription(suggestion.content)
			.addFields(
				{ name: '👤 Author', value: `<@${suggestion.user_id}> (${suggestion.user_id})`, inline: true },
				{ name: '👍 Upvotes', value: suggestion.votes_up?.toString() ?? '0', inline: true },
				{ name: '👎 Downvotes', value: suggestion.votes_down?.toString() ?? '0', inline: true },
				{ name: '📊 Current Status', value: suggestion.status, inline: true },
			)
			.setFooter({ text: `Suggestion ID: ${suggestion.id}` })
			.setTimestamp();
	}

	static presentation(presentation: any): EmbedBuilder {
		const questions = typeof presentation.answers === 'string' ? JSON.parse(presentation.answers) : presentation.answers;
		const fields = questions.map((qa: any, i: number) => ({
			name: `Q${i + 1}: ${qa.question}`,
			value: qa.answer || '*No answer*',
			inline: false,
		}));
		const colors: Record<string, number> = {
			pending: Colors.Blue,
			approved: Colors.Green,
			denied: Colors.Red,
			changes_requested: Colors.Orange,
		};
		return new EmbedBuilder()
			.setColor(colors[presentation.status] || Colors.Default)
			.setTitle(`📝 Staff Application - ${presentation.status.toUpperCase()}`)
			.setDescription(`**Applicant:** <@${presentation.user_id}> (${presentation.user_id})`)
			.addFields(fields)
			.setFooter({ text: `Presentation ID: ${presentation.id} | User: ${presentation.user_id}` })
			.setTimestamp();
	}

	static serverStatus(server: any, status: any): EmbedBuilder {
		const isOnline = status?.online;
		const proxyOffline = !isOnline && !!status?.motd;
		return new EmbedBuilder()
			.setColor(isOnline ? Colors.Green : Colors.Red)
			.setTitle(`${isOnline ? '🟢' : '🔴'} ${server?.name ?? 'Server'}`)
			.setDescription(
				isOnline
					? 'Server is online'
					: status?.error
						? `Server is offline — ${status.error}`
						: 'Server is offline',
			)
			.addFields(
				{ name: '🌐 Address', value: `${server?.host ?? '?'}:${server?.port ?? '?'}`, inline: true },
				{ name: '👥 Players', value: isOnline ? `${status.players?.online ?? 0}/${status.players?.max ?? 0}` : 'N/A', inline: true },
				{ name: '📦 Version', value: isOnline ? status.version?.name ?? 'N/A' : (proxyOffline && status.version?.name ? status.version.name : 'N/A'), inline: true },
				{ name: '📝 MOTD', value: isOnline || proxyOffline ? this.cleanMotd(status.motd) : 'N/A', inline: false },
			)
			.setTimestamp()
			.setFooter({ text: 'Last updated' });
	}

	static cleanMotd(motd: any): string {
		if (!motd) return 'N/A';
		if (typeof motd === 'string') return motd.replace(/§[0-9a-fk-or]/gi, '');
		if (motd.clean) return motd.clean.replace(/§[0-9a-fk-or]/gi, '');
		if (motd.raw) return motd.raw.replace(/§[0-9a-fk-or]/gi, '');
		return JSON.stringify(motd).replace(/§[0-9a-fk-or]/gi, '');
	}

	static welcome(member: any, guild: any, memberCount: number): EmbedBuilder {
		return new EmbedBuilder()
			.setColor(Colors.Green)
			.setTitle('👋 Welcome!')
			.setDescription(`Welcome ${member}, we're glad to have you!`)
			.addFields(
				{ name: '📋 Read Rules', value: 'See the rules channels', inline: true },
				{ name: '🎮 Servers', value: 'Check server status', inline: true },
				{ name: '🎫 Support', value: 'Open a ticket', inline: true },
			)
			.setThumbnail(member.displayAvatarURL())
			.setFooter({ text: `Member #${memberCount}` })
			.setTimestamp();
	}

	static goodbye(member: any, guild: any, memberCount: number): EmbedBuilder {
		return new EmbedBuilder()
			.setColor(Colors.Red)
			.setTitle('👋 Goodbye!')
			.setDescription(`**${member.user.tag}** has left the server.`)
			.setThumbnail(member.displayAvatarURL())
			.setFooter({ text: `Member count: ${memberCount}` })
			.setTimestamp();
	}

	static modpackTutorial(): EmbedBuilder {
		return new EmbedBuilder()
			.setColor(Colors.Gold)
			.setTitle('📥 How to Install Modpacks')
			.setDescription('Follow these steps to install any of our modpacks:')
			.addFields(
				{
					name: '💻 PC - SKLauncher 4.0',
					value: '1. Download SKLauncher 4.0 from [sklauncher.net](https://sklauncher.net)\n2. Install and open the launcher\n3. Go to "Content Hub" tab\n4. Search for our modpack\n5. Click "Install" and then "Play"',
				},
				{
					name: '📱 Mobile - MJLauncher',
					value: '1. Download MJLauncher from [mojolauncher.com/](https://mojolauncher.com/) or Play Store\n2. Open the app\n3. Create a new modpack instance\n4. Find our modpack\n5. Tap Install and Play',
				},
			)
			.setFooter({ text: 'Need help? Create a ticket in #🚑⠂𝔱𝔢𝔠𝔥-𝔰𝔲𝔭𝔭𝔬𝔯𝔱' })
			.setTimestamp();
	}
}
