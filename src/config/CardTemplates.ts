/**
 * Card template configuration — drives both the welcome card and
 * the MEE6-style rank card / leaderboard visuals.
 *
 * Stored in the `service_configs` table under key `cards` and editable
 * live from the dashboard's "Cards" editor. Every value is a plain
 * string/number/boolean so the dashboard editor can bind directly to it.
 */
export interface WelcomeCardTemplate {
  enabled: boolean;
  backgroundImage: string;
  bgGradientStart: string;
  bgGradientEnd: string;
  accent: string;
  accentSecondary: string;
  textColor: string;
  subTextColor: string;
  overlayOpacity: number;
  showMemberCount: boolean;
  avatarRingWidth: number;
}

export interface RankCardTemplate {
  enabled: boolean;
  backgroundImage: string;
  bgGradientStart: string;
  bgGradientEnd: string;
  accent: string;
  accentSecondary: string;
  rankColor: string;
  levelColor: string;
  textColor: string;
  subTextColor: string;
  overlayOpacity: number;
  showGuildName: boolean;
}

export interface LeaderboardTemplate {
  bgGradientStart: string;
  bgGradientEnd: string;
  accent: string;
  gold: string;
  silver: string;
  bronze: string;
  textColor: string;
  subTextColor: string;
}

export interface CardConfig {
  welcome: WelcomeCardTemplate;
  rank: RankCardTemplate;
  leaderboard: LeaderboardTemplate;
}

export const DEFAULT_CARD_CONFIG: CardConfig = {
  welcome: {
    enabled: true,
    backgroundImage: '',
    bgGradientStart: '#1e1f3a',
    bgGradientEnd: '#171831',
    accent: '#ef4444',
    accentSecondary: '#f97316',
    textColor: '#ffffff',
    subTextColor: '#b9bbbe',
    overlayOpacity: 0.55,
    showMemberCount: true,
    avatarRingWidth: 3,
  },
  rank: {
    enabled: true,
    backgroundImage: '',
    bgGradientStart: '#1e1f3a',
    bgGradientEnd: '#171831',
    accent: '#ef4444',
    accentSecondary: '#f97316',
    rankColor: '#f0b232',
    levelColor: '#00b0f4',
    textColor: '#ffffff',
    subTextColor: '#b9bbbe',
    overlayOpacity: 0.35,
    showGuildName: true,
  },
  leaderboard: {
    bgGradientStart: '#1e1f3a',
    bgGradientEnd: '#171831',
    accent: '#ef4444',
    gold: '#f0b232',
    silver: '#c0c6cf',
    bronze: '#cd7f32',
    textColor: '#ffffff',
    subTextColor: '#b9bbbe',
  },
};

export function getDefaultCardConfig(): CardConfig {
  return JSON.parse(JSON.stringify(DEFAULT_CARD_CONFIG)) as CardConfig;
}
