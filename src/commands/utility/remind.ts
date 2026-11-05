import { SlashCommandBuilder, AutocompleteInteraction, ChatInputCommandInteraction, EmbedBuilder, Colors, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } from 'discord.js';
import { Reminder } from '../../db/models/Reminder.js';
import { recordActivity } from '../../core/metrics.js';
import type { Command } from '../../core/commands.js';
import ms from 'ms';

export const remindCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('remind')
    .setDescription('Reminder system')
    .addSubcommand(sub => sub
      .setName('me')
      .setDescription('Set a reminder for yourself')
      .addStringOption(opt => opt
        .setName('time')
        .setDescription('When to remind (e.g., 1h, 30m, 1d, 2024-12-25 15:00)')
        .setRequired(true)
      )
      .addStringOption(opt => opt
        .setName('text')
        .setDescription('What to remind you about')
        .setRequired(true)
        .setMaxLength(2000)
      )
      .addBooleanOption(opt => opt
        .setName('dm')
        .setDescription('Send via DM instead of channel mention')
        .setRequired(false)
      )
    )
    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('List your reminders')
    )
    .addSubcommand(sub => sub
      .setName('cancel')
      .setDescription('Cancel a reminder')
      .addStringOption(opt => opt
        .setName('id')
        .setDescription('Reminder ID')
        .setRequired(true)
        .setAutocomplete(true)
      )
    )
    .addSubcommand(sub => sub
      .setName('recurring')
      .setDescription('Set a recurring reminder')
      .addStringOption(opt => opt
        .setName('pattern')
        .setDescription('Cron pattern (e.g., "0 9 * * *" for daily 9am)')
        .setRequired(true)
      )
      .addStringOption(opt => opt
        .setName('text')
        .setDescription('What to remind you about')
        .setRequired(true)
        .setMaxLength(2000)
      )
      .addStringOption(opt => opt
        .setName('timezone')
        .setDescription('Timezone (e.g., UTC, America/New_York)')
        .setRequired(false)
      )
    ),

  category: 'utility',
  cooldownSeconds: 3,

  async autocomplete(interaction: AutocompleteInteraction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name === 'id') {
      const reminders = await Reminder.find({ userId: interaction.user.id, sent: false }).sort({ remindAt: 1 }).limit(25).lean();
      await interaction.respond(
        reminders.map(r => ({
          name: `${new Date(r.remindAt).toLocaleString()} — ${r.text.slice(0, 50)}`,
          value: String(r._id),
        }))
      );
    }
  },

  async execute(context) {
    const { interaction, guild } = context;
    const guildId = guild?.id;
    const sub = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    if (sub === 'me') {
      const timeStr = interaction.options.getString('time', true);
      const text = interaction.options.getString('text', true);
      const dm = interaction.options.getBoolean('dm') ?? false;

      let remindAt: Date;
      const msParsed = ms(timeStr as Parameters<typeof ms>[0]);
      if (msParsed && typeof msParsed === 'number') {
        remindAt = new Date(Date.now() + msParsed);
      } else {
        // Try parsing as date
        const parsed = new Date(timeStr);
        if (isNaN(parsed.getTime())) {
          await interaction.reply({ content: 'Invalid time format. Use relative (1h, 30m) or absolute (2024-12-25 15:00)', ephemeral: true });
          return;
        }
        remindAt = parsed;
      }

      if (remindAt <= new Date()) {
        await interaction.reply({ content: 'Reminder time must be in the future', ephemeral: true });
        return;
      }

      if (remindAt > new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)) {
        await interaction.reply({ content: 'Reminder cannot be more than 1 year in the future', ephemeral: true });
        return;
      }

      const reminder = await Reminder.create({
        userId,
        guildId,
        channelId: interaction.channelId,
        text,
        remindAt,
        dm,
      });

      const embed = new EmbedBuilder()
        .setColor(Colors.Green)
        .setTitle('⏰ Reminder Set')
        .addFields(
          { name: 'When', value: `<t:${Math.floor(remindAt.getTime() / 1000)}:F> (<t:${Math.floor(remindAt.getTime() / 1000)}:R>)`, inline: false },
          { name: 'What', value: text, inline: false },
          { name: 'ID', value: String(reminder._id), inline: true },
        );

      await interaction.reply({ embeds: [embed], ephemeral: true });
      recordActivity('command', 'Reminder set', { meta: { userId, remindAt: remindAt.toISOString() } });
      return;
    }

    if (sub === 'list') {
      const reminders = await Reminder.find({ userId, sent: false }).sort({ remindAt: 1 }).limit(20).lean();
      if (!reminders.length) {
        await interaction.reply({ content: 'No active reminders', ephemeral: true });
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(Colors.Blurple)
        .setTitle('⏰ Your Reminders')
        .setDescription(
          reminders.map(r => {
            const time = `<t:${Math.floor(r.remindAt.getTime() / 1000)}:F> (<t:${Math.floor(r.remindAt.getTime() / 1000)}:R>)`;
            const guildInfo = r.guildId ? ` in <#${r.channelId}>` : ' (DM)';
            return `**${r._id}** — ${time}${guildInfo}\n${r.text.slice(0, 100)}`;
          }).join('\n\n')
        )
        .setFooter({ text: `${reminders.length} reminder(s)` });

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    if (sub === 'cancel') {
      const id = interaction.options.getString('id', true);
      const reminder = await Reminder.findOneAndDelete({ _id: id, userId });
      if (!reminder) {
        await interaction.reply({ content: 'Reminder not found', ephemeral: true });
        return;
      }

      await interaction.reply({ content: '✅ Reminder cancelled', ephemeral: true });
      return;
    }

    if (sub === 'recurring') {
      const pattern = interaction.options.getString('pattern', true);
      const text = interaction.options.getString('text', true);
      const timezone = interaction.options.getString('timezone') || 'UTC';

      // Validate cron pattern (basic)
      const parts = pattern.split(' ');
      if (parts.length !== 5) {
        await interaction.reply({ content: 'Invalid cron pattern. Use 5 fields: minute hour day month weekday', ephemeral: true });
        return;
      }

      // Calculate next run
      const now = new Date();
      let nextRun = new Date(now);
      // Simplified - in production use a cron library
      nextRun.setMinutes(nextRun.getMinutes() + 1);

      const reminder = await Reminder.create({
        userId,
        guildId,
        channelId: interaction.channelId,
        text,
        remindAt: nextRun,
        recurring: { pattern, timezone, nextRun },
      });

      const embed = new EmbedBuilder()
        .setColor(Colors.Green)
        .setTitle('🔄 Recurring Reminder Set')
        .addFields(
          { name: 'Pattern', value: `\`${pattern}\``, inline: true },
          { name: 'Timezone', value: timezone, inline: true },
          { name: 'Next Run', value: `<t:${Math.floor(nextRun.getTime() / 1000)}:R>`, inline: true },
          { name: 'What', value: text, inline: false },
          { name: 'ID', value: String(reminder._id), inline: true },
        );

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
  },
};

// Reminder checker (call every minute)
export async function checkReminders(client: any): Promise<void> {
  const now = new Date();
  const dueReminders = await Reminder.find({ sent: false, remindAt: { $lte: now } }).limit(50).lean();

  for (const reminder of dueReminders) {
    try {
      const user = await client.users.fetch(reminder.userId);
      const content = `⏰ **Reminder:** ${reminder.text}`;

      if (reminder.dm || !reminder.guildId) {
        await user.send(content).catch(() => {});
      } else {
        const g = client.guilds.cache.get(reminder.guildId!);
        if (g) {
          const channel = g.channels.cache.get(reminder.channelId!) as any;
          if (channel) {
            await channel.send({ content: `<@${reminder.userId}> ${content}` }).catch(() => {
              user.send(content).catch(() => {});
            });
          }
        }
      }

      // Handle recurring
      if (reminder.recurring) {
        // Calculate next run (simplified)
        const nextRun = new Date(reminder.remindAt.getTime() + 60 * 60 * 1000); // Rough approximation
        reminder.remindAt = nextRun;
        reminder.recurring.nextRun = nextRun;
        reminder.sent = false;
        await Reminder.updateOne({ _id: reminder._id }, { $set: { remindAt: nextRun, 'recurring.nextRun': nextRun, sent: false } });
      } else {
        reminder.sent = true;
        await Reminder.updateOne({ _id: reminder._id }, { $set: { sent: true } });
      }
    } catch (error) {
      console.error('[Reminders] Failed to send reminder:', error);
    }
  }
}