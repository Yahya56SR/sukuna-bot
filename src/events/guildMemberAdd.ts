import { Events, type ClientEvents, type GuildMember, type PartialGuildMember } from 'discord.js';
import { getUserXp } from '../db/utils.js';
import { syncLevelRoles } from '../handlers/levelUp.js';
import { levelFromXp } from '../utils/level.js';

/**
 * Restore level reward roles for returning members.
 *
 * Leaving a server drops every role, so a returning member would otherwise
 * stay without their level reward until their next level-up.
 */
export const guildMemberAdd = {
  name: Events.GuildMemberAdd as keyof ClientEvents,
  execute: async (_client: any, member: GuildMember | PartialGuildMember) => {
    if (!member || member.user?.bot) return;

    try {
      const row = await getUserXp(member.id);
      if (!row || row.xp <= 0) return;

      const full =
        member.partial || !('roles' in member)
          ? await member.guild.members.fetch(member.id).catch(() => null)
          : (member as GuildMember);
      if (!full) return;

      await syncLevelRoles(member.guild, full, levelFromXp(row.xp).level);
    } catch (err) {
      console.error('[LevelUp] Failed to restore level roles on join:', err);
    }
  },
};
