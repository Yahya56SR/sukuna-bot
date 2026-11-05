import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, Colors } from 'discord.js';
import { Pet } from '../../db/models/Pet.js';
import { User } from '../../db/models/User.js';
import { recordActivity } from '../../core/metrics.js';
import type { Command } from '../../core/commands.js';

const petTypes: Record<string, { emoji: string; color: number }> = {
  dog: { emoji: '🐕', color: Colors.Blurple },
  cat: { emoji: '🐱', color: Colors.Purple },
  fox: { emoji: '🦊', color: Colors.Orange },
  dragon: { emoji: '🐉', color: Colors.Red },
  phoenix: { emoji: '🐦‍🔥', color: Colors.Orange },
  unicorn: { emoji: '🦄', color: Colors.Purple },
  slime: { emoji: '💚', color: Colors.Green },
  robot: { emoji: '🤖', color: Colors.Blue },
  ghost: { emoji: '👻', color: Colors.Purple },
  bunny: { emoji: '🐰', color: Colors.LuminousVividPink },
};

export const petCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('pet')
    .setDescription('Pet system')
    .addSubcommand(sub => sub
      .setName('adopt')
      .setDescription('Adopt a pet')
      .addStringOption(opt => opt
        .setName('name')
        .setDescription('Pet name')
        .setRequired(true)
        .setMaxLength(32)
      )
      .addStringOption(opt => opt
        .setName('type')
        .setDescription('Pet type')
        .setRequired(true)
        .addChoices(
          { name: 'Dog', value: 'dog' },
          { name: 'Cat', value: 'cat' },
          { name: 'Fox', value: 'fox' },
          { name: 'Dragon', value: 'dragon' },
          { name: 'Phoenix', value: 'phoenix' },
          { name: 'Unicorn', value: 'unicorn' },
          { name: 'Slime', value: 'slime' },
          { name: 'Robot', value: 'robot' },
          { name: 'Ghost', value: 'ghost' },
          { name: 'Bunny', value: 'bunny' },
        )
      )
    )
    .addSubcommand(sub => sub
      .setName('feed')
      .setDescription('Feed your pet')
    )
    .addSubcommand(sub => sub
      .setName('play')
      .setDescription('Play with your pet')
    )
    .addSubcommand(sub => sub
      .setName('profile')
      .setDescription('View pet profile')
      .addUserOption(opt => opt
        .setName('user')
        .setDescription('User to view')
        .setRequired(false)
      )
    )
    .addSubcommand(sub => sub
      .setName('battle')
      .setDescription('Battle another pet')
      .addUserOption(opt => opt
        .setName('user')
        .setDescription('Opponent to battle')
        .setRequired(true)
      )
    ),

  category: 'fun',
  cooldownSeconds: 3,

  async execute(context) {
    const { interaction, guild } = context;
    const guildId = guild.id;
    const userId = interaction.user.id;
    const sub = interaction.options.getSubcommand();

    if (sub === 'adopt') {
      const name = interaction.options.getString('name', true);
      const type = interaction.options.getString('type', true) as keyof typeof petTypes;

      const existing = await Pet.findOne({ userId, guildId });
      if (existing) {
        await interaction.reply({ content: '❌ You already have a pet!', ephemeral: true });
        return;
      }

      const pet = await Pet.create({
        userId,
        guildId,
        name,
        type: type as any,
        level: 1,
        xp: 0,
        hunger: 100,
        happiness: 100,
        health: 100,
        energy: 100,
      });

      const info = petTypes[type];
      const embed = new EmbedBuilder()
        .setColor(info.color)
        .setTitle('🐾 Pet Adopted!')
        .setDescription(`You adopted **${name}** the ${type}! ${info.emoji}`)
        .addFields(
          { name: 'Level', value: '1', inline: true },
          { name: 'XP', value: '0/100', inline: true },
          { name: 'Hunger', value: '100%', inline: true },
          { name: 'Happiness', value: '100%', inline: true },
          { name: 'Health', value: '100%', inline: true },
        );

      await interaction.reply({ embeds: [embed] });
      recordActivity('command', 'Pet adopted', { meta: { guildId, userId, type } });
      return;
    }

    if (sub === 'feed') {
      const pet = await Pet.findOne({ userId, guildId });
      if (!pet) {
        await interaction.reply({ content: '❌ You dont have a pet! Adopt one with /pet adopt.', ephemeral: true });
        return;
      }

      pet.hunger = Math.min(100, pet.hunger + 30);
      pet.happiness = Math.min(100, pet.happiness + 10);
      pet.lastFed = new Date();
      await pet.save();

      const embed = new EmbedBuilder()
        .setColor(Colors.Green)
        .setTitle('🍖 Pet Fed')
        .setDescription(`You fed **${pet.name}**!`)
        .addFields(
          { name: 'Hunger', value: `${pet.hunger}%`, inline: true },
          { name: 'Happiness', value: `${pet.happiness}%`, inline: true },
        );

      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (sub === 'play') {
      const pet = await Pet.findOne({ userId, guildId });
      if (!pet) {
        await interaction.reply({ content: '❌ You dont have a pet! Adopt one with /pet adopt.', ephemeral: true });
        return;
      }

      pet.happiness = Math.min(100, pet.happiness + 25);
      pet.hunger = Math.max(0, pet.hunger - 15);
      pet.energy = Math.max(0, pet.energy - 20);
      pet.lastPlayed = new Date();
      await pet.save();

      const embed = new EmbedBuilder()
        .setColor(Colors.Blue)
        .setTitle('🎾 Played with Pet')
        .setDescription(`You played with **${pet.name}**!`)
        .addFields(
          { name: 'Happiness', value: `${pet.happiness}%`, inline: true },
          { name: 'Hunger', value: `${pet.hunger}%`, inline: true },
          { name: 'Energy', value: `${pet.energy}%`, inline: true },
        );

      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (sub === 'profile') {
      const targetUser = interaction.options.getUser('user') ?? interaction.user;
      const pet = await Pet.findOne({ userId: targetUser.id, guildId });

      if (!pet) {
        await interaction.reply({ content: `${targetUser.tag} doesn't have a pet.`, ephemeral: true });
        return;
      }

      const info = petTypes[pet.type];
      const xpNeeded = pet.level * 100;
      const progress = Math.floor((pet.xp / xpNeeded) * 100);

      const embed = new EmbedBuilder()
        .setColor(info.color)
        .setTitle(`${info.emoji} ${pet.name}'s Profile`)
        .setThumbnail(targetUser.displayAvatarURL())
        .addFields(
          { name: 'Type', value: pet.type, inline: true },
          { name: 'Level', value: pet.level.toString(), inline: true },
          { name: 'XP', value: `${pet.xp}/${xpNeeded} (${progress}%)`, inline: true },
          { name: 'Hunger', value: `${pet.hunger}%`, inline: true },
          { name: 'Happiness', value: `${pet.happiness}%`, inline: true },
          { name: 'Health', value: `${pet.health}%`, inline: true },
          { name: 'Energy', value: `${pet.energy}%`, inline: true },
          { name: 'Wins', value: pet.wins.toString(), inline: true },
          { name: 'Losses', value: pet.losses.toString(), inline: true },
        )
        .setFooter({ text: `Owner: ${targetUser.tag}` });

      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (sub === 'battle') {
      const opponent = interaction.options.getUser('user', true);
      if (opponent.id === userId) {
        await interaction.reply({ content: '❌ You cannot battle yourself.', ephemeral: true });
        return;
      }

      const pet = await Pet.findOne({ userId, guildId });
      const opponentPet = await Pet.findOne({ userId: opponent.id, guildId });

      if (!pet || !opponentPet) {
        await interaction.reply({ content: '❌ Both users need pets to battle.', ephemeral: true });
        return;
      }

      const petPower = pet.level + pet.health / 10 + Math.random() * 10;
      const opponentPower = opponentPet.level + opponentPet.health / 10 + Math.random() * 10;

      let winner: string, loser: string;
      if (petPower > opponentPower) {
        winner = userId;
        loser = opponent.id;
        pet.wins++;
        opponentPet.losses++;
      } else {
        winner = opponent.id;
        loser = userId;
        opponentPet.wins++;
        pet.losses++;
      }

      const winnerPet = winner === userId ? pet : opponentPet;
      winnerPet.xp += 50;
      if (winnerPet.xp >= winnerPet.level * 100) {
        winnerPet.level++;
        winnerPet.xp = 0;
      }

      await pet.save();
      await opponentPet.save();

      const winnerUser = winner === userId ? interaction.user : opponent;
      const embed = new EmbedBuilder()
        .setColor(Colors.Blurple)
        .setTitle('⚔️ Pet Battle!')
        .setDescription(`**${pet.name}** vs **${opponentPet.name}**\n\nWinner: **${winnerUser.tag}**!`)
        .addFields(
          { name: `${pet.name}`, value: `Level ${pet.level} - ${Math.floor(petPower)} power`, inline: true },
          { name: `${opponentPet.name}`, value: `Level ${opponentPet.level} - ${Math.floor(opponentPower)} power`, inline: true },
        );

      await interaction.reply({ embeds: [embed] });
      recordActivity('command', 'Pet battle', { meta: { guildId, userId, opponentId: opponent.id } });
      return;
    }
  },
};