import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  type User,
  type GuildMember,
} from 'discord.js';
import type { Command } from '../../core/commands.js';
import { getUser, getUserXp } from '../../db/index.js';
import { levelFromXp } from '../../utils/level.js';

export const userinfoCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription("View a member's profile: XP, level, balance, and account info.")
    .addUserOption((option) =>
      option.setName('user').setDescription('The member to check').setRequired(false),
    ),
  category: 'utility',
  execute: async (context) => {
    const { interaction, guild } = context;
    const target = interaction.options.getUser('user') ?? interaction.user;
    const member =
      target.id === interaction.user.id
        ? interaction.member
        : (guild?.members.cache.get(target.id) ?? undefined);

    const dbUser = await getUser(target.id);
    const xpRow = await getUserXp(target.id);
    const info = xpRow
      ? levelFromXp(xpRow.xp)
      : { level: 0, xpInLevel: 0, xpForNext: 100, totalXp: 0 };

    const fields: Array<{ name: string; value: string; inline: boolean }> = [
      { name: 'Tag', value: target.tag, inline: true },
      { name: 'ID', value: target.id, inline: true },
      { name: 'Bot', value: target.bot ? 'Yes' : 'No', inline: true },
      {
        name: 'Account created',
        value: `<t:${Math.floor(target.createdTimestamp / 1000)}:R>`,
        inline: true,
      },
    ];

    if (member) {
      fields.push({
        name: 'Server joined',
        value: member.joinedTimestamp
          ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`
          : 'Unknown',
        inline: true,
      });
    }

    fields.push(
      { name: 'Level', value: String(info.level), inline: true },
      {
        name: 'XP',
        value: `${info.xpInLevel.toLocaleString()} / ${info.xpForNext.toLocaleString()}`,
        inline: true,
      },
      {
        name: 'Balance',
        value: `${(dbUser.balance ?? 0).toLocaleString()} coins`,
        inline: true,
      },
      {
        name: 'Bank',
        value: `${(dbUser.bank ?? 0).toLocaleString()} / ${(dbUser.bankLimit ?? 0).toLocaleString()}`,
        inline: true,
      },
    );

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setAuthor({ name: target.username, iconURL: target.displayAvatarURL() })
      .setThumbnail(target.displayAvatarURL({ size: 256 }))
      .addFields(fields)
      .setFooter({ text: '爱 Doctora • User Profile' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};
