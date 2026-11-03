import { Events } from "discord.js";

export default {
  name: Events.ClientReady,
  once: true,
  execute: (client: any) => {
    console.log(`[Ready] Logged in as ${client.user?.tag} (${client.user?.id})`);
    console.log(`[Ready] Serving ${client.guilds.cache.size} guild(s)`);
    console.log(`[Ready] Owners: ${client.owners.join(", ")}`);
  },
};
