import type { Command } from '../core/commands.js';
import { pingCommand } from './core/ping.js';
import { helpCommand } from './core/help.js';
import { voiceCommand } from './core/voice.js';
import { userinfoCommand } from './core/userinfo.js';
import { serverinfoCommand } from './core/serverinfo.js';
import { setupCommand } from './core/setup.js';
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
import { ticketCommand } from './tickets/ticket.js';

// NEW FUN COMMANDS
import { pollCommand } from './fun/poll';
import { rpsCommand } from './fun/rps';
import { truthCommand } from './fun/truth';
import { dareCommand } from './fun/dare';
import { complimentCommand } from './fun/compliment';
import { avatarCommand } from './fun/avatar';
import { servercardCommand } from './fun/servercard';
import { chooseCommand } from './fun/choose';
import { flipCommand } from './fun/flip';
import { eightBallEnhancedCommand } from './fun/eightball-enhanced';

// NEW UTILITY COMMANDS
import { suggestCommand } from './utility/suggest';
import { pollCreateCommand } from './utility/poll-create';
import { pollVoteCommand } from './utility/poll-vote';

// NEW LEVELING COMMANDS
import { levelupCommand } from './leveling/levelup';
import { xpgiveCommand } from './leveling/xpgive';
import { resetXpCommand } from './leveling/resetxp';

// NEW ECONOMY COMMANDS
import { economyCommand } from './economy/economy.js';
import { shopCommand } from './economy/shop.js';
import { inventoryCommand } from './economy/inventory.js';
import { giveCommand } from './economy/give.js';
import { richCommand } from './economy/rich.js';

// NEW TICKET COMMANDS (enhanced)
import { quickticketCommand } from './tickets/quick-ticket.js';

/**
 * Static registry. Every new command must be added here so esbuild can bundle
 * it — dynamic filesystem loading does not survive bundling.
 */
export const commands: readonly Command[] = [
  // Core utility
  pingCommand,
  helpCommand,
  voiceCommand,
  userinfoCommand,
  serverinfoCommand,
  setupCommand,

  // Moderation
  kickCommand,
  banCommand,
  timeoutCommand,
  clearCommand,
  warnCommand,

  // Economy
  balanceCommand,
  dailyCommand,
  workCommand,
  economyCommand,
  shopCommand,
  inventoryCommand,
  giveCommand,
  richCommand,

  // Fun
  eightBallCommand,
  coinflipCommand,
  diceCommand,
  pollCommand,
  rpsCommand,
  truthCommand,
  dareCommand,
  complimentCommand,
  avatarCommand,
  servercardCommand,
  chooseCommand,
  flipCommand,
  eightBallEnhancedCommand,

  // Utility
  suggestCommand,
  pollCreateCommand,
  pollVoteCommand,

  // Leveling
  rankCommand,
  leaderboardCommand,
  levelsCommand,
  xpCommand,
  levelupCommand,
  xpgiveCommand,
  resetXpCommand,

  // Tickets
  ticketCommand,
  quickticketCommand,
];
