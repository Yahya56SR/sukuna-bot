import { Client, Interaction, ChatInputCommandInteraction, ButtonInteraction, MessageComponentInteraction } from 'discord.js';
import { CommandRegistry } from './CommandRegistry';
import { TempVCService } from '../modules/tempvc/TempVCService';

export class InteractionRouter {
  private client: Client | null = null;
  private commandRegistry: CommandRegistry;
  private tempvcService: TempVCService | null = null;

  constructor(commandRegistry: CommandRegistry) {
    this.commandRegistry = commandRegistry;
  }

  public setTempVCService(service: TempVCService): void {
    this.tempvcService = service;
  }

  public async initialize(client: Client): Promise<void> {
    this.client = client;
    this.setupInteractionHandlers();
  }

  private setupInteractionHandlers(): void {
    if (!this.client) return;

    this.client.on('interactionCreate', async (interaction: Interaction) => {
      if (interaction.isChatInputCommand()) {
        await this.commandRegistry.handleInteraction(interaction as ChatInputCommandInteraction);
      } else if (interaction.isButton()) {
        await this.handleButtonInteraction(interaction as ButtonInteraction);
      } else if (interaction.isMessageComponent()) {
        await this.handleComponentInteraction(interaction as MessageComponentInteraction);
      }
    });
  }

  private async handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
    const customId = interaction.customId;

    if (customId.startsWith('tempvc:')) {
      if (this.tempvcService) {
        await this.tempvcService.handlePanelButton(interaction as any);
      }
      return;
    }

    if (customId.startsWith('game_join:')) {
      await interaction.reply({ content: 'Use /joingame to join this game.', flags: 4 });
      return;
    }
  }

  private async handleComponentInteraction(_interaction: MessageComponentInteraction): Promise<void> {
  }

  public async shutdown(): Promise<void> {
    if (this.client) {
      this.client.removeAllListeners();
    }
    this.client = null;
  }
}
