import { Events } from "discord.js";
import { getUser, getGuild, xpForLevel } from "../utils";

export default {
  name: Events.MessageCreate,
  execute: async (client: any, message: any) => {
    if (message.author.bot) return;
    if (!message.guild) return;

    const guild = await getGuild(message.guild.id);
    if (!guild.modules.leveling || !guild.xpEnabled) return;

    // Disable XP in ignored channels
    if (guild.disableXpChannels.includes(message.channelId)) return;

    // Cooldown per user
    const cooldownKey = `xp_${message.author.id}`;
    const now = Date.now();
    const xpCooldowns: Map<string, number> = client.xpCooldowns || new Map();
    client.xpCooldowns = xpCooldowns;

    if (xpCooldowns.has(cooldownKey)) {
      if (now - xpCooldowns.get(cooldownKey)! < guild.xpCooldown * 1000) return;
    }
    xpCooldowns.set(cooldownKey, now);

    const xpGain = Math.floor(Math.random() * (guild.xpMax - guild.xpMin + 1)) + guild.xpMin;

    const user = await getUser(message.author.id);
    const oldLevel = user.level;
    user.xp += xpGain;
    user.totalXp += xpGain;

    // Calculate new level
    let newLevel = oldLevel;
    while (user.xp >= xpForLevel(newLevel + 1)) {
      newLevel += 1;
    }

    if (newLevel > oldLevel) {
      user.level = newLevel;

      // Level up notification
      const levelUpMsg = (guild.levelUpMessage || "Congrats {user}! You reached level {level}!")
        .replace("{user}", `<@${message.author.id}>`)
        .replace("{level}", String(newLevel))
        .replace("{guild}", message.guild.name);

      const channel =
        guild.levelUpChannel && message.guild.channels.cache.has(guild.levelUpChannel)
          ? message.guild.channels.cache.get(guild.levelUpChannel)
          : message.channel;

      await channel.send(`🎊 ${levelUpMsg}`).catch(() => {});

      // Auto roles on level could go here
    }

    await user.save().catch(() => {});
  },
};
