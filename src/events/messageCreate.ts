import { Events, type ClientEvents } from 'discord.js';
import { getUser, xpForLevel } from '../db/index.js';
import { handleMessage, isSukunaActive } from '../utils/sukuna.js';

export const messageCreate = {
  name: Events.MessageCreate as keyof ClientEvents,
  execute: async (client: any, message: any) => {
    // Run Sukuna AI persona
    handleMessage(message);

    if (message.author.bot) return;
    if (!message.guild) return;

    const guild = message.guild;
    const config = await client.getConfig(guild.id);

    // Leveling always on unless explicitly disabled
    if (config.modules?.leveling === false) return;

    // Cooldown per user
    const cooldownKey = `xp_${message.author.id}`;
    const now = Date.now();
    const xpCooldowns: Map<string, number> = client.xpCooldowns || new Map();
    client.xpCooldowns = xpCooldowns;

    const cooldownSeconds = config.xpCooldown ?? 60;
    if (xpCooldowns.has(cooldownKey)) {
      if (now - xpCooldowns.get(cooldownKey)! < cooldownSeconds * 1000) return;
    }
    xpCooldowns.set(cooldownKey, now);

    const xpGain = Math.floor(Math.random() * ((config.xpMax ?? 25) - (config.xpMin ?? 15) + 1)) + (config.xpMin ?? 15);

    const user = await getUser(message.author.id);
    const oldLevel = user.level;
    user.xp += xpGain;
    user.totalXp += xpGain;

    let newLevel = oldLevel;
    while (user.xp >= xpForLevel(newLevel + 1)) {
      newLevel += 1;
    }

    if (newLevel > oldLevel) {
      user.level = newLevel;

      const levelUpMsg = (config.levelUpMessage ?? "Congrats {user}! You reached level {level}!")
        .replace("{user}", `<@${message.author.id}>`)
        .replace("{level}", String(newLevel))
        .replace("{guild}", guild.name);

      const channel =
        config.levelUpChannel && guild.channels.cache.has(config.levelUpChannel)
          ? guild.channels.cache.get(config.levelUpChannel)
          : message.channel;

      await channel.send(`🎊 ${levelUpMsg}`).catch(() => {});
    }

    await user.save().catch(() => {});
  },
};