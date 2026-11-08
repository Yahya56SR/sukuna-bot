import { ChatInputCommandInteraction, MessageFlags, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { Logger } from '../../infrastructure/Logger';
import { eq } from 'drizzle-orm';
import { users, economyTransactions } from '../../database/schema';
import type { DrizzleDb } from '../../types/database';

export class EconomyService {
  private logger: Logger;
  private db: DrizzleDb | null = null;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  public setDb(db: DrizzleDb): void {
    this.db = db;
  }

  public async initialize(): Promise<void> {
    this.logger.info('Economy Service', 'Economy system initialized');
  }

  public async getBalance(userId: string): Promise<number> {
    if (!this.db) return 0;
    const result = await this.db.select().from(users).where(eq(users.id, userId));
    if (!result[0]) {
      await this.db.insert(users).values({
        id: userId,
        username: '',
        discriminator: null,
        avatar: null,
        bot: false,
        balance: 0,
        xp: 0,
        level: 1,
        total_xp: 0,
        created_at: new Date(),
        updated_at: new Date(),
      } as any);
      return 0;
    }
    return result[0].balance || 0;
  }

  public async addBalance(userId: string, amount: number): Promise<void> {
    if (!this.db) return;
    const current = await this.getBalance(userId);
    await this.db.update(users)
      .set({ balance: current + amount })
      .where(eq(users.id, userId));

    await this.db.insert(economyTransactions).values({
      id: `txn_${Date.now()}`,
      guild_id: '',
      user_id: userId,
      type: 'credit',
      amount,
      description: 'Balance added',
      created_at: new Date(),
    } as any);
  }

  public async removeBalance(userId: string, amount: number): Promise<boolean> {
    if (!this.db) return false;
    const current = await this.getBalance(userId);
    if (current < amount) return false;

    await this.db.update(users)
      .set({ balance: current - amount })
      .where(eq(users.id, userId));

    await this.db.insert(economyTransactions).values({
      id: `txn_${Date.now()}`,
      guild_id: '',
      user_id: userId,
      type: 'debit',
      amount,
      description: 'Balance removed',
      created_at: new Date(),
    } as any);

    return true;
  }

  public async pay(fromUserId: string, toUserId: string, amount: number): Promise<boolean> {
    if (!(await this.removeBalance(fromUserId, amount))) return false;
    await this.addBalance(toUserId, amount);
    return true;
  }

  public async shutdown(): Promise<void> {
    this.logger.info('Economy Service', 'Economy system shutdown');
  }
}

export class EconomyCommands {
  private service: EconomyService;
  private logger: Logger;

  constructor(service: EconomyService, logger: Logger) {
    this.service = service;
    this.logger = logger;
  }

  public getCommands(): any[] {
    return [this.balanceCommand, this.payCommand];
  }

  private balanceCommand: any = {
    data: new SlashCommandBuilder()
      .setName('balance')
      .setDescription('Check your balance')
      .addUserOption(option =>
        option.setName('user').setDescription('User to check')
      ),
    execute: async (interaction: ChatInputCommandInteraction) => {
      const user = interaction.options.getUser('user') || interaction.user;
      try {
        const balance = await this.service.getBalance(user.id);
        const embed = new EmbedBuilder()
          .setColor('#00ff00')
          .setTitle(`💰 Balance - ${user.tag}`)
          .setDescription(`${balance} coins`)
          .setTimestamp();
        await interaction.reply({ embeds: [embed] });
      } catch (error) {
        this.logger.error('Economy Commands', 'Failed to get balance', error as Error);
        await interaction.reply({ content: 'Failed to get balance.', flags: MessageFlags.Ephemeral });
      }
    },
  };

  private payCommand: any = {
    data: new SlashCommandBuilder()
      .setName('pay')
      .setDescription('Pay another user')
      .addUserOption(option =>
        option.setName('user').setDescription('User to pay').setRequired(true)
      )
      .addIntegerOption(option =>
        option.setName('amount').setDescription('Amount to pay').setRequired(true)
      ),
    execute: async (interaction: ChatInputCommandInteraction) => {
      const target = interaction.options.getUser('user', true);
      const amount = interaction.options.getInteger('amount', true);

      if (amount <= 0) {
        await interaction.reply({ content: 'Amount must be positive.', flags: MessageFlags.Ephemeral });
        return;
      }

      if (target.id === interaction.user.id) {
        await interaction.reply({ content: 'You cannot pay yourself.', flags: MessageFlags.Ephemeral });
        return;
      }

      try {
        const success = await this.service.pay(interaction.user.id, target.id, amount);
        if (success) {
          await interaction.reply({ content: `✅ Paid ${target.tag} ${amount} coins.`, flags: MessageFlags.Ephemeral });
        } else {
          await interaction.reply({ content: 'Insufficient balance.', flags: MessageFlags.Ephemeral });
        }
      } catch (error) {
        this.logger.error('Economy Commands', 'Failed to pay', error as Error);
        await interaction.reply({ content: 'Failed to process payment.', flags: MessageFlags.Ephemeral });
      }
    },
  };
}
