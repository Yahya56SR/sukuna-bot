import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, Colors } from 'discord.js';
import { Birthday } from '../../db/models/Birthday.js';
import { recordActivity } from '../../core/metrics.js';
import type { Command } from '../../core/commands.js';

export const birthdayCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('birthday')
    .setDescription('Birthday system')
    .addSubcommand(sub => sub
      .setName('set')
      .setDescription('Set your birthday')
      .addIntegerOption(opt => opt
        .setName('month')
        .setDescription('Birth month (1-12)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(12)
      )
      .addIntegerOption(opt => opt
        .setName('day')
        .setDescription('Birth day (1-31)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(31)
      )
      .addIntegerOption(opt => opt
        .setName('year')
        .setDescription('Birth year (optional)')
        .setRequired(false)
        .setMinValue(1900)
        .setMaxValue(new Date().getFullYear())
      )
    )
    .addSubcommand(sub => sub
      .setName('remove')
      .setDescription('Remove your birthday')
    )
    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('Show upcoming birthdays')
    )
    .addSubcommand(sub => sub
      .setName('today')
      .setDescription("Show today's birthdays")
    ),

  category: 'utility',
  cooldownSeconds: 5,

  async execute(context) {
    const { interaction, guild } = context;
    const guildId = guild.id;
    const userId = interaction.user.id;
    const sub = interaction.options.getSubcommand();

    if (sub === 'set') {
      const month = interaction.options.getInteger('month', true);
      const day = interaction.options.getInteger('day', true);
      const year = interaction.options.getInteger('year');

      // Validate date
      const testDate = new Date(year ?? 2000, month - 1, day);
      if (testDate.getMonth() !== month - 1 || testDate.getDate() !== day) {
        await interaction.reply({ content: '❌ Invalid date.', ephemeral: true });
        return;
      }

      await Birthday.findOneAndUpdate(
        { guildId, userId },
        { guildId, userId, month, day, year, announce: true },
        { upsert: true, new: true }
      );

      await interaction.reply({ content: `✅ Birthday set to: ${month}/${day}${year ? `/${year}` : ''}`, ephemeral: true });
      recordActivity('command', 'Birthday set', { meta: { guildId, userId } });
      return;
    }

    if (sub === 'remove') {
      const result = await Birthday.deleteOne({ guildId, userId });
      if (result.deletedCount === 0) {
        await interaction.reply({ content: '❌ No birthday set.', ephemeral: true });
        return;
      }
      await interaction.reply({ content: '✅ Birthday removed.', ephemeral: true });
      return;
    }

    if (sub === 'list') {
      const now = new Date();
      const birthdays = await Birthday.find({ guildId }).sort({ month: 1, day: 1 }).lean();
      
      if (!birthdays.length) {
        await interaction.reply({ content: 'No birthdays set.', ephemeral: true });
        return;
      }

      // Sort by upcoming
      const upcoming = birthdays
        .map(b => {
          const next = new Date(now.getFullYear(), b.month - 1, b.day);
          if (next < now) next.setFullYear(next.getFullYear() + 1);
          return { ...b, next };
        })
        .sort((a, b) => a.next.getTime() - b.next.getTime())
        .slice(0, 20);

      const embed = new EmbedBuilder()
        .setColor(Colors.Blurple)
        .setTitle('🎂 Upcoming Birthdays')
        .setDescription(
          upcoming.map(b => {
            const member = guild.members.cache.get(b.userId);
            const name = member ? member.user.tag : `Unknown (${b.userId})`;
            const days = Math.ceil((b.next.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
            return `🎂 ${name} — ${b.month}/${b.day} (${days} days)`;
          }).join('\n')
        )
        .setFooter({ text: `${birthdays.length} total` });

      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (sub === 'today') {
      const now = new Date();
      const todayBirthdays = await Birthday.find({
        guildId,
        month: now.getMonth() + 1,
        day: now.getDate(),
      }).lean();

      if (!todayBirthdays.length) {
        await interaction.reply({ content: "No birthdays today.", ephemeral: true });
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(Colors.Gold)
        .setTitle('🎉 Today\'s Birthdays!')
        .setDescription(
          todayBirthdays.map(b => {
            const member = guild.members.cache.get(b.userId);
            const name = member ? member.user.tag : `Unknown (${b.userId})`;
            return `🎂 Happy Birthday, ${name}!`;
          }).join('\n')
        )
        .setFooter({ text: 'Wishing you a wonderful day!' });

      await interaction.reply({ embeds: [embed] });
      return;
    }
  },
};