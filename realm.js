const axios = require('axios');
const AF = require('prismarine-auth');
const bedrock = require('bedrock-protocol');
const uuid = require('uuid');
const config = require('./config.json');
const { log, sendEmbed } = require('./utils');

let discordClient = null;
const realmConfig = config.realms[0];
if (!realmConfig) throw new Error('No realm configuration found');
if (!realmConfig.logChannels) throw new Error('No log channels configured');

const players = new Map();
const realmClients = new Map();

const devicetotid = {
    "Android": "1739947436",
    "iOS": "1810924247",
    "Xbox": "1828326430",
    "Windows": "896928775",
    "PlayStation": "2044456598",
    "FireOS": "1944307183",
    "NintendoSwitch": "2047319603"
};

const tidtodevice = {
    "1739947436": "Android",
    "1810924247": "iOS",
    "1828326430": "Xbox",
    "896928775": "Windows",
    "2044456598": "PlayStation",
    "1944307183": "FireOS",
    "2047319603": "NintendoSwitch"
};

const devices = [
    "Undefined", "Android", "iOS", "OSX", "FireOS", "GearVR", "Hololens",
    "Windows", "Win32", "Dedicated", "TVOS", "PlayStation", "NintendoSwitch",
    "Xbox", "WindowsPhone"
];

const LEAVE_THRESHOLD = 7000;

function hasInvalidCharacters(name) {
    const validPattern = /^[a-zA-Z0-9_-]+$/;
    return !validPattern.test(name);
}

async function isAltAccount(xuid, username, auth) {
    try {
        const response = await axios.get(`https://profile.xboxlive.com/users/xuid(${xuid})/profile/settings`, {
            headers: {
                "Authorization": `XBL3.0 x=${auth.userHash};${auth.XSTSToken}`,
                "Accept": "application/json",
                "x-xbl-contract-version": 2
            },
            params: {
                settings: 'Gamerscore,People,Followers'
            }
        });

        const settings = response.data.profileUsers[0].settings.reduce((acc, setting) => {
            acc[setting.id] = setting.value;
            return acc;
        }, {});

        const gamerScore = parseInt(settings.Gamerscore || "0", 10);
        const friendsCount = parseInt(settings.People || "0", 10);
        const followersCount = parseInt(settings.Followers || "0", 10);

        log(`Alt Check for ${username}: Gamerscore=${gamerScore}, Friends=${friendsCount}, Followers=${followersCount}`);

        if (gamerScore < config.altSystem.maxGamerScore ||
            friendsCount < config.altSystem.maxFriends ||
            followersCount < config.altSystem.maxFollowers) {
            return { isAlt: true, gamerScore, friendsCount, followersCount };
        }

        return { isAlt: false };
    } catch (err) {
        log(`Error checking alt for ${username}: ${err.message}`);
        return { isAlt: false };
    }
}

function sendCommand(client, command) {
    try {
        client.write('command_request', {
            command,
            origin: { type: 'player', uuid: uuid.v4(), request_id: uuid.v4() },
            internal: true,
            version: 52,
        });
    } catch (err) {
        log(`Error sending command: ${err.message}`);
    }
}

function sendCommandToRealm(command) {
    const client = realmClients.get(realmConfig.realmCode);
    if (!client) return;
    sendCommand(client, command);
}

function setDiscordClient(client) {
    discordClient = client;
    log('Discord client set:', discordClient ? 'Connected' : 'Not connected');
}

async function spawnBot() {
    const authFlow = new AF.Authflow(config.username, './accounts', {
        authTitle: AF.Titles.MinecraftNintendoSwitch,
        deviceType: 'Nintendo',
        flow: 'live',
    });

    const client = bedrock.createClient({
        username: config.username,
        profilesFolder: './accounts',
        realms: { realmInvite: realmConfig.realmCode },
        conLog: log,
    });

    const auth = await authFlow.getXboxToken();
    realmClients.set(realmConfig.realmCode, client);

    client.on('spawn', () => {
        log(`Bot spawned in realm: ${realmConfig.realmName}`);
    });

    client.on('player_list', async (packet) => {
        if (!packet.records || !packet.records.records) return;

        const currentPlayers = new Set();

        for (const player of packet.records.records) {
            if (!player || !player.username || player.username === client.username) continue;

            const username = player.username;
            const xuid = player.xbox_user_id;
            const osRaw = player.build_platform;
            const os = typeof osRaw === 'number' ? devices[osRaw] : osRaw;
            currentPlayers.add(username);

            // Skip detection if whitelisted forgot to add this
            if (config.whitelist.includes(username)) {
                if (!players.has(username)) {
                    players.set(username, { data: player, lastSeen: Date.now() });
                    log(`Whitelisted player joined: ${username} (skipping checks)`);
                    sendEmbed({
                        title: 'Whitelisted Player Joined',
                        description: `${username} joined and was skipped from all checks.\nDevice: ${os}`,
                        color: '#00FFFF',
                        timestamp: true
                    }, realmConfig.logChannels.joinsAndLeaves, discordClient);
                } else {
                    const entry = players.get(username);
                    entry.lastSeen = Date.now();
                    players.set(username, entry);
                }
                continue;
            }

            // Invalid name
            if (hasInvalidCharacters(username)) {
                log(`Kicking ${username} - invalid characters`);
                sendCommand(client, `/kick "${username}" Invalid characters in name`);
                sendEmbed({
                    title: 'Player Kicked',
                    description: `${username} was kicked\nReason: Invalid characters in name`,
                    color: '#FF0000',
                    timestamp: true
                }, realmConfig.logChannels.kicks, discordClient);
                players.delete(username);
                continue;
            }

            // Alt account check
            if (config.altSystem) {
                const altCheck = await isAltAccount(xuid, username, auth);
                if (altCheck.isAlt) {
                    log(`Kicking ${username} - Alt detected`);
                    sendCommand(client, `/kick "${username}" Alt accounts are not allowed`);
                    sendEmbed({
                        title: 'Player Kicked',
                        description: `${username} was kicked\nReason: Alt account`,
                        color: '#FF0000',
                        timestamp: true
                    }, realmConfig.logChannels.kicks, discordClient);
                    players.delete(username);
                    continue;
                }
            }

            // Normal player
            if (!players.has(username)) {
                players.set(username, { data: player, lastSeen: Date.now() });
                log(`Player joined: ${username} on ${os}`);
                sendEmbed({
                    title: 'Player Joined',
                    description: `${username} joined the realm\nDevice: ${os}`,
                    color: '#00FF00',
                    timestamp: true
                }, realmConfig.logChannels.joinsAndLeaves, discordClient);
            } else {
                const entry = players.get(username);
                entry.lastSeen = Date.now();
                players.set(username, entry);
            }
        }

        // Leave detection
        for (const [username, entry] of players) {
            if (!currentPlayers.has(username)) {
                setTimeout(() => {
                    const currentEntry = players.get(username);
                    if (currentEntry && (Date.now() - currentEntry.lastSeen >= LEAVE_THRESHOLD)) {
                        players.delete(username);
                        log(`Player left: ${username}`);
                        sendEmbed({
                            title: 'Player Left',
                            description: `${username} left the realm`,
                            color: '#FFA500',
                            timestamp: true
                        }, realmConfig.logChannels.joinsAndLeaves, discordClient);
                    }
                }, LEAVE_THRESHOLD);
            }
        }
    });

    client.on('error', (err) => {
        log(`Bot error in realm ${realmConfig.realmName}: ${err.message}`);
        setTimeout(() => spawnBot(), 5000);
    });

    client.on('kick', (reason) => {
        log(`Bot was kicked from realm ${realmConfig.realmName}: ${reason}`);
        sendEmbed({
            title: 'Realm Kick',
            description: `Bot was kicked from the realm\nReason: ${reason}`,
            color: '#FF0000',
            timestamp: true
        }, realmConfig.logChannels.kicks, discordClient);

        setTimeout(() => spawnBot(), 5000);
    });

    return client;
}

function relayMessageFromDiscordToMinecraft(message) {
    const client = realmClients.get(realmConfig.realmCode);
    if (!client) return;

    try {
        const username = message.member?.displayName || message.author.username;
        const cleanMessage = message.content.replace(/[§#"\\]/g, '');
        const tellrawCommand = `/tellraw @a {"rawtext":[{"text":"§9[Discord] §f${username} §8» §r${cleanMessage}"}]}`;
        sendCommand(client, tellrawCommand);
    } catch (err) {
        log(`Error relaying Discord message: ${err.message}`);
    }
}

module.exports = {
    spawnBot,
    relayMessageFromDiscordToMinecraft,
    setDiscordClient,
    sendCommandToRealm
};
