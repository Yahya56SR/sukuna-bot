import { SlashCommandBuilder } from "discord.js";

export default {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check the bot's latency."),
  category: "Utility",
  execute: async (client: any, interaction: any) => {
    const sent = await interaction.reply({
      content: "🏓 Pinging...",
      fetchReply: true,
    });
    const wsPing = client.ws.ping;
    const msgPing = sent.createdTimestamp - interaction.createdTimestamp;
    await interaction.editReply(
      `🏓 Pong!\n💎 WebSocket: ${wsPing}ms\n📝 Message: ${msgPing}ms`
    );
  },
};
