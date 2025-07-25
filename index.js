const discord = require('discord.js');
const fs = require('fs');
const config = require('./config.json');
const realms = require('./realm');
const { log, sendEmbed } = require('./utils');
const commands = require('./commands/commands.js');

const client = new discord.Client({
    intents: [
        discord.GatewayIntentBits.GuildMessages,
        discord.GatewayIntentBits.Guilds,
        discord.GatewayIntentBits.MessageContent,
    ],
});

// Create a collection to store commands
client.commands = new discord.Collection();
commands.forEach(command => {
    client.commands.set(command.data.name, command);
});

// Logging function
client.on('ready', () => {
    log(`Logged in as ${client.user.username}!`);
    log(`Loaded ${client.commands.size} slash commands`);
    log('Connecting to realms...');
    realms.setDiscordClient(client); // Set Discord client before spawning bot
    realms.spawnBot(); // No need to pass realm parameter anymore
});

// Handle slash command interactions
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);

    if (!command) {
        console.error(`No command matching ${interaction.commandName} was found.`);
        return;
    }

    try {
        await command.execute(interaction);
    } catch (error) {
        console.error('Error executing command:', error);
        const errorMessage = { content: 'There was an error while executing this command!', ephemeral: true };
        
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(errorMessage);
        } else {
            await interaction.reply(errorMessage);
        }
    }
});


// Handle messages and commands
client.on('messageCreate', (message) => {
    const { content, author, channel } = message;
    if (author.bot) return;

    // Get the chat channel ID from the first realm or server
    let chatChannelId;
    if (config.realms && config.realms[0]) {
        chatChannelId = config.realms[0].logChannels.chat;
    } else if (config.servers && config.servers[0]) {
        chatChannelId = config.servers[0].logChannels.chat;
    }

    if (channel.id === chatChannelId) {
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
