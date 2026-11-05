import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, Colors, Message } from 'discord.js';
import { AFK } from '../../db/models/AFK.js';
import { recordActivity } from '../../core/metrics.js';
import type { Command } from '../../core/commands.js';

export const afkCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('afk')
    .setDescription('AFK system')
    .addSubcommand(sub => sub
      .setName('set')
      .setDescription('Set your AFK status')
      .addStringOption(opt => opt
        .setName('reason')
        .setDescription('AFK reason')
        .setRequired(false)
        .setMaxLength(500)
      )
    )
    .addSubcommand(sub => sub
      .setName('remove')
      .setDescription('Remove your AFK status')
    )
    .addSubcommand(sub => sub
      .setName('info')
      .setDescription('Check someone\'s AFK status')
      .addUserOption(opt => opt
        .setName('user')
        .setDescription('User to check')
        .setRequired(true)
      )
    ),

  category: 'utility',
  cooldownSeconds: 3,

  async execute(context) {
    const { interaction, guild, member } = context;
    const guildId = guild.id;
    const sub = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    if (sub === 'set') {
      const reason = interaction.options.getString('reason') || 'AFK';

      // Check if already AFK
      const existing = await AFK.findOne({ guildId, userId });
      if (existing) {
        await interaction.reply({ content: 'You\'re already AFK', ephemeral: true });
        return;
      }

      // Save original nickname
      let originalNickname: string | undefined;
      if (member && 'nickname' in member && member.nickname) {
        originalNickname = member.nickname;
      }

      const afk = await AFK.create({
        userId,
        guildId,
        reason,
        originalNickname,
      });

      // Update nickname
      if (member && 'setNickname' in member) {
        try {
          await member.setNickname(`[AFK] ${member.displayName}`, 'AFK system');
        } catch {}
      }

      const embed = new EmbedBuilder()
        .setColor(Colors.Yellow)
        .setTitle('💤 AFK Set')
        .addFields(
          { name: 'Reason', value: reason, inline: false },
          { name: 'Since', value: `<t:${Math.floor(afk.setAt.getTime() / 1000)}:R>`, inline: true },
        );

      await interaction.reply({ embeds: [embed] });
      recordActivity('command', 'AFK set', { meta: { guildId, userId } });
      return;
    }

    if (sub === 'remove') {
      const afk = await AFK.findOneAndDelete({ guildId, userId });
      if (!afk) {
        await interaction.reply({ content: 'You\'re not AFK', ephemeral: true });
        return;
      }

      // Restore nickname
      if (member && 'setNickname' in member && afk.originalNickname) {
        try {
          await member.setNickname(afk.originalNickname, 'AFK removed');
        } catch {}
      }

      const embed = new EmbedBuilder()
        .setColor(Colors.Green)
        .setTitle('✅ AFK Removed')
        .addFields(
          { name: 'Was AFK for', value: `<t:${Math.floor(afk.setAt.getTime() / 1000)}:R>`, inline: true },
          { name: 'Mentions received', value: afk.mentions.toString(), inline: true },
        );

      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (sub === 'info') {
      const user = interaction.options.getUser('user', true);
      const afk = await AFK.findOne({ guildId, userId: user.id });
      if (!afk) {
        await interaction.reply({ content: `${user.tag} is not AFK`, ephemeral: true });
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(Colors.Yellow)
        .setTitle(`💤 ${user.tag} is AFK`)
        .addFields(
          { name: 'Reason', value: afk.reason, inline: false },
          { name: 'Since', value: `<t:${Math.floor(afk.setAt.getTime() / 1000)}:F> (<t:${Math.floor(afk.setAt.getTime() / 1000)}:R>)`, inline: false },
          { name: 'Mentions', value: afk.mentions.toString(), inline: true },
        );

      if (afk.lastMentionedAt) {
        embed.addFields({ name: 'Last Mentioned', value: `<t:${Math.floor(afk.lastMentionedAt.getTime() / 1000)}:R>`, inline: true });
      }

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
  },
};

// AFK message handler (call from messageCreate)
export async function handleAfkMessage(message: Message): Promise<void> {
  if (!message.guild || message.author.bot) return;

  const guildId = message.guild.id;

  // Check if author is AFK - remove AFK
  const authorAfk = await AFK.findOne({ guildId, userId: message.author.id });
  if (authorAfk) {
    await AFK.deleteOne({ _id: authorAfk._id });

    // Restore nickname
    const member = message.member;
    if (member && authorAfk.originalNickname) {
      try {
        await member.setNickname(authorAfk.originalNickname, 'AFK auto-removed');
      } catch {}
    }

    const embed = new EmbedBuilder()
      .setColor(Colors.Green)
      .setDescription(`👋 Welcome back! You were AFK for <t:${Math.floor(authorAfk.setAt.getTime() / 1000)}:R> (${authorAfk.mentions} mentions)`);

    await message.reply({ embeds: [embed] }).catch(() => {});
  }

  // Check mentions for AFK users
  const mentionedUsers = message.mentions.users.filter(u => u.id !== message.author.id);
  for (const mentionedUser of mentionedUsers.values()) {
    const afk = await AFK.findOne({ guildId, userId: mentionedUser.id });
    if (afk) {
      afk.mentions++;
      afk.lastMentionedAt = new Date();
      await afk.save();

      const embed = new EmbedBuilder()
        .setColor(Colors.Yellow)
        .setDescription(`💤 **${mentionedUser.tag}** is AFK: ${afk.reason}\nSince <t:${Math.floor(afk.setAt.getTime() / 1000)}:R> (${afk.mentions} mentions total)`);

      await message.reply({ embeds: [embed], allowedMentions: { users: [] } }).catch(() => {});
      break; // Only notify for first AFK mention
    }
  }
}