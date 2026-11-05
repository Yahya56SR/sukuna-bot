import { Events, type ClientEvents, MessageReaction, PartialMessageReaction, User, PartialUser } from 'discord.js';
import { handleButtonInteraction as handleReactionRoleButton, handleSelectMenuInteraction as handleReactionRoleSelect } from '../handlers/reactionRoles.js';
import { handleStarboardReaction } from '../commands/utility/starboard.js';
import { trackInviteJoin, trackInviteLeave } from '../commands/utility/invites.js';

export const reactionAdd = {
  name: Events.MessageReactionAdd as keyof ClientEvents,
  execute: async (client: any, reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) => {
    if (user.bot) return;

    // Starboard
    try {
      await handleStarboardReaction(reaction, user, true);
    } catch (err) {
      client.logger?.warn({ err }, 'starboard reaction add failed');
    }

    // Reaction roles
    try {
      await handleReactionRoleButton({ isButton: () => false, customId: '', ...reaction } as any);
      // Note: reaction roles use buttons, not reactions
    } catch (err) {
      client.logger?.warn({ err }, 'reaction role add failed');
    }
  },
};

export const reactionRemove = {
  name: Events.MessageReactionRemove as keyof ClientEvents,
  execute: async (client: any, reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) => {
    if (user.bot) return;

    // Starboard
    try {
      await handleStarboardReaction(reaction, user, false);
    } catch (err) {
      client.logger?.warn({ err }, 'starboard reaction remove failed');
    }

    // Reaction roles
    try {
      // Note: reaction roles use buttons, not reactions
    } catch (err) {
      client.logger?.warn({ err }, 'reaction role remove failed');
    }
  },
};

export const guildMemberAdd = {
  name: Events.GuildMemberAdd as keyof ClientEvents,
  execute: async (client: any, member: any) => {
    // Invite tracking
    try {
      await trackInviteJoin(member);
    } catch (err) {
      client.logger?.warn({ err }, 'invite tracking join failed');
    }
  },
};

export const guildMemberRemove = {
  name: Events.GuildMemberRemove as keyof ClientEvents,
  execute: async (client: any, member: any) => {
    // Invite tracking
    try {
      await trackInviteLeave(member);
    } catch (err) {
      client.logger?.warn({ err }, 'invite tracking leave failed');
    }
  },
};