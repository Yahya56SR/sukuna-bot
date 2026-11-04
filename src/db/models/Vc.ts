import { model, Schema, type Document } from 'mongoose';

export interface IVcPanel extends Document {
  guildId: string;
  channelId: string;
  messageId: string;
  embedTitle: string;
  embedDescription: string;
  embedColor: number;
  embedFooter: string;
  createdAt: Date;
  updatedAt: Date;
}

const vcPanelSchema = new Schema<IVcPanel>(
  {
    guildId: { type: String, required: true, index: true },
    channelId: { type: String, required: true },
    messageId: { type: String, required: true },
    embedTitle: { type: String, required: true, default: '🔊 One Tap Voice' },
    embedDescription: {
      type: String,
      required: true,
      default:
        'Click **Join VC** below to have 愛 Doctora join **your** voice channel.\n\n' +
        'Make sure you are in a voice channel before tapping. Works for any voice channel in this server.',
    },
    embedColor: { type: Number, required: true, default: 0x5865f2 },
    embedFooter: { type: String, default: '愛 Doctora • One Tap VC' },
  },
  { timestamps: true },
);

vcPanelSchema.index({ guildId: 1, messageId: 1 }, { unique: true });

export const VcPanel = model<IVcPanel>('VcPanel', vcPanelSchema);

export async function readVcPanel(guildId: string, messageId: string) {
  return VcPanel.findOne({ guildId, messageId }).lean();
}

export async function readVcPanelById(panelId: string) {
  return VcPanel.findById(panelId).lean();
}

export async function readVcPanelsByGuild(guildId: string) {
  return VcPanel.find({ guildId }).lean();
}

export async function createVcPanel(data: Partial<IVcPanel>) {
  return VcPanel.create(data);
}

export async function updateVcPanel(
  guildId: string,
  messageId: string,
  updates: Partial<IVcPanel>,
) {
  return VcPanel.findOneAndUpdate({ guildId, messageId }, updates, { new: true }).lean();
}

export async function deleteVcPanel(guildId: string, messageId: string) {
  return VcPanel.deleteOne({ guildId, messageId });
}
