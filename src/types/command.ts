export interface BaseCommand {
  data: any;
  execute: (client: any, interaction: any, ...args: any[]) => Promise<void> | void;
  cooldown?: number;
  category?: string;
  guildOnly?: boolean;
  ownerOnly?: boolean;
  userPermissions?: string[];
  botPermissions?: string[];
  options?: any;
}

export interface Command extends BaseCommand {}
