import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import type { Command } from '../../core/commands.js';
import { Helpers } from '../../utils/shared-helpers.js';

export const pingCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check the bot’s latency and system stats.')
    .setDMPermission(false),
  category: 'utility',
  cooldownSeconds: 5,
  execute: async (context) => {
    const { client, interaction } = context;
    const sent = await interaction.reply({
      content: '🏓 Pinging...',
      fetchReply: true,
    });
    const wsPing = client.ws.ping;
    const msgPing = sent.createdTimestamp - interaction.createdTimestamp;
    const uptimeMs = process.uptime() * 1000;
    const mem = process.memoryUsage();
    const guilds = client.guilds.cache.size;
    const users = client.users.cache.size;

    await interaction.editReply(
      `🏓 **Pong!**\n` +
        `💎 WebSocket: ${wsPing}ms\n` +
        `📝 Message: ${msgPing}ms\n` +
        `⏱️ Uptime: ${Helpers.formatDuration(uptimeMs)}\n` +
        `🧠 Memory: ${(mem.rss / 1024 / 1024).toFixed(1)} MB\n` +
        `🏠 Guilds: ${guilds.toLocaleString()} • 👥 Users: ${users.toLocaleString()}`,
    );
  },
};
