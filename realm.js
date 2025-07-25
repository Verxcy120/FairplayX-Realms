const axios = require('axios');
const AF = require('prismarine-auth');
const bedrock = require('bedrock-protocol');
const uuid = require('uuid');
const config = require('./config.json');
const { log, sendEmbed, setClient } = require('./utils');
// Anticheat system disabled

let discordClient = null;
const realmConfig = config.realms[0];
const serverConfig = config.servers && config.servers[0];

// Check if we have either realm or server config
if (!realmConfig && !serverConfig) {
    throw new Error('No realm or server configuration found');
}

// Check which configuration is properly set up
function isRealmConfigured(realm) {
    return realm && realm.realmCode && realm.realmCode !== 'Your Realm Code' && realm.realmCode.trim() !== '';
}

function isServerConfigured(server) {
    return server && server.host && server.port && 
           server.host !== 'your.server.ip' && server.host.trim() !== '' &&
           server.port !== 0;
}

const realmIsConfigured = isRealmConfigured(realmConfig);
const serverIsConfigured = isServerConfigured(serverConfig);

let activeConfig;
if (serverIsConfigured && !realmIsConfigured) {
    activeConfig = serverConfig;
} else if (realmIsConfigured && !serverIsConfigured) {
    activeConfig = realmConfig;
} else if (serverIsConfigured && realmIsConfigured) {
    // Both are configured, prioritize server
    activeConfig = serverConfig;
} else {
    throw new Error('No valid realm or server configuration found. Please check your config.json');
}
if (!activeConfig.logChannels) throw new Error('No log channels configured');

const players = new Map();
const clients = new Map();
const entityToPlayer = new Map(); // Map entity IDs to player usernames

// Helper function to get player username by entity ID
function getPlayerByEntityId(entityId) {
    return entityToPlayer.get(entityId) || null;
}

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
    setClient(client); // Also set the client in utils.js
    log('Discord client set:', discordClient ? 'Connected' : 'Not connected');
}

async function spawnBot() {

    const authFlow = new AF.Authflow(config.username, './accounts', {
        authTitle: AF.Titles.MinecraftNintendoSwitch,
        deviceType: 'Nintendo',
        flow: 'live',
    });

    let client;
    let connectionKey;
    
    if (activeConfig === serverConfig) {
        // Connect to server using IP and port
        client = bedrock.createClient({
            username: config.username,
            profilesFolder: './accounts',
            host: serverConfig.host,
            port: serverConfig.port,
            conLog: log,
        });
        connectionKey = `${serverConfig.host}:${serverConfig.port}`;
        log(`Connecting to server: ${serverConfig.serverName} at ${serverConfig.host}:${serverConfig.port}`);
    } else if (activeConfig === realmConfig) {
        // Connect to realm using realm code
        client = bedrock.createClient({
            username: config.username,
            profilesFolder: './accounts',
            realms: { realmInvite: realmConfig.realmCode },
            conLog: log,
        });
        connectionKey = realmConfig.realmCode;
        log(`Connecting to realm: ${realmConfig.realmName}`);
    }

    const auth = await authFlow.getXboxToken();
    clients.set(connectionKey, client);

    client.on('spawn', () => {
        if (activeConfig === realmConfig) {
            log(`Bot spawned in realm: ${realmConfig.realmName}`);
        } else {
            log(`Bot spawned in server: ${serverConfig.serverName}`);
        }
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
                    channelId: activeConfig.logChannels.kicks,
                    timestamp: true
                });
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
                        channelId: activeConfig.logChannels.kicks,
                        timestamp: true
                    });
                    players.delete(username);
                    continue;
                }
            }

            // --- Banned Player Check ---
            if (config.bannedPlayers && config.bannedPlayers.includes(username)) {
                log(`Kicking ${username} - player is banned`);
                sendCommand(client, `/kick "${username}" You are banned from this server`);
                sendEmbed({
                    title: 'Player Kicked',
                    description: `${username} was kicked\nReason: Player is banned`,
                    color: '#FF0000',
                    channelId: activeConfig.logChannels.kicks,
                    timestamp: true
                });
                players.delete(username);
                continue;
            }

            if (!players.has(username)) {
                players.set(username, { data: player, lastSeen: Date.now() });
                
                // Map entity ID to player username for anticheat
                if (player.runtime_entity_id) {
                    entityToPlayer.set(player.runtime_entity_id, username);
                }
                
                // Anticheat system disabled
                
                log(`Player joined: ${username} on ${os}`);
                sendEmbed({
                    title: 'Player Joined',
                    description: `${username} joined the ${activeConfig === realmConfig ? 'realm' : 'server'}\nDevice: ${os}`,
                    color: '#00FF00',
                    channelId: activeConfig.logChannels.joinsAndLeaves,
                    timestamp: true
                });

                // --- Banned Device Detection ---
                if (!config.whitelist.includes(username) && config.bannedDevices && config.bannedDevices.includes(os)) {
                    log(`Kicking ${username} - banned device: ${os}`);
                    sendCommand(client, `/kick "${username}" Banned device ${os} is not allowed`);
                    sendEmbed({
                        title: 'Player Kicked',
                        description: `${username} was kicked\nReason: Banned device (${os}) is not allowed`,
                        color: '#FF0000',
                        channelId: activeConfig.logChannels.kicks,
                        timestamp: true
                    });
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
                                channelId: activeConfig.logChannels.kicks,
                                timestamp: true
                            });
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
                                channelId: activeConfig.logChannels.kicks,
                                timestamp: true
                            });
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
                        // Clean up entity mapping
                        for (const [entityId, playerName] of entityToPlayer) {
                            if (playerName === username) {
                                entityToPlayer.delete(entityId);
                                break;
                            }
                        }
                        
                        players.delete(username);
                        
                        // Anticheat system disabled
                        
                        log(`Player left: ${username}`);
                        sendEmbed({
                            title: 'Player Left',
                            description: `${username} left the ${activeConfig === realmConfig ? 'realm' : 'server'}`,
                            color: '#FFA500',
                            channelId: activeConfig.logChannels.joinsAndLeaves,
                            timestamp: true
                        });
                    }
                }, LEAVE_THRESHOLD);
            }
        }
    });

    client.on('error', (err) => {
        const connectionName = activeConfig === realmConfig ? realmConfig.realmName : serverConfig.serverName;
        log(`Bot error in ${activeConfig === realmConfig ? 'realm' : 'server'} ${connectionName}: ${err.message}`);
        setTimeout(() => spawnBot(), 5000);
    });

    client.on('kick', (reason) => {
        const connectionName = activeConfig === realmConfig ? realmConfig.realmName : serverConfig.serverName;
        log(`Bot was kicked from ${activeConfig === realmConfig ? 'realm' : 'server'} ${connectionName}: ${reason}`);
        sendEmbed({
            title: activeConfig === realmConfig ? 'Realm Kick' : 'Server Kick',
            description: `Bot was kicked from the ${activeConfig === realmConfig ? 'realm' : 'server'}\nReason: ${reason}`,
            color: '#FF0000',
            channelId: activeConfig.logChannels.kicks,
            timestamp: true
        });

        setTimeout(() => spawnBot(), 5000);
    });

    // --- Anticheat Packet Listeners ---
    client.on('packet', (data, metadata) => {
        // Anticheat system disabled - no packet processing
    });

    return client;
}

function relayMessageFromDiscordToMinecraft(message) {
    let client;
    if (activeConfig === realmConfig) {
        client = clients.get(realmConfig.realmCode);
    } else if (activeConfig === serverConfig) {
        client = clients.get(`${serverConfig.host}:${serverConfig.port}`);
    }
    
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
