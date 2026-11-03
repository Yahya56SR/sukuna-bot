import { Events } from "discord.js";
import { getGuild } from "../utils";

export default {
  name: Events.InteractionCreate,
  execute: async (client: any, interaction: any) => {
    if (interaction.isChatInputCommand()) {
      await handleSlashCommand(client, interaction);
    } else if (interaction.isButton()) {
      await handleButton(client, interaction);
    } else if (interaction.isStringSelectMenu()) {
      await handleSelectMenu(client, interaction);
    } else if (interaction.isModalSubmit()) {
      await handleModal(client, interaction);
    }
  },
};

async function handleSlashCommand(client: any, interaction: any) {
  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  // Defer if the command might take time (optional, handled per command)
  const guild = interaction.guild ? await getGuild(interaction.guild.id) : null;

  // Check module enabled
  if (guild && command.category) {
    const moduleMap: Record<string, string> = {
      Moderation: "moderation",
      Economy: "economy",
      Leveling: "leveling",
      Tickets: "tickets",
      Music: "music",
      Fun: "fun",
      Utility: "utility",
    };
    const moduleKey = moduleMap[command.category];
    if (moduleKey && (guild.modules as any)[moduleKey] === false) {
      return interaction.reply({
        content: `❌ The **${command.category}** module is disabled on this server.`,
        ephemeral: true,
      });
    }
  }

  // Owner-only check
  if (command.ownerOnly && !client.owners.includes(interaction.user.id)) {
    return interaction.reply({ content: "❌ This command is bot owner only.", ephemeral: true });
  }

  // User permission check
  if (command.userPermissions && interaction.guild) {
    const member = interaction.guild.members.cache.get(interaction.user.id) || interaction.member;
    const missing = command.userPermissions.filter((perm: string) => !member.permissions.has(perm));
    if (missing.length > 0) {
      return interaction.reply({
        content: `❌ You need the following permissions: ${missing.join(", ")}`,
        ephemeral: true,
      });
    }
  }

  // Bot permission check
  if (command.botPermissions && interaction.guild) {
    const botMember = interaction.guild.members.cache.get(client.user.id);
    const missing = command.botPermissions.filter((perm: string) => !botMember.permissions.has(perm));
    if (missing.length > 0) {
      return interaction.reply({
        content: `❌ I need the following permissions: ${missing.join(", ")}`,
        ephemeral: true,
      });
    }
  }

  // Cooldown check
  const cooldownKey = `${interaction.user.id}:${command.data.name}`;
  const now = Date.now();
  const timestamps = client.cooldowns || new Map();
  client.cooldowns = timestamps;

  if (command.cooldown && timestamps.has(cooldownKey)) {
    const expirationTime = timestamps.get(cooldownKey) + command.cooldown * 1000;
    if (now < expirationTime) {
      const timeLeft = Math.ceil((expirationTime - now) / 1000);
      return interaction.reply({
        content: `⏳ Please wait ${timeLeft}s before using this command again.`,
        ephemeral: true,
      });
    }
  }

  if (command.cooldown) {
    timestamps.set(cooldownKey, now);
    setTimeout(() => timestamps.delete(cooldownKey), command.cooldown * 1000);
  }

  try {
    await command.execute(client, interaction, guild);
  } catch (error) {
    console.error(`[Command Error] ${command.data.name}:`, error);
    const replyContent = "❌ An error occurred while executing this command.";
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: replyContent, ephemeral: true }).catch(() => {});
    } else {
      await interaction.reply({ content: replyContent, ephemeral: true }).catch(() => {});
    }
  }
}

async function handleButton(client: any, interaction: any) {
  const customId = interaction.customId;

  // Ticket close
  if (customId.startsWith("ticket_close")) {
    await interaction.deferReply({ ephemeral: true });
    await interaction.channel?.delete().catch(() => {});
    return;
  }

  // Ticket claim
  if (customId.startsWith("ticket_claim")) {
    await interaction.deferReply({ ephemeral: true });
    await interaction.channel?.setName(`claimed-${interaction.channel.name}`).catch(() => {});
    return interaction.editReply("✅ Ticket claimed.");
  }

  // Reaction role remove/add is handled in select menu
}

async function handleSelectMenu(client: any, interaction: any) {
  const customId = interaction.customId;

  if (customId === "reaction_role_menu") {
    await interaction.deferReply({ ephemeral: true });
    const selected = interaction.values;
    const member = interaction.member;
    const guild = interaction.guild;

    const added: string[] = [];
    const removed: string[] = [];

    for (const roleId of selected) {
      const role = guild.roles.cache.get(roleId);
      if (!role) continue;
      if (member.roles.cache.has(roleId)) {
        await member.roles.remove(roleId);
        removed.push(role.name);
      } else {
        await member.roles.add(roleId);
        added.push(role.name);
      }
    }

    let msg = "";
    if (added.length) msg += `✅ Added: ${added.join(", ")}\n`;
    if (removed.length) msg += `➖ Removed: ${removed.join(", ")}`;
    if (!msg) msg = "No changes made.";
    return interaction.editReply({ content: msg, ephemeral: true });
  }
}

async function handleModal(client: any, interaction: any) {
  // Placeholder for modal submissions (e.g., ticket reason)
  await interaction.reply({ content: "Modal received.", ephemeral: true });
}
