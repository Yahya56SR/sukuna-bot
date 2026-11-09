"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CARD_CONFIG = void 0;
exports.getDefaultCardConfig = getDefaultCardConfig;
exports.DEFAULT_CARD_CONFIG = {
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
function getDefaultCardConfig() {
    return JSON.parse(JSON.stringify(exports.DEFAULT_CARD_CONFIG));
}
