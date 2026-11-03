import { SlashCommandBuilder } from "discord.js";

export default {
  data: new SlashCommandBuilder()
    .setName("8ball")
    .setDescription("Ask the magic 8-ball a question.")
    .addStringOption((option) =>
      option.setName("question").setDescription("Your question").setRequired(true)
    ),
  category: "Fun",
  execute: async (client: any, interaction: any) => {
    const question = interaction.options.getString("question")!;
    const answers = [
      "It is certain.",
      "It is decidedly so.",
      "Without a doubt.",
      "Yes definitely.",
      "You may rely on it.",
      "As I see it, yes.",
      "Most likely.",
      "Outlook good.",
      "Yes.",
      "Signs point to yes.",
      "Reply hazy, try again.",
      "Ask again later.",
      "Better not tell you now.",
      "Cannot predict now.",
      "Concentrate and ask again.",
      "Don't count on it.",
      "My reply is no.",
      "My sources say no.",
      "Outlook not so good.",
      "Very doubtful.",
    ];
    const answer = answers[Math.floor(Math.random() * answers.length)];

    await interaction.reply(`🎱 Question: ${question}\nAnswer: ${answer}`);
  },
};
