"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InteractionRouter = void 0;
class InteractionRouter {
    constructor(commandRegistry) {
        this.client = null;
        this.tempvcService = null;
        this.commandRegistry = commandRegistry;
    }
    setTempVCService(service) {
        this.tempvcService = service;
    }
    async initialize(client) {
        this.client = client;
        this.setupInteractionHandlers();
    }
    setupInteractionHandlers() {
        if (!this.client)
            return;
        this.client.on('interactionCreate', async (interaction) => {
            if (interaction.isChatInputCommand()) {
                await this.commandRegistry.handleInteraction(interaction);
            }
            else if (interaction.isButton()) {
                await this.handleButtonInteraction(interaction);
            }
            else if (interaction.isMessageComponent()) {
                await this.handleComponentInteraction(interaction);
            }
        });
    }
    async handleButtonInteraction(interaction) {
        const customId = interaction.customId;
        if (customId.startsWith('tempvc:')) {
            if (this.tempvcService) {
                await this.tempvcService.handlePanelButton(interaction);
            }
            return;
        }
        if (customId.startsWith('game_join:')) {
            await interaction.reply({ content: 'Use /joingame to join this game.', flags: 4 });
            return;
        }
    }
    async handleComponentInteraction(_interaction) {
    }
    async shutdown() {
        if (this.client) {
            this.client.removeAllListeners();
        }
        this.client = null;
    }
}
exports.InteractionRouter = InteractionRouter;
