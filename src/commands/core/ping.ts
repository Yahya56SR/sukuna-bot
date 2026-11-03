import { SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../core/commands.js';

export const pingCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check the bot's latency."),
  category: "utility",
  execute: async (context) => {
    const { client, interaction } = context;
    const sent = await interaction.reply({
      content: "🏓 Pinging...",
      fetchReply: true,
    });
    const wsPing = client.ws.ping;
    const msgPing = sent.createdTimestamp - interaction.createdTimestamp;
    await interaction.editReply(
      `🏓 Pong!\n💎 WebSocket: ${wsPing}ms\n📝 Message: ${msgPing}ms`,
    );
  },
};
