const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const fs = require('fs');
const config = require('./config.json');
const realms = require('./realm');
const { log, sendEmbed } = require('./utils');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

const commands = [
    new SlashCommandBuilder()
        .setName('realm-ban')
        .setDescription('Ban a player from the realm.')
        .addStringOption(opt => opt.setName('username').setDescription('The player to ban').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('Reason for the ban').setRequired(true))
        .addIntegerOption(opt => opt.setName('days').setDescription('Ban duration in days').setRequired(true))
        .addIntegerOption(opt => opt.setName('hours').setDescription('Ban duration in hours').setRequired(true))
        .addIntegerOption(opt => opt.setName('minutes').setDescription('Ban duration in minutes').setRequired(true)),

    new SlashCommandBuilder()
        .setName('realm-unban')
        .setDescription('Unban a player from the realm.')
        .addStringOption(opt => opt.setName('username').setDescription('The player to unban').setRequired(true)),

    new SlashCommandBuilder()
        .setName('realm-whitelist')
        .setDescription('Manage the realm whitelist.')
        .addStringOption(opt =>
            opt.setName('action')
               .setDescription('Add, remove, or list users')
               .setRequired(true)
               .addChoices(
                    { name: 'add', value: 'add' },
                    { name: 'remove', value: 'remove' },
                    { name: 'list', value: 'list' }
               ))
        .addStringOption(opt =>
            opt.setName('username')
               .setDescription('Username to add or remove (required for add/remove)'))
].map(cmd => cmd.toJSON());

client.once('ready', async () => {
    log(`Logged in as ${client.user.username}!`);
    log('Registering slash commands...');

    const rest = new REST({ version: '10' }).setToken(config.botToken);
    try {
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );
        log('Slash commands registered.');
    } catch (err) {
        console.error('Error registering commands:', err);
    }

    log('Connecting to realms...');
    config.realms.forEach((realm) => {
        realms.spawnBot(realm);
    });
});

// Handle slash commands
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName, options, user } = interaction;

    if (!config.admins.includes(user.id)) {
        return interaction.reply({ content: 'Error You do not have permission.', ephemeral: true });
    }

    if (commandName === 'realm-ban') {
        const username = options.getString('username');
        const reason = options.getString('reason');
        const days = options.getInteger('days');
        const hours = options.getInteger('hours');
        const minutes = options.getInteger('minutes');

        const cmd = `/ban ${username} ${reason} ${days} ${hours} ${minutes}`;
        realms.sendCommandToRealm(cmd);
        return interaction.reply(`Sent in-game command: \`${cmd}\``);
    }

    if (commandName === 'realm-unban') {
        const username = options.getString('username');
        const cmd = `/unban ${username}`;
        realms.sendCommandToRealm(cmd);
        return interaction.reply(`Sent in-game command: \`${cmd}\``);
    }

    if (commandName === 'realm-whitelist') {
        const action = options.getString('action');
        const username = options.getString('username');

        if (action === 'list') {
            return interaction.reply(`📜 Whitelist: ${config.whitelist.join(', ') || 'empty'}`);
        }

        if (!username) {
            return interaction.reply({ content: 'Username is required for add/remove.', ephemeral: true });
        }

        if (action === 'add') {
            if (config.whitelist.includes(username)) {
                return interaction.reply(`\`${username}\` is already whitelisted.`);
            }
            config.whitelist.push(username);
            fs.writeFileSync('./config.json', JSON.stringify(config, null, 2));
            return interaction.reply(`\`${username}\` added to whitelist.`);
        }

        if (action === 'remove') {
            if (!config.whitelist.includes(username)) {
                return interaction.reply(`Error \`${username}\` is not in the whitelist.`);
            }
            config.whitelist = config.whitelist.filter(u => u !== username);
            fs.writeFileSync('./config.json', JSON.stringify(config, null, 2));
            return interaction.reply(`\`${username}\` removed from whitelist.`);
        }
    }
});

client.login(config.botToken);

module.exports = { client, log, sendEmbed };
