import { model, Schema, Document } from "mongoose";

export interface IThemeConfig extends Document {
  guildId: string;
  /** Theme name/preset */
  preset?: string;
  /** Primary color (hex) */
  primaryColor: string;
  /** Secondary color (hex) */
  secondaryColor: string;
  /** Accent color (hex) */
  accentColor: string;
  /** Background color (hex) */
  backgroundColor: string;
  /** Surface/card color (hex) */
  surfaceColor: string;
  /** Text color (hex) */
  textColor: string;
  /** Muted text color (hex) */
  mutedColor: string;
  /** Border color (hex) */
  borderColor: string;
  /** Success color (hex) */
  successColor: string;
  /** Warning color (hex) */
  warningColor: string;
  /** Error color (hex) */
  errorColor: string;
  /** Font family */
  fontFamily?: string;
  /** Heading font family */
  headingFontFamily?: string;
  /** Border radius (px) */
  borderRadius: number;
  /** Whether to use glassmorphism/frosted glass */
  glassmorphism: boolean;
  /** Glass opacity (0-1) */
  glassOpacity: number;
  /** Custom CSS (advanced) */
  customCSS?: string;
  /** Embed defaults */
  embedDefaults: {
    color?: string;
    footerText?: string;
    footerIcon?: string;
    thumbnail?: string;
    image?: string;
    timestamp: boolean;
  };
  /** Whether theme is active */
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const themeConfigSchema = new Schema<IThemeConfig>(
  {
    guildId: { type: String, required: true, unique: true, index: true },
    preset: { type: String },
    primaryColor: { type: String, default: '#e5484d', match: /^#[0-9A-Fa-f]{6}$/ },
    secondaryColor: { type: String, default: '#10141d', match: /^#[0-9A-Fa-f]{6}$/ },
    accentColor: { type: String, default: '#ff6b70', match: /^#[0-9A-Fa-f]{6}$/ },
    backgroundColor: { type: String, default: '#0b0d12', match: /^#[0-9A-Fa-f]{6}$/ },
    surfaceColor: { type: String, default: '#121722', match: /^#[0-9A-Fa-f]{6}$/ },
    textColor: { type: String, default: '#e8ecf4', match: /^#[0-9A-Fa-f]{6}$/ },
    mutedColor: { type: String, default: '#768099', match: /^#[0-9A-Fa-f]{6}$/ },
    borderColor: { type: String, default: '#232b3b', match: /^#[0-9A-Fa-f]{6}$/ },
    successColor: { type: String, default: '#34d399', match: /^#[0-9A-Fa-f]{6}$/ },
    warningColor: { type: String, default: '#f5b544', match: /^#[0-9A-Fa-f]{6}$/ },
    errorColor: { type: String, default: '#e5484d', match: /^#[0-9A-Fa-f]{6}$/ },
    fontFamily: { type: String },
    headingFontFamily: { type: String },
    borderRadius: { type: Number, default: 14, min: 0, max: 50 },
    glassmorphism: { type: Boolean, default: true },
    glassOpacity: { type: Number, default: 0.8, min: 0, max: 1 },
    customCSS: { type: String, maxlength: 10000 },
    embedDefaults: {
      color: { type: String, match: /^#[0-9A-Fa-f]{6}$/ },
      footerText: { type: String, maxlength: 2048 },
      footerIcon: { type: String },
      thumbnail: { type: String },
      image: { type: String },
      timestamp: { type: Boolean, default: true },
    },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const ThemeConfig = model<IThemeConfig>("ThemeConfig", themeConfigSchema);