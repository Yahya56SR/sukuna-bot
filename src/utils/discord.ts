import { PermissionFlagsBits, type Guild, type Role } from 'discord.js';

/**
 * Returns a human-readable error if the bot cannot assign the role, or null if
 * it can. Used before granting level rewards so a hierarchy problem is reported
 * instead of silently doing nothing.
 */
export function canAssignRole(guild: Guild, role: Role): string | null {
  const me = guild.members.me;
  if (!me) return 'I could not resolve my own member object.';
  if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return 'I need the **Manage Roles** permission to assign roles.';
  }
  if (role.managed) {
    return 'That role is managed by an integration and cannot be assigned manually.';
  }
  if (role.position >= me.roles.highest.position) {
    return 'That role is higher than (or equal to) my highest role, so I cannot assign it. Move my role above it.';
  }
  return null;
}
