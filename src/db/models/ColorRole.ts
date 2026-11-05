import { model, Schema, Document } from "mongoose";

export interface IColorRole extends Document {
  guildId: string;
  /** Role ID (created by bot) */
  roleId: string;
  /** Gradient name */
  name: string;
  /** Gradient CSS (e.g., "linear-gradient(90deg, #ff0000, #00ff00)") */
  gradient: string;
  /** Gradient colors array for animation */
  colors: string[];
  /** Animation duration in seconds */
  animationDuration: number;
  /** Whether role is available for self-pick */
  pickable: boolean;
  /** Required role to pick this color */
  requiredRoleId?: string;
  /** Cost in economy currency to pick */
  cost?: number;
  /** Max users who can have this role (0 = unlimited) */
  maxUsers: number;
  /** Current users count */
  currentUsers: number;
  /** Display order */
  position: number;
  /** Whether role is active */
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const colorRoleSchema = new Schema<IColorRole>(
  {
    guildId: { type: String, required: true, index: true },
    roleId: { type: String, required: true, unique: true },
    name: { type: String, required: true, maxlength: 50 },
    gradient: { type: String, required: true },
    colors: { type: [String], required: true, validate: (v: string[]) => v.length >= 2 },
    animationDuration: { type: Number, default: 10, min: 1, max: 60 },
    pickable: { type: Boolean, default: true },
    requiredRoleId: { type: String },
    cost: { type: Number, default: 0, min: 0 },
    maxUsers: { type: Number, default: 0, min: 0 },
    currentUsers: { type: Number, default: 0 },
    position: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

colorRoleSchema.index({ guildId: 1, position: 1 });

export const ColorRole = model<IColorRole>("ColorRole", colorRoleSchema);