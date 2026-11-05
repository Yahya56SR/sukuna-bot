import { SlashCommandBuilder, AutocompleteInteraction, ChatInputCommandInteraction, EmbedBuilder, Colors, GuildMember, TextChannel } from 'discord.js';
import { InviteTracker } from '../../db/models/InviteTracker.js';
import { recordActivity } from '../../core/metrics.js';
import type { Command } from '../../core/commands.js';

export const invitesCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('invites')
    .setDescription('Invite tracking system')
    .addSubcommand(sub => sub
      .setName('leaderboard')
      .setDescription('Show top inviters')
      .addIntegerOption(opt => opt
        .setName('limit')
        .setDescription('Number of users to show')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(50)
      )
    )
    .addSubcommand(sub => sub
      .setName('info')
      .setDescription('Show invite info for a user')
      .addUserOption(opt => opt
        .setName('user')
        .setDescription('User to check')
        .setRequired(false)
      )
    )
    .addSubcommand(sub => sub
      .setName('add')
      .setDescription('Add bonus invites to a user (admin)')
      .addUserOption(opt => opt
        .setName('user')
        .setDescription('User to add invites to')
        .setRequired(true)
      )
      .addIntegerOption(opt => opt
        .setName('amount')
        .setDescription('Number of invites to add')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(1000)
      )
    )
    .addSubcommand(sub => sub
      .setName('remove')
      .setDescription('Remove bonus invites from a user (admin)')
      .addUserOption(opt => opt
        .setName('user')
        .setDescription('User to remove invites from')
        .setRequired(true)
      )
      .addIntegerOption(opt => opt
        .setName('amount')
        .setDescription('Number of invites to remove')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(1000)
      )
    )
    .addSubcommand(sub => sub
      .setName('reset')
      .setDescription('Reset a user\'s invites (admin)')
      .addUserOption(opt => opt
        .setName('user')
        .setDescription('User to reset')
        .setRequired(true)
      )
    )
    .addSubcommand(sub => sub
      .setName('sync')
      .setDescription('Sync invites from Discord (admin)')
    )
    .addSubcommand(sub => sub
      .setName('vanity')
      .setDescription('Show vanity URL info')
    ),

  category: 'utility',
  cooldownSeconds: 5,
  userPermissions: ['ManageGuild'],
  botPermissions: ['ManageGuild'],

  async execute(context) {
    const { interaction, guild } = context;
    const guildId = guild.id;
    const sub = interaction.options.getSubcommand();

    if (sub === 'leaderboard') {
      const limit = interaction.options.getInteger('limit') ?? 10;

      const invites = await InviteTracker.aggregate([
        { $match: { guildId } },
        { $group: { _id: '$inviterId', totalInvites: { $sum: '$uses' }, codes: { $sum: 1 } } },
        { $sort: { totalInvites: -1 } },
        { $limit: limit },
      ]);

      if (!invites.length) {
        await interaction.reply({ content: 'No invite data yet', ephemeral: true });
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(Colors.Gold)
        .setTitle('🏆 Invite Leaderboard')
        .setDescription(
          invites.map((inv, i) => {
            const member = guild.members.cache.get(inv._id);
            const name = member ? member.user.tag : `Unknown (${inv._id})`;
            return `**${i + 1}.** ${name} — **${inv.totalInvites}** invites (${inv.codes} codes)`;
          }).join('\n')
        )
        .setFooter({ text: `Top ${limit} inviters` });

      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (sub === 'info') {
      const user = interaction.options.getUser('user') ?? interaction.user;

      const invites = await InviteTracker.find({ guildId, inviterId: user.id }).lean();
      const totalInvites = invites.reduce((sum, i) => sum + (i.uses ?? 0), 0);
      const totalCodes = invites.length;

      // Also count left members
      let leftCount = 0;
      let joinedCount = 0;
      for (const inv of invites) {
        for (const m of inv.members) {
          if (m.leftAt) leftCount++;
          else joinedCount++;
        }
      }

      const embed = new EmbedBuilder()
        .setColor(Colors.Blurple)
        .setTitle(`📨 Invites for ${user.tag}`)
        .setThumbnail(user.displayAvatarURL())
        .addFields(
          { name: 'Total Invites', value: totalInvites.toString(), inline: true },
          { name: 'Active Members', value: joinedCount.toString(), inline: true },
          { name: 'Left Members', value: leftCount.toString(), inline: true },
          { name: 'Invite Codes', value: totalCodes.toString(), inline: true },
        );

      if (invites.length) {
        const codeList = invites
          .sort((a, b) => (b.uses ?? 0) - (a.uses ?? 0))
          .slice(0, 10)
          .map(i => `\`${i.code}\` — ${i.uses ?? 0} uses${i.vanity ? ' (vanity)' : ''}`)
          .join('\n');
        embed.addFields({ name: 'Top Codes', value: codeList || 'None', inline: false });
      }

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    if (sub === 'add') {
      if (!interaction.memberPermissions?.has('Administrator')) {
        await interaction.reply({ content: 'Administrator permission required', ephemeral: true });
        return;
      }

      const user = interaction.options.getUser('user', true);
      const amount = interaction.options.getInteger('amount', true);

      // Find or create a "bonus" invite code entry
      let bonusInvite = await InviteTracker.findOne({ guildId, inviterId: user.id, code: 'bonus' });
      if (!bonusInvite) {
        bonusInvite = await InviteTracker.create({
          guildId,
          code: 'bonus',
          inviterId: user.id,
          uses: 0,
          maxUses: 0,
          temporary: false,
          channelId: '0',
          vanity: false,
          members: [],
        });
      }

      bonusInvite.uses += amount;
      await bonusInvite.save();

      await interaction.reply({ content: `✅ Added **${amount}** bonus invites to ${user.tag} (total: ${bonusInvite.uses})`, ephemeral: true });
      return;
    }

    if (sub === 'remove') {
      if (!interaction.memberPermissions?.has('Administrator')) {
        await interaction.reply({ content: 'Administrator permission required', ephemeral: true });
        return;
      }

      const user = interaction.options.getUser('user', true);
      const amount = interaction.options.getInteger('amount', true);

      const bonusInvite = await InviteTracker.findOne({ guildId, inviterId: user.id, code: 'bonus' });
      if (!bonusInvite) {
        await interaction.reply({ content: 'No bonus invites found for this user', ephemeral: true });
        return;
      }

      bonusInvite.uses = Math.max(0, bonusInvite.uses - amount);
      await bonusInvite.save();

      await interaction.reply({ content: `✅ Removed **${amount}** bonus invites from ${user.tag} (total: ${bonusInvite.uses})`, ephemeral: true });
      return;
    }

    if (sub === 'reset') {
      if (!interaction.memberPermissions?.has('Administrator')) {
        await interaction.reply({ content: 'Administrator permission required', ephemeral: true });
        return;
      }

      const user = interaction.options.getUser('user', true);

      await InviteTracker.deleteMany({ guildId, inviterId: user.id });

      await interaction.reply({ content: `✅ Reset all invites for ${user.tag}`, ephemeral: true });
      return;
    }

    if (sub === 'sync') {
      if (!interaction.memberPermissions?.has('Administrator')) {
        await interaction.reply({ content: 'Administrator permission required', ephemeral: true });
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      try {
        const discordInvites = await guild.invites.fetch();
        let synced = 0;

        for (const [code, invite] of discordInvites) {
          const existing = await InviteTracker.findOne({ guildId, code });
          if (existing) {
            existing.uses = invite.uses ?? 0;
            existing.maxUses = invite.maxUses ?? 0;
            existing.temporary = invite.temporary ?? false;
            existing.channelId = invite.channelId ?? '0';
            existing.vanity = invite.guild?.vanityURLCode === code;
            await existing.save();
          } else {
            await InviteTracker.create({
              guildId,
              code,
              inviterId: invite.inviter?.id || 'unknown',
              uses: invite.uses ?? 0,
              maxUses: invite.maxUses ?? 0,
              temporary: invite.temporary ?? false,
              channelId: invite.channelId ?? '0',
              vanity: invite.guild?.vanityURLCode === code,
              members: [],
            });
          }
          synced++;
        }

        await interaction.editReply({ content: `✅ Synced **${synced}** invite codes` });
      } catch (error) {
        await interaction.editReply({ content: `❌ Sync failed: ${error}` });
      }
      return;
    }

    if (sub === 'vanity') {
      const vanityCode = guild.vanityURLCode;
      if (!vanityCode) {
        await interaction.reply({ content: 'This server has no vanity URL', ephemeral: true });
        return;
      }

      const vanityInvite = await InviteTracker.findOne({ guildId, code: vanityCode, vanity: true }).lean();
      const uses = (vanityInvite?.uses ?? 0) as number;

      const embed = new EmbedBuilder()
        .setColor(Colors.Gold)
        .setTitle('🌟 Vanity URL')
        .addFields(
          { name: 'Code', value: `discord.gg/${vanityCode}`, inline: true },
          { name: 'Total Uses', value: uses.toString(), inline: true },
          { name: 'URL', value: `https://discord.gg/${vanityCode}`, inline: false },
        );

      await interaction.reply({ embeds: [embed] });
      return;
    }
  },
};

// Invite tracking handler (call from guildMemberAdd/guildMemberRemove)
export async function trackInviteJoin(member: GuildMember): Promise<void> {
  const guildId = member.guild.id;

  // Fetch current invites
  const currentInvites = await member.guild.invites.fetch();

  // Find which invite was used (compare with stored)
  const storedInvites = await InviteTracker.find({ guildId }).lean();

  for (const stored of storedInvites) {
    const current = currentInvites.get(stored.code);
    if (current && (current.uses ?? 0) > (stored.uses ?? 0)) {
      // This invite was used!
      const newUses = current.uses ?? 0;
      stored.uses = newUses;
      stored.members.push({
        userId: member.id,
        joinedAt: new Date(),
        fake: false,
      });
      await InviteTracker.updateOne({ _id: stored._id }, { $set: { uses: stored.uses, members: stored.members } });

      recordActivity('command', 'Member joined via invite', {
        meta: { guildId, inviterId: stored.inviterId, code: stored.code, memberId: member.id },
      });
      break;
    }
  }

  // Also check vanity
  if (member.guild.vanityURLCode) {
    const vanityStored = await InviteTracker.findOne({ guildId, code: member.guild.vanityURLCode, vanity: true });
    if (vanityStored) {
      // Can't track vanity uses easily, but we can track member
      if (!vanityStored.members.some(m => m.userId === member.id && !m.leftAt)) {
        vanityStored.members.push({
          userId: member.id,
          joinedAt: new Date(),
          fake: false,
        });
        await vanityStored.save();
      }
    }
  }
}

export async function trackInviteLeave(member: GuildMember): Promise<void> {
  const guildId = member.guild.id;

  // Find which invite they used
  const storedInvites = await InviteTracker.find({ guildId, 'members.userId': member.id, 'members.leftAt': { $exists: false } }).lean();

  for (const stored of storedInvites) {
    const memberEntry = stored.members.find(m => m.userId === member.id && !m.leftAt);
    if (memberEntry) {
      memberEntry.leftAt = new Date();
      memberEntry.fake = memberEntry.fake || (Date.now() - memberEntry.joinedAt.getTime() < 24 * 60 * 60 * 1000); // Left within 24h = potential fake
      await InviteTracker.updateOne({ _id: stored._id }, { $set: { members: stored.members } });
    }
  }
}