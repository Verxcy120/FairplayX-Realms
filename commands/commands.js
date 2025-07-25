const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const config = require('../config.json');
const { log } = require('../utils');

// Helper function to save config
function saveConfig() {
    fs.writeFileSync('./config.json', JSON.stringify(config, null, 2));
}

// Helper function to check if user is admin (supports both usernames and user IDs)
function isAdmin(userId, username) {
    console.log(`Debug: Checking admin for userId: ${userId}, username: ${username}`);
    console.log(`Debug: Config admins: ${JSON.stringify(config.admins)}`);
    const result = config.admins.includes(userId) || config.admins.includes(username);
    console.log(`Debug: Admin check result: ${result}`);
    return result;
}

const commands = [
    // Whitelist command
    {
        data: new SlashCommandBuilder()
            .setName('whitelist')
            .setDescription('Manage the server whitelist')
            .addSubcommand(subcommand =>
                subcommand
                    .setName('add')
                    .setDescription('Add a player to the whitelist')
                    .addStringOption(option =>
                        option.setName('username')
                            .setDescription('Minecraft username to add')
                            .setRequired(true)))
            .addSubcommand(subcommand =>
                subcommand
                    .setName('remove')
                    .setDescription('Remove a player from the whitelist')
                    .addStringOption(option =>
                        option.setName('username')
                            .setDescription('Minecraft username to remove')
                            .setRequired(true)))
            .addSubcommand(subcommand =>
                subcommand
                    .setName('list')
                    .setDescription('Show all whitelisted players')),
        async execute(interaction) {
            if (!isAdmin(interaction.user.id, interaction.user.username)) {
                return await interaction.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });
            }

            const subcommand = interaction.options.getSubcommand();
            const username = interaction.options.getString('username');

            switch (subcommand) {
                case 'add':
                    if (!config.whitelist.includes(username)) {
                        config.whitelist.push(username);
                        saveConfig();
                        log(`${interaction.user.username} added ${username} to whitelist`);
                        await interaction.reply(`✅ \`${username}\` has been added to the whitelist.`);
                    } else {
                        await interaction.reply(`⚠️ \`${username}\` is already in the whitelist.`);
                    }
                    break;

                case 'remove':
                    if (config.whitelist.includes(username)) {
                        config.whitelist = config.whitelist.filter(u => u !== username);
                        saveConfig();
                        log(`${interaction.user.username} removed ${username} from whitelist`);
                        await interaction.reply(`✅ \`${username}\` has been removed from the whitelist.`);
                    } else {
                        await interaction.reply(`⚠️ \`${username}\` is not in the whitelist.`);
                    }
                    break;

                case 'list':
                    const embed = new EmbedBuilder()
                        .setTitle('🔒 Whitelist')
                        .setDescription(config.whitelist.length > 0 ? config.whitelist.map(u => `• ${u}`).join('\n') : 'No players whitelisted')
                        .setColor('#00FF00')
                        .setTimestamp();
                    await interaction.reply({ embeds: [embed] });
                    break;
            }
        },
    },

    // Admin command
    {
        data: new SlashCommandBuilder()
            .setName('admin')
            .setDescription('Manage bot administrators')
            .addSubcommand(subcommand =>
                subcommand
                    .setName('add')
                    .setDescription('Add a user as bot administrator')
                    .addUserOption(option =>
                        option.setName('user')
                            .setDescription('Discord user to make admin')
                            .setRequired(true)))
            .addSubcommand(subcommand =>
                subcommand
                    .setName('remove')
                    .setDescription('Remove a user from bot administrators')
                    .addUserOption(option =>
                        option.setName('user')
                            .setDescription('Discord user to remove admin')
                            .setRequired(true)))
            .addSubcommand(subcommand =>
                subcommand
                    .setName('list')
                    .setDescription('Show all bot administrators')),
        async execute(interaction) {
            if (!isAdmin(interaction.user.id, interaction.user.username)) {
                return await interaction.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });
            }

            const subcommand = interaction.options.getSubcommand();
            const user = interaction.options.getUser('user');

            switch (subcommand) {
                case 'add':
                    if (!config.admins.includes(user.id)) {
                        config.admins.push(user.id);
                        saveConfig();
                        log(`${interaction.user.username} added ${user.username} as admin`);
                        await interaction.reply(`✅ ${user} has been added as a bot administrator.`);
                    } else {
                        await interaction.reply(`⚠️ ${user} is already a bot administrator.`);
                    }
                    break;

                case 'remove':
                    if (config.admins.includes(user.id)) {
                        if (user.id === interaction.user.id) {
                            await interaction.reply(`❌ You cannot remove yourself as an administrator.`);
                            return;
                        }
                        config.admins = config.admins.filter(id => id !== user.id);
                        saveConfig();
                        log(`${interaction.user.username} removed ${user.username} as admin`);
                        await interaction.reply(`✅ ${user} has been removed as a bot administrator.`);
                    } else {
                        await interaction.reply(`⚠️ ${user} is not a bot administrator.`);
                    }
                    break;

                case 'list':
                    const adminList = await Promise.all(
                        config.admins.map(async (adminId) => {
                            try {
                                const adminUser = await interaction.client.users.fetch(adminId);
                                return `• ${adminUser.username} (${adminUser.id})`;
                            } catch {
                                return `• Unknown User (${adminId})`;
                            }
                        })
                    );
                    
                    const embed = new EmbedBuilder()
                        .setTitle('👑 Bot Administrators')
                        .setDescription(adminList.length > 0 ? adminList.join('\n') : 'No administrators configured')
                        .setColor('#FFD700')
                        .setTimestamp();
                    await interaction.reply({ embeds: [embed] });
                    break;
            }
        },
    },

    // Ban command
    {
        data: new SlashCommandBuilder()
            .setName('ban')
            .setDescription('Ban a player from the server')
            .addStringOption(option =>
                option.setName('username')
                    .setDescription('Minecraft username to ban')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('reason')
                    .setDescription('Reason for the ban')
                    .setRequired(false)),
        async execute(interaction) {
            if (!isAdmin(interaction.user.id, interaction.user.username)) {
                return await interaction.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });
            }

            const username = interaction.options.getString('username');
            const reason = interaction.options.getString('reason') || 'No reason provided';

            if (!config.bannedPlayers) {
                config.bannedPlayers = [];
            }

            if (!config.bannedPlayers.includes(username)) {
                config.bannedPlayers.push(username);
                // Remove from whitelist if present
                config.whitelist = config.whitelist.filter(u => u !== username);
                saveConfig();
                log(`${interaction.user.username} banned ${username} - Reason: ${reason}`);
                await interaction.reply(`🔨 \`${username}\` has been banned.\nReason: ${reason}`);
            } else {
                await interaction.reply(`⚠️ \`${username}\` is already banned.`);
            }
        },
    },

    // Unban command
    {
        data: new SlashCommandBuilder()
            .setName('unban')
            .setDescription('Unban a player from the server')
            .addStringOption(option =>
                option.setName('username')
                    .setDescription('Minecraft username to unban')
                    .setRequired(true)),
        async execute(interaction) {
            if (!isAdmin(interaction.user.id, interaction.user.username)) {
                return await interaction.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });
            }

            const username = interaction.options.getString('username');

            if (!config.bannedPlayers) {
                config.bannedPlayers = [];
            }

            if (config.bannedPlayers.includes(username)) {
                config.bannedPlayers = config.bannedPlayers.filter(u => u !== username);
                saveConfig();
                log(`${interaction.user.username} unbanned ${username}`);
                await interaction.reply(`✅ \`${username}\` has been unbanned.`);
            } else {
                await interaction.reply(`⚠️ \`${username}\` is not banned.`);
            }
        },
    },

    // Device config command
    {
        data: new SlashCommandBuilder()
            .setName('device-config')
            .setDescription('Configure banned devices')
            .addSubcommand(subcommand =>
                subcommand
                    .setName('ban')
                    .setDescription('Ban a device type')
                    .addStringOption(option =>
                        option.setName('device')
                            .setDescription('Device type to ban')
                            .setRequired(true)
                            .addChoices(
                                { name: 'Android', value: 'Android' },
                                { name: 'iOS', value: 'iOS' },
                                { name: 'Xbox', value: 'Xbox' },
                                { name: 'Windows', value: 'Windows' },
                                { name: 'PlayStation', value: 'PlayStation' },
                                { name: 'FireOS', value: 'FireOS' },
                                { name: 'Nintendo Switch', value: 'NintendoSwitch' }
                            )))
            .addSubcommand(subcommand =>
                subcommand
                    .setName('unban')
                    .setDescription('Unban a device type')
                    .addStringOption(option =>
                        option.setName('device')
                            .setDescription('Device type to unban')
                            .setRequired(true)
                            .addChoices(
                                { name: 'Android', value: 'Android' },
                                { name: 'iOS', value: 'iOS' },
                                { name: 'Xbox', value: 'Xbox' },
                                { name: 'Windows', value: 'Windows' },
                                { name: 'PlayStation', value: 'PlayStation' },
                                { name: 'FireOS', value: 'FireOS' },
                                { name: 'Nintendo Switch', value: 'NintendoSwitch' }
                            )))
            .addSubcommand(subcommand =>
                subcommand
                    .setName('list')
                    .setDescription('Show banned devices')),
        async execute(interaction) {
            if (!isAdmin(interaction.user.id, interaction.user.username)) {
                return await interaction.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });
            }

            const subcommand = interaction.options.getSubcommand();
            const device = interaction.options.getString('device');

            if (!config.bannedDevices) {
                config.bannedDevices = [];
            }

            switch (subcommand) {
                case 'ban':
                    if (!config.bannedDevices.includes(device)) {
                        config.bannedDevices.push(device);
                        saveConfig();
                        log(`${interaction.user.username} banned device: ${device}`);
                        await interaction.reply(`🚫 \`${device}\` devices have been banned.`);
                    } else {
                        await interaction.reply(`⚠️ \`${device}\` devices are already banned.`);
                    }
                    break;

                case 'unban':
                    if (config.bannedDevices.includes(device)) {
                        config.bannedDevices = config.bannedDevices.filter(d => d !== device);
                        saveConfig();
                        log(`${interaction.user.username} unbanned device: ${device}`);
                        await interaction.reply(`✅ \`${device}\` devices have been unbanned.`);
                    } else {
                        await interaction.reply(`⚠️ \`${device}\` devices are not banned.`);
                    }
                    break;

                case 'list':
                    const embed = new EmbedBuilder()
                        .setTitle('🚫 Banned Devices')
                        .setDescription(config.bannedDevices.length > 0 ? config.bannedDevices.map(d => `• ${d}`).join('\n') : 'No devices banned')
                        .setColor('#FF0000')
                        .setTimestamp();
                    await interaction.reply({ embeds: [embed] });
                    break;
            }
        },
    },

    // Alt config command
    {
        data: new SlashCommandBuilder()
            .setName('alt-config')
            .setDescription('Configure alt account detection settings')
            .addSubcommand(subcommand =>
                subcommand
                    .setName('gamerscore')
                    .setDescription('Set maximum gamerscore for alt detection')
                    .addIntegerOption(option =>
                        option.setName('value')
                            .setDescription('Maximum gamerscore (0-50000)')
                            .setRequired(true)
                            .setMinValue(0)
                            .setMaxValue(50000)))
            .addSubcommand(subcommand =>
                subcommand
                    .setName('friends')
                    .setDescription('Set maximum friends count for alt detection')
                    .addIntegerOption(option =>
                        option.setName('value')
                            .setDescription('Maximum friends count (0-1000)')
                            .setRequired(true)
                            .setMinValue(0)
                            .setMaxValue(1000)))
            .addSubcommand(subcommand =>
                subcommand
                    .setName('followers')
                    .setDescription('Set maximum followers count for alt detection')
                    .addIntegerOption(option =>
                        option.setName('value')
                            .setDescription('Maximum followers count (0-1000)')
                            .setRequired(true)
                            .setMinValue(0)
                            .setMaxValue(1000)))
            .addSubcommand(subcommand =>
                subcommand
                    .setName('status')
                    .setDescription('Show current alt detection settings')),
        async execute(interaction) {
            if (!isAdmin(interaction.user.id, interaction.user.username)) {
                return await interaction.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });
            }

            const subcommand = interaction.options.getSubcommand();
            const value = interaction.options.getInteger('value');

            if (!config.altSystem) {
                config.altSystem = {
                    maxGamerScore: 1000,
                    maxFriends: 10,
                    maxFollowers: 10
                };
            }

            switch (subcommand) {
                case 'gamerscore':
                    config.altSystem.maxGamerScore = value;
                    saveConfig();
                    log(`${interaction.user.username} set alt detection max gamerscore to ${value}`);
                    await interaction.reply(`✅ Alt detection max gamerscore set to \`${value}\`.`);
                    break;

                case 'friends':
                    config.altSystem.maxFriends = value;
                    saveConfig();
                    log(`${interaction.user.username} set alt detection max friends to ${value}`);
                    await interaction.reply(`✅ Alt detection max friends set to \`${value}\`.`);
                    break;

                case 'followers':
                    config.altSystem.maxFollowers = value;
                    saveConfig();
                    log(`${interaction.user.username} set alt detection max followers to ${value}`);
                    await interaction.reply(`✅ Alt detection max followers set to \`${value}\`.`);
                    break;

                case 'status':
                    const embed = new EmbedBuilder()
                        .setTitle('🔍 Alt Detection Settings')
                        .addFields(
                            { name: 'Max Gamerscore', value: config.altSystem.maxGamerScore.toString(), inline: true },
                            { name: 'Max Friends', value: config.altSystem.maxFriends.toString(), inline: true },
                            { name: 'Max Followers', value: config.altSystem.maxFollowers.toString(), inline: true }
                        )
                        .setColor('#0099FF')
                        .setTimestamp();
                    await interaction.reply({ embeds: [embed] });
                    break;
            }
        },
    },
];

module.exports = commands;
