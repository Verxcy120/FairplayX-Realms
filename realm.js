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
const packetCounts = new Map();
const leftPlayers = new Set();

// Device mappings
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

// Define leave threshold in milliseconds (adjust as needed)
const LEAVE_THRESHOLD = 7000;

function trackPacket(username, type) {
    if (!packetCounts.has(username)) {
        packetCounts.set(username, { count: 1, firstPacketTime: Date.now(), badPackets: 0 });
    } else {
        const packetInfo = packetCounts.get(username);
        packetInfo.count++;
        if (type === 'bad') packetInfo.badPackets++;
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

            if (!players.has(username)) {
                players.set(username, { data: player, lastSeen: Date.now() });
                log(`Player joined: ${username} on ${os}`);
                sendEmbed({
                    title: 'Player Joined',
                    description: `${username} joined the realm\nDevice: ${os}`,
                    color: '#00FF00',
                    timestamp: true
                }, realmConfig.logChannels.joinsAndLeaves, discordClient);

                // New banned device check
                if (!config.whitelist.includes(username) && config.bannedDevices && config.bannedDevices.includes(os)) {
                    log(`Kicking ${username} - banned device: ${os}`);
                    sendCommand(client, `/kick "${username}" Banned device ${os} is not allowed`);
                    sendEmbed({
                        title: 'Player Kicked',
                        description: `${username} was kicked from the realm\nReason: Banned device (${os}) is not allowed`,
                        color: '#FF0000',
                        timestamp: true
                    }, realmConfig.logChannels.kicks, discordClient);
                    players.delete(username); // remove kicked player immediately
                    continue;
                }
                // End banned device check

                // Skip device check for whitelisted players
                if (!config.whitelist.includes(username)) {
                    try {
                        const response = await axios.get(`https://userpresence.xboxlive.com/users/xuid(${xuid})`, {
                            headers: {
                                "Authorization": `XBL3.0 x=${auth.userHash};${auth.XSTSToken}`,
                                "Accept": "application/json",
                                "Accept-Language": "en-US",
                                "x-xbl-contract-version": 3
                            }
                        });

                        if (response.data.devices === undefined) {
                            log(`Skipping device check for ${username} - private profile or appearing offline`);
                            // Do not kick user; skip further device verification.
                        } else {
                            const devicess = response.data.devices.filter(device =>
                                device.titles.some(title => title.name.startsWith("Minecraft") && title.state === "Active")
                            );

                            if (!devicess.length) {
                                log(`Kicking ${username} - no active Minecraft`);
                                sendCommand(client, `/kick "${username}" No active Minecraft title found`);
                                sendEmbed({
                                    title: 'Player Kicked',
                                    description: `${username} was kicked from the realm\nReason: No active Minecraft title found\nDevice: ${os}`,
                                    color: '#FF0000',
                                    timestamp: true
                                }, realmConfig.logChannels.kicks, discordClient);
                                players.delete(username); // remove kicked player immediately
                                continue;
                            }

                            let foundValidDevice = false;
                            for (const device of devicess) {
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
                                for (const device of devicess) {
                                    for (const title of device.titles) {
                                        if (devicetotid[os] !== title.id && title.id !== "750323071") {
                                            trueDevice = tidtodevice[title.id] || "Unknown";
                                            break;
                                        }
                                    }
                                    if (trueDevice !== "Unknown") break;
                                }
                                log(`Kicking ${username} - device spoof detected (${os} vs ${trueDevice})`);
                                sendCommand(client, `/kick "${username}" EditionFaker is not allowed`);
                                sendEmbed({
                                    title: 'Player Kicked',
                                    description: `${username} was kicked from the realm\nReason: EditionFaker is not allowed (spoof detected: ${os} vs ${trueDevice})`,
                                    color: '#FF0000',
                                    timestamp: true
                                }, realmConfig.logChannels.kicks, discordClient);
                                players.delete(username); // remove kicked player immediately
                            }
                        }
                    } catch (err) {
                        log(`Error checking device for ${username}:`, err.message);
                    }
                }
            } else {
                const entry = players.get(username);
                entry.lastSeen = Date.now();
                players.set(username, entry);
            }
        }

        // Delay removal of players not seen in the current packet
        for (const [username, entry] of players) {
            if (!currentPlayers.has(username)) {
                setTimeout(() => {
                    const currentEntry = players.get(username);
                    // If the player hasn't been updated in the last LEAVE_THRESHOLD ms, consider them left
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

    client.on('text', (packet) => {
        if (packet.type === 'translation') return;
        
        const username = packet.source_name;
        const message = packet.message;
        
        if (packet.type === 'json') {
            try {
                const jsonMessage = JSON.parse(message);
                if (jsonMessage.rawtext && jsonMessage.rawtext[0].text) {
                    const text = jsonMessage.rawtext[0].text;
                    if (text.includes('§9[Discord]')) return;
                    
                    const cleanMessage = text.replace(/§[0-9a-fk-or]/g, '');
                    if (cleanMessage.includes('|')) {
                        sendEmbed({
                            title: 'Minecraft Chat',
                            description: cleanMessage,
                            color: '#5CD65C',
                            footer: `From: ${realmConfig.realmName}`,
                            timestamp: true
                        }, realmConfig.logChannels.chat, discordClient);
                    }
                }
            } catch (err) {
                log('Error parsing JSON message:', err.message);
            }
            return;
        }
        
        if (packet.type === 'chat' && username && !username.includes('CONSOLE')) {
            const cleanMessage = message.replace(/§[0-9a-fk-or]/g, '');
            sendEmbed({
                title: 'Minecraft Chat',
                description: cleanMessage,
                color: '#5CD65C',
                footer: `From: ${realmConfig.realmName}`,
                timestamp: true
            }, realmConfig.logChannels.chat, discordClient);
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
