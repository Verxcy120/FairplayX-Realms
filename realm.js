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

// --- Helper: Invalid Character Check ---
function hasInvalidCharacters(name) {
    const validPattern = /^[a-zA-Z0-9_-]+$/;
    return !validPattern.test(name);
}

// --- Helper: Alt Account Check ---
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

            // --- Invalid Character Detection ---
            if (hasInvalidCharacters(username)) {
                log(`Kicking ${username} - invalid characters in name`);
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

            // --- Alt Detection System ---
            if (!config.whitelist.includes(username) && config.altSystem) {
                const altCheck = await isAltAccount(xuid, username, auth);
                if (altCheck.isAlt) {
                    log(`Kicking ${username} - Alt detected (G:${altCheck.gamerScore}, F:${altCheck.friendsCount}, Fo:${altCheck.followersCount})`);
                    sendCommand(client, `/kick "${username}" Alt accounts are not allowed`);
                    sendEmbed({
                        title: 'Player Kicked',
                        description: `${username} was kicked\nReason: Detected as alt account\nGamerscore: ${altCheck.gamerScore}\nFriends: ${altCheck.friendsCount}\nFollowers: ${altCheck.followersCount}`,
                        color: '#FF0000',
                        timestamp: true
                    }, realmConfig.logChannels.kicks, discordClient);
                    players.delete(username);
                    continue;
                }
            }

            if (!players.has(username)) {
                players.set(username, { data: player, lastSeen: Date.now() });
                log(`Player joined: ${username} on ${os}`);
                sendEmbed({
                    title: 'Player Joined',
                    description: `${username} joined the realm\nDevice: ${os}`,
                    color: '#00FF00',
                    timestamp: true
                }, realmConfig.logChannels.joinsAndLeaves, discordClient);

                // --- Banned Device Detection ---
                if (!config.whitelist.includes(username) && config.bannedDevices && config.bannedDevices.includes(os)) {
                    log(`Kicking ${username} - banned device: ${os}`);
                    sendCommand(client, `/kick "${username}" Banned device ${os} is not allowed`);
                    sendEmbed({
                        title: 'Player Kicked',
                        description: `${username} was kicked\nReason: Banned device (${os}) is not allowed`,
                        color: '#FF0000',
                        timestamp: true
                    }, realmConfig.logChannels.kicks, discordClient);
                    players.delete(username);
                    continue;
                }

                // --- Device Spoof Detection ---
                try {
                    const presence = await axios.get(`https://userpresence.xboxlive.com/users/xuid(${xuid})`, {
                        headers: {
                            "Authorization": `XBL3.0 x=${auth.userHash};${auth.XSTSToken}`,
                            "Accept": "application/json",
                            "x-xbl-contract-version": 3
                        }
                    });

                    if (presence.data.devices === undefined) {
                        log(`Skipping spoof check for ${username} - private profile`);
                    } else {
                        const activeDevices = presence.data.devices.filter(device =>
                            device.titles.some(title => title.name.startsWith("Minecraft") && title.state === "Active")
                        );

                        if (!activeDevices.length) {
                            log(`Kicking ${username} - No active Minecraft found`);
                            sendCommand(client, `/kick "${username}" No active Minecraft session found`);
                            sendEmbed({
                                title: 'Player Kicked',
                                description: `${username} was kicked\nReason: No active Minecraft session`,
                                color: '#FF0000',
                                timestamp: true
                            }, realmConfig.logChannels.kicks, discordClient);
                            players.delete(username);
                            continue;
                        }

                        let foundValidDevice = false;
                        for (const device of activeDevices) {
                            for (const title of device.titles) {
                                if (devicetotid[os] === title.id) {
                                    foundValidDevice = true;
                                    break;
                                }
                            }
                            if (foundValidDevice) break;
                        }

                        if (!foundValidDevice) {
                            let trueDevice = "Unknown";
                            for (const device of activeDevices) {
                                for (const title of device.titles) {
                                    if (devicetotid[os] !== title.id && title.id !== "750323071") {
                                        trueDevice = tidtodevice[title.id] || "Unknown";
                                        break;
                                    }
                                }
                                if (trueDevice !== "Unknown") break;
                            }
                            log(`Kicking ${username} - Device Spoof detected (${os} vs ${trueDevice})`);
                            sendCommand(client, `/kick "${username}" EditionFaker not allowed`);
                            sendEmbed({
                                title: 'Player Kicked',
                                description: `${username} was kicked\nReason: EditionFaker (Spoofed Device: ${os} vs ${trueDevice})`,
                                color: '#FF0000',
                                timestamp: true
                            }, realmConfig.logChannels.kicks, discordClient);
                            players.delete(username);
                        }
                    }
                } catch (err) {
                    log(`Error checking device for ${username}: ${err.message}`);
                }
            } else {
                const entry = players.get(username);
                entry.lastSeen = Date.now();
                players.set(username, entry);
            }
        }

        // --- Player Left Check ---
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

module.exports = { spawnBot, relayMessageFromDiscordToMinecraft, setDiscordClient };
