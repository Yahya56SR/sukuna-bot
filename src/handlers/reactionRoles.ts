import { ReactionRolePanel, type IReactionRolePanel, type IReactionRoleOption } from '../db/models/ReactionRolePanel.js';
import { recordActivity } from '../core/metrics.js';
import { Guild, TextChannel, User, EmbedBuilder, Colors, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ComponentType, ButtonInteraction, StringSelectMenuInteraction, GuildMember, Role, Message } from 'discord.js';

/** Get panel by message ID */
async function getPanelByMessageId(messageId: string) {
  const panel = await ReactionRolePanel.findOne({ messageId, active: true }).lean();
  return panel;
}

/** Get panel by guild and channel */
async function getPanelByChannel(guildId: string, channelId: string) {
  return ReactionRolePanel.findOne({ guildId, channelId, active: true }).lean();
}

/** Build panel embed */
function buildPanelEmbed(panel: IReactionRolePanel): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(panel.title)
    .setDescription(panel.description || 'Click buttons below to get roles!')
    .setColor(panel.color || Colors.Blurple)
    .setTimestamp();

  if (panel.thumbnail) embed.setThumbnail(panel.thumbnail);
  if (panel.image) embed.setImage(panel.image);

  if (panel.options.length > 0) {
    const optionsText = panel.options
      .map((opt) => {
        const roleMention = `<@&${opt.roleId}>`;
        return `${opt.emoji} **${opt.label || roleMention}**${opt.description ? ` — ${opt.description}` : ''}`;
      })
      .join('\n');
    embed.addFields({ name: 'Available Roles', value: optionsText });
  }

  if (panel.mode === 'temporary' && panel.temporaryDuration) {
    const hours = Math.floor(panel.temporaryDuration / 3600);
    const minutes = Math.floor((panel.temporaryDuration % 3600) / 60);
    embed.setFooter({ text: `Temporary roles last: ${hours}h ${minutes}m` });
  }

  return embed;
}

/** Build panel components (buttons or select menu) */
function buildPanelComponents(panel: IReactionRolePanel): ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];

  if (panel.useButtons) {
    // Buttons (max 5 per row, 25 total)
    const styleMap: Record<number, ButtonStyle> = {
      1: ButtonStyle.Primary,
      2: ButtonStyle.Secondary,
      3: ButtonStyle.Success,
      4: ButtonStyle.Danger,
    };
    const buttonStyle = styleMap[panel.buttonStyle || 2] || ButtonStyle.Secondary;

    let currentRow = new ActionRowBuilder<ButtonBuilder>();
    let buttonCount = 0;

    for (const opt of panel.options.slice(0, 25)) {
      const button = new ButtonBuilder()
        .setCustomId(`rr:${panel._id}:${opt.roleId}`)
        .setLabel(opt.label || `Role ${opt.roleId.slice(-4)}`)
        .setEmoji(opt.emoji)
        .setStyle(buttonStyle);

      currentRow.addComponents(button);
      buttonCount++;

      if (buttonCount === 5) {
        rows.push(currentRow);
        currentRow = new ActionRowBuilder<ButtonBuilder>();
        buttonCount = 0;
      }
    }

    if (buttonCount > 0) {
      rows.push(currentRow);
    }
  } else {
    // Select menu (max 25 options)
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`rr_select:${panel._id}`)
      .setPlaceholder(panel.selectPlaceholder || 'Select a role...')
      .setMinValues(panel.minSelect || 1)
      .setMaxValues(panel.maxSelect || 1)
      .addOptions(
        panel.options.slice(0, 25).map((opt) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(opt.label || `Role ${opt.roleId.slice(-4)}`)
            .setDescription(opt.description || '')
            .setValue(opt.roleId)
            .setEmoji(opt.emoji)
        )
      );

    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu));
  }

  return rows;
}

/** Send panel to channel */
export async function sendPanel(panel: IReactionRolePanel, channel: TextChannel): Promise<Message | null> {
  try {
    const embed = buildPanelEmbed(panel);
    const components = buildPanelComponents(panel);

    const message = await channel.send({ embeds: [embed], components });

    // Update panel with message ID
    await ReactionRolePanel.updateOne({ _id: panel._id }, { messageId: message.id });

    recordActivity('command', `Panel sent: ${panel.title}`, {
      level: 'success',
      meta: { guildId: panel.guildId, panelId: String(panel._id), channelId: channel.id },
    });

    return message;
  } catch (error) {
    console.error('[ReactionRoles] Failed to send panel:', error);
    return null;
  }
}

/** Handle button interaction */
export async function handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
  const parts = interaction.customId.split(':');
  if (parts[0] !== 'rr' || parts.length < 3) return;

  const [, panelId, roleId] = parts;
  if (!panelId || !roleId) return;

  const panel = await ReactionRolePanel.findById(panelId).lean();
  if (!panel || !panel.active) return;

  const guild = interaction.guild!;
  const member = interaction.member as GuildMember;
  const role = guild.roles.cache.get(roleId);

  if (!role) {
    await interaction.reply({ content: 'Role not found', ephemeral: true });
    return;
  }

  // Check binding role requirement
  if (panel.mode === 'binding' && panel.bindingRoleId) {
    const bindingRole = guild.roles.cache.get(panel.bindingRoleId);
    if (bindingRole && !member.roles.cache.has(bindingRole.id)) {
      await interaction.reply({ content: 'You need the required role to use this button', ephemeral: true });
      return;
    }
  }

  const botMember = guild.members.me;
  if (!botMember || role.position >= botMember.roles.highest.position) {
    await interaction.reply({ content: 'I cannot manage this role (hierarchy)', ephemeral: true });
    return;
  }

  try {
    const hasRole = member.roles.cache.has(role.id);

    switch (panel.mode) {
      case 'unique': {
        if (!hasRole) {
          // Remove other roles from this panel first
          const otherRoles = panel.options.map(o => o.roleId).filter(id => id !== roleId);
          for (const otherRoleId of otherRoles) {
            if (member.roles.cache.has(otherRoleId)) {
              await member.roles.remove(otherRoleId, 'Unique reaction role');
              await logRoleChange(panel.guildId, member.id, otherRoleId, 'removed (unique)');
            }
          }

          await member.roles.add(role, 'Reaction role (button)');
          await logRoleChange(panel.guildId, member.id, role.id, 'added');
          await interaction.reply({ content: `✅ Added role **${role.name}**`, ephemeral: true });

          if (panel.dmUser) {
            await member.send(`Added role **${role.name}** in **${guild.name}**`).catch(() => {});
          }

          // Handle temporary roles
          if (panel.temporaryDuration) {
            setTimeout(async () => {
              const freshMember = await guild.members.fetch(member.id).catch(() => null);
              if (freshMember?.roles.cache.has(role.id)) {
                await freshMember.roles.remove(role, 'Temporary reaction role expired');
                await logRoleChange(panel.guildId, member.id, role.id, 'removed (expired)');
              }
            }, panel.temporaryDuration * 1000);
          }
        } else {
          await interaction.reply({ content: `ℹ️ You already have **${role.name}**`, ephemeral: true });
        }
        break;
      }

      case 'verify': {
        if (!hasRole) {
          await member.roles.add(role, 'Verification role');
          await logRoleChange(panel.guildId, member.id, role.id, 'added (verify)');
          await interaction.reply({ content: `✅ Verified! Added role **${role.name}**`, ephemeral: true });

          if (panel.dmUser) {
            await member.send(`You've been verified in **${guild.name}**`).catch(() => {});
          }
        } else {
          await interaction.reply({ content: `ℹ️ Already verified`, ephemeral: true });
        }
        break;
      }

      case 'reversed': {
        if (hasRole) {
          await member.roles.remove(role, 'Reaction role (reversed)');
          await logRoleChange(panel.guildId, member.id, role.id, 'removed');
          await interaction.reply({ content: `✅ Removed role **${role.name}**`, ephemeral: true });

          if (panel.dmUser) {
            await member.send(`Removed role **${role.name}** in **${guild.name}**`).catch(() => {});
          }
        } else {
          await interaction.reply({ content: `ℹ️ You don't have **${role.name}**`, ephemeral: true });
        }
        break;
      }

      case 'temporary': {
        if (!hasRole) {
          await member.roles.add(role, 'Temporary reaction role');
          await logRoleChange(panel.guildId, member.id, role.id, 'added (temporary)');
          await interaction.reply({ content: `✅ Added temporary role **${role.name}**`, ephemeral: true });

          if (panel.dmUser) {
            await member.send(`Added temporary role **${role.name}** in **${guild.name}**`).catch(() => {});
          }

          setTimeout(async () => {
            const freshMember = await guild.members.fetch(member.id).catch(() => null);
            if (freshMember?.roles.cache.has(role.id)) {
              await freshMember.roles.remove(role, 'Temporary reaction role expired');
              await logRoleChange(panel.guildId, member.id, role.id, 'removed (expired)');
            }
          }, panel.temporaryDuration! * 1000);
        } else {
          await interaction.reply({ content: `ℹ️ You already have **${role.name}**`, ephemeral: true });
        }
        break;
      }

      default: { // normal toggle mode
        if (hasRole) {
          await member.roles.remove(role, 'Reaction role toggle');
          await logRoleChange(panel.guildId, member.id, role.id, 'removed');
          await interaction.reply({ content: `✅ Removed role **${role.name}**`, ephemeral: true });
        } else {
          await member.roles.add(role, 'Reaction role toggle');
          await logRoleChange(panel.guildId, member.id, role.id, 'added');
          await interaction.reply({ content: `✅ Added role **${role.name}**`, ephemeral: true });
        }
      }
    }

    if (panel.dmUser) {
      // DM already sent in each case
    }
  } catch (error) {
    console.error('[ReactionRoles] Button interaction failed:', error);
    await interaction.reply({ content: 'Failed to manage role', ephemeral: true });
  }
}

/** Handle select menu interaction */
export async function handleSelectMenuInteraction(interaction: StringSelectMenuInteraction): Promise<void> {
  const panelId = interaction.customId.replace('rr_select:', '');
  const panel = await ReactionRolePanel.findById(panelId).lean();
  if (!panel || !panel.active || panel.useButtons) return;

  const guild = interaction.guild!;
  const member = interaction.member as GuildMember;
  const selectedRoleIds = interaction.values;

  const botMember = guild.members.me;
  if (!botMember) return;

  // Validate roles
  const roles = selectedRoleIds
    .map(id => guild.roles.cache.get(id))
    .filter((r): r is Role => r !== undefined && r.position < botMember.roles.highest.position);

  if (roles.length === 0) {
    await interaction.reply({ content: 'No valid roles selected', ephemeral: true });
    return;
  }

  try {
    const added: string[] = [];
    const removed: string[] = [];

    if (panel.mode === 'unique') {
      // Remove all other panel roles first
      const allPanelRoles = panel.options.map(o => o.roleId);
      for (const roleId of allPanelRoles) {
        if (member.roles.cache.has(roleId) && !selectedRoleIds.includes(roleId)) {
          await member.roles.remove(roleId, 'Unique reaction role (select)');
          removed.push(roleId);
          await logRoleChange(panel.guildId, member.id, roleId, 'removed');
        }
      }

      // Add selected roles
      for (const role of roles) {
        if (!member.roles.cache.has(role.id)) {
          await member.roles.add(role, 'Reaction role (select)');
          added.push(role.name);
          await logRoleChange(panel.guildId, member.id, role.id, 'added');
        }
      }
    } else {
      // Toggle roles
      for (const role of roles) {
        if (member.roles.cache.has(role.id)) {
          await member.roles.remove(role, 'Reaction role toggle');
          removed.push(role.name);
          await logRoleChange(panel.guildId, member.id, role.id, 'removed');
        } else {
          await member.roles.add(role, 'Reaction role toggle');
          added.push(role.name);
          await logRoleChange(panel.guildId, member.id, role.id, 'added');
        }
      }
    }

    let reply = '';
    if (added.length) reply += `✅ Added: ${added.join(', ')}\n`;
    if (removed.length) reply += `❌ Removed: ${removed.join(', ')}`;
    if (!reply) reply = 'No changes made';

    await interaction.reply({ content: reply, ephemeral: true });

    if (panel.dmUser && (added.length || removed.length)) {
      const dmText = [
        added.length ? `Added: ${added.join(', ')}` : '',
        removed.length ? `Removed: ${removed.join(', ')}` : '',
      ].filter(Boolean).join('\n');
      await member.send(dmText).catch(() => {});
    }
  } catch (error) {
    console.error('[ReactionRoles] Select menu failed:', error);
    await interaction.reply({ content: 'Failed to manage roles', ephemeral: true });
  }
}

/** Log role change */
async function logRoleChange(guildId: string, userId: string, roleId: string, action: string): Promise<void> {
  // In production, send to log channel if configured
  // For now just record activity
  recordActivity('command', `Role ${action}`, {
    level: 'info',
    meta: { guildId, userId, roleId, action },
  });
}

/** Initialize panels on startup */
export async function initReactionRoles(guild: Guild): Promise<void> {
  const panels = await ReactionRolePanel.find({ guildId: guild.id, active: true }).lean();
  for (const panel of panels) {
    const channel = guild.channels.cache.get(panel.channelId) as TextChannel;
    if (!channel) continue;

    // Try to fetch existing message
    if (panel.messageId) {
      try {
        const message = await channel.messages.fetch(panel.messageId);
        // Verify components are still valid
        continue;
      } catch {
        // Message deleted, resend
        await sendPanel(panel, channel);
      }
    } else {
      await sendPanel(panel, channel);
    }
  }
}