import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, Colors, ButtonBuilder, ButtonStyle, ActionRowBuilder, ComponentType } from 'discord.js';
import { Marriage } from '../../db/models/Marriage.js';
import { User } from '../../db/models/User.js';
import { recordActivity } from '../../core/metrics.js';
import type { Command } from '../../core/commands.js';

export const marriageCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('marry')
    .setDescription('Marriage system')
    .addSubcommand(sub => sub
      .setName('propose')
      .setDescription('Propose marriage to someone')
      .addUserOption(opt => opt
        .setName('user')
        .setDescription('User to propose to')
        .setRequired(true)
      )
    )
    .addSubcommand(sub => sub
      .setName('accept')
      .setDescription('Accept a marriage proposal')
    )
    .addSubcommand(sub => sub
      .setName('divorce')
      .setDescription('Divorce your spouse')
    )
    .addSubcommand(sub => sub
      .setName('profile')
      .setDescription('View marriage profile')
      .addUserOption(opt => opt
        .setName('user')
        .setDescription('User to view')
        .setRequired(false)
      )
    ),

  category: 'fun',
  cooldownSeconds: 5,

  async execute(context) {
    const { interaction, guild } = context;
    const guildId = guild.id;
    const userId = interaction.user.id;
    const sub = interaction.options.getSubcommand();

    if (sub === 'propose') {
      const target = interaction.options.getUser('user', true);
      if (target.id === userId) {
        await interaction.reply({ content: '❌ You cannot marry yourself.', ephemeral: true });
        return;
      }

      // Check if either user is already married
      const existing1 = await Marriage.findOne({ guildId, userId1: userId, divorced: false });
      const existing2 = await Marriage.findOne({ guildId, userId2: userId, divorced: false });
      if (existing1 || existing2) {
        await interaction.reply({ content: '❌ You are already married.', ephemeral: true });
        return;
      }

      const existing3 = await Marriage.findOne({ guildId, userId1: target.id, divorced: false });
      const existing4 = await Marriage.findOne({ guildId, userId2: target.id, divorced: false });
      if (existing3 || existing4) {
        await interaction.reply({ content: '❌ That user is already married.', ephemeral: true });
        return;
      }

      const buttons = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
          new ButtonBuilder().setCustomId(`marry_accept:${userId}`).setLabel('Accept').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`marry_decline:${userId}`).setLabel('Decline').setStyle(ButtonStyle.Danger),
        );

      const embed = new EmbedBuilder()
        .setColor(Colors.Purple)
        .setTitle('💍 Marriage Proposal')
        .setDescription(`${interaction.user} is proposing to ${target}!`);

      await interaction.reply({ content: `${target}`, embeds: [embed], components: [buttons] });

      // Wait for response
      const filter = (i: any) => i.user.id === target.id && i.isButton();
      const collector = interaction.channel?.createMessageComponentCollector({
        filter,
        time: 60000,
      });

      collector?.on('collect', async (i: any) => {
        if (i.customId === `marry_accept:${userId}`) {
          await Marriage.create({
            userId1: userId,
            userId2: target.id,
            guildId,
            proposerId: userId,
          });

          await i.update({ content: '✅ Marriage accepted! Congratulations!', embeds: [], components: [] });
          recordActivity('command', 'Marriage accepted', { meta: { guildId, userId1: userId, userId2: target.id } });
        } else {
          await i.update({ content: '❌ Proposal declined.', embeds: [], components: [] });
        }
        collector.stop();
      });

      collector?.on('end', () => {
        // No action needed
      });
      return;
    }

    if (sub === 'accept') {
      await interaction.reply({ content: '❌ No pending proposal to accept. Someone needs to propose to you first.', ephemeral: true });
      return;
    }

    if (sub === 'divorce') {
      const marriage = await Marriage.findOne({
        guildId,
        $or: [{ userId1: userId }, { userId2: userId }],
        divorced: false,
      });

      if (!marriage) {
        await interaction.reply({ content: '❌ You are not married.', ephemeral: true });
        return;
      }

      marriage.divorced = true;
      marriage.divorcedAt = new Date();
      marriage.divorceInitiatorId = userId;
      await marriage.save();

      await interaction.reply({ content: '✅ Divorce finalized.', ephemeral: true });
      recordActivity('command', 'Marriage divorce', { meta: { guildId, userId } });
      return;
    }

    if (sub === 'profile') {
      const targetUser = interaction.options.getUser('user') ?? interaction.user;
      const marriage = await Marriage.findOne({
        guildId,
        $or: [{ userId1: targetUser.id }, { userId2: targetUser.id }],
        divorced: false,
      });

      if (!marriage) {
        await interaction.reply({ content: `${targetUser.tag} is not married.`, ephemeral: true });
        return;
      }

      const spouseId = marriage.userId1 === targetUser.id ? marriage.userId2 : marriage.userId1;
      const spouse = await guild.members.fetch(spouseId).catch(() => null);
      const spouseName = spouse ? spouse.user.tag : `Unknown (${spouseId})`;

      const embed = new EmbedBuilder()
        .setColor(Colors.Purple)
        .setTitle('💍 Marriage Profile')
        .addFields(
          { name: 'User', value: targetUser.tag, inline: true },
          { name: 'Spouse', value: spouseName, inline: true },
          { name: 'Married since', value: `<t:${Math.floor(marriage.marriedAt.getTime() / 1000)}:R>`, inline: true },
          { name: 'Hugs', value: marriage.stats.hugs.toString(), inline: true },
          { name: 'Kisses', value: marriage.stats.kisses.toString(), inline: true },
          { name: 'Gifts', value: marriage.stats.gifts.toString(), inline: true },
        );

      await interaction.reply({ embeds: [embed] });
      return;
    }
  },
};