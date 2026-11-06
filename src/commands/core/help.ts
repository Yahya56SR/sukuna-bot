import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ActionRowBuilder,
} from 'discord.js';
import type { Command } from '../../core/commands.js';
import { DEFAULT_DISPLAY_NAME, getSukunaConfig } from '../../config/index.js';

const HELP_COLOR = 0x5865f2;
const COLLECTOR_TIMEOUT_MS = 300_000; // 5 minutes

interface HelpCategory {
  id: string;
  label: string;
  emoji: string;
  description: string;
}

const CATEGORIES: HelpCategory[] = [
  { id: 'core', label: 'Core', emoji: '🔧', description: 'Essential bot utilities' },
  { id: 'moderation', label: 'Moderation', emoji: '🛡️', description: 'Server moderation tools' },
  { id: 'economy', label: 'Economy', emoji: '💰', description: 'Coins, bank, and casino games' },
  { id: 'fun', label: 'Fun', emoji: '🎉', description: 'Games and social commands' },
  { id: 'leveling', label: 'Leveling', emoji: '📊', description: 'XP, ranks, and leaderboards' },
  { id: 'utility', label: 'Utility', emoji: '🛠️', description: 'Server tools and features' },
  { id: 'tickets', label: 'Tickets', emoji: '🎫', description: 'Support ticket system' },
  { id: 'music', label: 'Music', emoji: '🎵', description: 'Music playback commands' },
];

const CATEGORY_BY_ID = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c]),
) as Record<string, HelpCategory>;

export const helpCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Browse all available commands by category.')
    .setDMPermission(false),
  category: 'utility',
  cooldownSeconds: 10,
  execute: async (context) => {
    const { client, interaction } = context;
    const name = getSukunaConfig().displayName || DEFAULT_DISPLAY_NAME;

    // Group commands by category, sorted alphabetically within each category.
    const commandsByCategory = new Map<string, Command[]>();
    for (const command of client.commands.values()) {
      const bucket = commandsByCategory.get(command.category) ?? [];
      bucket.push(command);
      commandsByCategory.set(command.category, bucket);
    }
    for (const bucket of commandsByCategory.values()) {
      bucket.sort((a, b) => a.data.name.localeCompare(b.data.name));
    }

    const presentCategories = CATEGORIES.filter((c) =>
      commandsByCategory.has(c.id),
    );

    const buildSelectMenu = (activeId: string | null, disabled = false) => {
      const rows = [
        new StringSelectMenuOptionBuilder()
          .setLabel('Home')
          .setDescription('Overview of every command category')
          .setValue('home')
          .setEmoji('🏠')
          .setDefault(activeId === null),
        ...presentCategories.map((c) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(c.label)
            .setDescription(c.description)
            .setValue(c.id)
            .setEmoji(c.emoji)
            .setDefault(activeId === c.id),
        ),
      ];
      return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('help:menu')
          .setPlaceholder('Choose a category…')
          .setDisabled(disabled)
          .addOptions(rows),
      );
    };

    const buildHomeEmbed = () =>
      new EmbedBuilder()
        .setColor(HELP_COLOR)
        .setTitle(`📖 ${name} — Commands`)
        .setDescription(
          'Select a category from the dropdown menu below to browse that category’s commands.',
        )
        .addFields(
          presentCategories.map((c) => ({
            name: `${c.emoji} ${c.label}`,
            value: `${c.description}\n${commandsByCategory.get(c.id)!.length} commands`,
            inline: true,
          })),
        )
        .setFooter({ text: `${client.commands.size} total commands • ${name}` })
        .setTimestamp();

    const buildCategoryEmbed = (catId: string) => {
      const cat = CATEGORY_BY_ID[catId];
      const cmds = commandsByCategory.get(catId) ?? [];
      return new EmbedBuilder()
        .setColor(HELP_COLOR)
        .setTitle(`${cat.emoji} ${cat.label} Commands`)
        .setDescription(cat.description)
        .addFields(
          cmds.map((c) => ({
            name: `/${c.data.name}`,
            value: c.data.description || 'No description set.',
            inline: false,
          })),
        )
        .setFooter({ text: `${cmds.length} commands • ${name}` })
        .setTimestamp();
    };

    const sent = (await interaction.reply({
      embeds: [buildHomeEmbed()],
      components: [buildSelectMenu(null)],
      flags: MessageFlags.Ephemeral,
      fetchReply: true,
    })) as { edit: (opts: any) => Promise<unknown> };

    const channel = interaction.channel;
    if (!channel || !('createMessageComponentCollector' in channel)) return;

    const filter = (i: any) =>
      i.user.id === interaction.user.id &&
      i.customId === 'help:menu' &&
      i.isStringSelectMenu();

    const collector = channel.createMessageComponentCollector({
      filter,
      time: COLLECTOR_TIMEOUT_MS,
    });

    collector.on('collect', async (i: any) => {
      await i.deferUpdate();
      const value = i.values[0];
      const embed = value === 'home' ? buildHomeEmbed() : buildCategoryEmbed(value);
      const active = value === 'home' ? null : value;
      await i.update({ embeds: [embed], components: [buildSelectMenu(active)] });
    });

    collector.on('end', () => {
      void sent.edit({ components: [buildSelectMenu(null, true)] }).catch(() => undefined);
    });
  },
};
