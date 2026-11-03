import type { Command } from '../core/commands.js';
import { pingCommand } from './core/ping.js';
import { helpCommand } from './core/help.js';
import { voiceCommand } from './core/voice.js';
import { kickCommand } from './moderation/kick.js';
import { banCommand } from './moderation/ban.js';
import { timeoutCommand } from './moderation/timeout.js';
import { clearCommand } from './moderation/clear.js';
import { warnCommand } from './moderation/warn.js';
import { balanceCommand } from './economy/balance.js';
import { dailyCommand } from './economy/daily.js';
import { workCommand } from './economy/work.js';
import { eightBallCommand } from './fun/8ball.js';
import { coinflipCommand } from './fun/coinflip.js';
import { diceCommand } from './fun/dice.js';
import { rankCommand } from './leveling/rank.js';
import { leaderboardCommand } from './leveling/leaderboard.js';
import { levelsCommand } from './leveling/levels.js';
import { xpCommand } from './leveling/xp.js';

/**
 * Static registry. Every new command must be added here so esbuild can bundle
 * it — dynamic filesystem loading does not survive bundling.
 */
export const commands: readonly Command[] = [
  pingCommand,
  helpCommand,
  voiceCommand,
  kickCommand,
  banCommand,
  timeoutCommand,
  clearCommand,
  warnCommand,
  balanceCommand,
  dailyCommand,
  workCommand,
  eightBallCommand,
  coinflipCommand,
  diceCommand,
  rankCommand,
  leaderboardCommand,
  levelsCommand,
  xpCommand,
];
