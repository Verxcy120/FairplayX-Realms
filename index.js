const discord = require('discord.js');
const fs = require('fs');
const config = require('./config.json');
const realms = require('./realm');
const { log, sendEmbed } = require('./utils');

const client = new discord.Client({
    intents: [
        discord.GatewayIntentBits.GuildMessages,
        discord.GatewayIntentBits.Guilds,
        discord.GatewayIntentBits.MessageContent,
    ],
});

// Logging function
client.on('ready', () => {
    log(`Logged in as ${client.user.username}!`);
    log('Connecting to realms...');
    config.realms.forEach((realm) => {
        realms.spawnBot(realm);
    });
});

// Handle messages and commands
client.on('messageCreate', (message) => {
    const { content, author, channel } = message;
    if (author.bot) return;

    // Relay all chat messages from the specified channel to Minecraft (no command needed)
    const relayChannelId = config.relayChannelId; // This is the channel you want to relay messages from

    if (channel.id === relayChannelId) {
        // Relaying messages from Discord to Minecraft
        realms.relayMessageFromDiscordToMinecraft(message);
    }

    // Whitelist commands (if needed)
    if (content.startsWith('/whitelist')) {
        if (!config.admins.includes(author.id)) {
            return message.reply('You do not have permission to use this command.');
        }

        const args = content.split(' ').slice(1);
        const command = args[0];
        const username = args[1];

        if (!['add', 'remove'].includes(command)) {
            return message.reply('Usage: `/whitelist add <username>` or `/whitelist remove <username>`');
        }

        if (command === 'add') {
            if (!username) return message.reply('Please specify a username to add!');
            if (!config.whitelist.includes(username)) {
                config.whitelist.push(username);
                fs.writeFileSync('./config.json', JSON.stringify(config, null, 2));
                message.reply(`\`${username}\` added to the whitelist.`);
            } else {
                message.reply(`\`${username}\` is already in the whitelist.`);
            }
        } else if (command === 'remove') {
            if (!username) return message.reply('Please specify a username to remove!');
            if (config.whitelist.includes(username)) {
                config.whitelist = config.whitelist.filter((u) => u !== username);
                fs.writeFileSync('./config.json', JSON.stringify(config, null, 2));
                message.reply(`\`${username}\` removed from the whitelist.`);
            } else {
                message.reply(`\`${username}\` is not in the whitelist.`);
            }
        }
    }
});

client.login(config.botToken);

module.exports = { client, log, sendEmbed };
