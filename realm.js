const AF = require('prismarine-auth');
const bedrock = require('bedrock-protocol');
const fs = require('fs');
const uuid = require('uuid');
const config = require('./config.json');
const { log, sendEmbed } = require('./utils');
let discordClient = null;

const realmConfig = config.realms[0];
if (!realmConfig) {
    throw new Error('No realm configuration found');
}

const { logChannels } = realmConfig;
if (!logChannels) {
    throw new Error('No log channels configured');
}

// Add function to set Discord client
function setDiscordClient(client) {
    discordClient = client;
    log('Discord client set:', discordClient ? 'Connected' : 'Not connected');
    
    // Test Discord connection
    if (discordClient && realmConfig) {
        sendEmbed({
            title: 'Bot Connected',
            description: `Connected to ${realmConfig.realmName}`,
            color: '#00FF00',
            timestamp: true
        }, realmConfig.logChannels.chat, discordClient)
        .then(() => log('Successfully sent connection message'))
        .catch(err => {
            log('Error testing Discord connection:', err.message);
        });
    }
}

// Add platform mapping
const PLATFORMS = {
    0: 'Unknown',
    1: 'Android',
    2: 'iOS',
    3: 'OSX',
    4: 'FireOS',
    5: 'GearVR',
    6: 'HoloLens',
    7: 'Windows',  // Win10 is actually Windows
    8: 'Windows',  // Both platform IDs map to Windows
    9: 'Dedicated',
    10: 'PS4',
    11: 'Switch',
    12: 'Xbox',
    13: 'Windows'  // WindowsPhone is also Windows
};

const players = new Map();
const realmClients = new Map();
const packetCounts = new Map();

const leftPlayers = new Set();
let lastLeaveCheck = Date.now();

// Utility function to track packet counts
function trackPacket(username, type) {
    if (!packetCounts.has(username)) {
        packetCounts.set(username, {
            normalPackets: 0,
            badPackets: 0,
            lastReset: Date.now()
        });
    }

    const info = packetCounts.get(username);
    
    // Reset counts every minute
    if (Date.now() - info.lastReset > 60000) {
        info.normalPackets = 0;
        info.badPackets = 0;
        info.lastReset = Date.now();
    }

    if (type === 'normal') {
        info.normalPackets++;
    } else {
        info.badPackets++;
    }
}




// Utility: Send a command to the Minecraft server
function sendCommand(client, ...commands) {
    commands.forEach((command) => {
        try {
            log(`Sending command: ${command}`);
            client.write('command_request', {
                command,
                origin: { 
                    type: 'player', 
                    uuid: uuid.v4(), 
                    request_id: uuid.v4() 
                },
                internal: true,
                version: 52,
            });
            log(`Command sent successfully: ${command}`);
        } catch (err) {
            log(`Error sending command: ${err.message}`);
        }
    });
}

// Function: Spawn a bot for a specific realm
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
        connectTimeout: 30000,
    });

    realmClients.set(realmConfig.realmCode, client);

    client.on('spawn', () => {
        log(`Bot spawned in realm: ${realmConfig.realmName}`);
    });

    client.on('player_list', (packet) => {
        if (!packet.records || !packet.records.records) {
            log('Error: Invalid player list packet received.');
            return;
        }
        
        if (!discordClient) {
            log('Warning: Discord client not initialized');
            return;
        }

        const currentPlayers = new Set();
        
        packet.records.records.forEach((player) => {
            if (!player || !player.username) return;
            
            const username = player.username;
            const platform = player.build_platform;
            
            log(`Player detected: ${username} on platform: ${PLATFORMS[platform] || platform}`);

            // Handle new joins
            if (!players.has(username)) {
                players.set(username, player);
                currentPlayers.add(username);

                // Send join message
                sendEmbed({
                    title: 'Player Joined',
                    description: `${username} joined the realm\nDevice: ${PLATFORMS[platform] || platform}`,
                    color: '#00FF00',
                    timestamp: true
                }, realmConfig.logChannels.joinsAndLeaves, discordClient)
                .catch(err => log(`Error sending join message: ${err.message}`));

                if (config.whitelist.includes(username)) {
                    log(`${username} is whitelisted`);
                    return;
                }

                // Check if platform matches any banned device
                const platformStr = String(platform).toLowerCase();
                const shouldBan = config.bannedDevices.some(device => 
                    platformStr.includes(device.toLowerCase()) || 
                    PLATFORMS[platform]?.toLowerCase().includes(device.toLowerCase())
                );

                if (shouldBan) {
                    log(`Kicking ${username} - banned platform: ${PLATFORMS[platform] || platform}`);
                    sendEmbed({
                        title: 'Player Kicked',
                        description: `${username} was kicked for using banned device: ${PLATFORMS[platform] || platform}`,
                        color: '#FF0000',
                        timestamp: true
                    }, realmConfig.logChannels.kicks, discordClient);
                    
                    sendCommand(client, `/kick "${username}" Device not allowed: ${PLATFORMS[platform] || platform}`);
                }
            } else {
                currentPlayers.add(username);
            }



            // Check for malformed packets
            trackPacket(username, 'normal');
            const packetInfo = packetCounts.get(username);
            if (packetInfo.badPackets > 10) {
                log(`Kicking ${username} for malformed packets`);
                sendCommand(client, `/kick "${username}" Malformed Packets Detected`);
            }
        });

        
        // Second pass: check for leaves
        for (const [username, playerData] of players.entries()) {
            if (!currentPlayers.has(username) && 
                username !== config.username && 
                !leftPlayers.has(username)) {
                
                leftPlayers.add(username);
                log(`Player left: ${username}`);
                sendEmbed({
                    title: 'Player Left',
                    description: `${username} left the realm`,
                    color: '#FFA500',
                    timestamp: true
                }, realmConfig.logChannels.joinsAndLeaves, discordClient)
                .catch(err => log(`Error sending leave message: ${err.message}`));
                
                players.delete(username);
                setTimeout(() => leftPlayers.delete(username), 5000);
            }
        }
    });




    client.on('text', (packet) => {
        if (packet.type === 'translation') {
            return;
        }
        
        const username = packet.source_name;
        const message = packet.message;
        
        // Debug logging
        log(`Text packet received - Type: ${packet.type}, Username: ${username}, Message: ${message}`);
        
        // Handle JSON formatted messages
        if (packet.type === 'json') {
            try {
                const jsonMessage = JSON.parse(message);
                log('Parsed JSON message:', JSON.stringify(jsonMessage, null, 2));
                
                if (jsonMessage.rawtext && jsonMessage.rawtext[0].text) {
                    const text = jsonMessage.rawtext[0].text;
                    
                    // Skip Discord messages
                    if (text.includes('§9[Discord]')) {
                        return;
                    }
                    
                    // Clean up color codes
                    const cleanMessage = text.replace(/§[0-9a-fk-or]/g, '');
                    
                    // Only relay if it looks like a player message
                    if (cleanMessage.includes('|')) {
                        log('Sending chat message to Discord:', cleanMessage);
                        sendEmbed({
                            title: 'Minecraft Chat',
                            description: cleanMessage,
                            color: '#5CD65C',
                            footer: `From: ${realmConfig.realmName}`,
                            timestamp: true
                        }, realmConfig.logChannels.chat, discordClient)
                        .catch(err => log('Error sending chat message:', err));
                    }
                }
            } catch (err) {
                log('Error parsing JSON message:', err.message);
            }
            return;
        }
        
        // Handle regular chat messages
        if (packet.type === 'chat' && username && !username.includes('CONSOLE')) {
            const cleanMessage = message.replace(/§[0-9a-fk-or]/g, '');
            log('Sending regular chat message to Discord:', cleanMessage);
            sendEmbed({
                title: 'Minecraft Chat',
                description: cleanMessage,
                color: '#5CD65C',
                footer: `From: ${realmConfig.realmName}`,
                timestamp: true
            }, realmConfig.logChannels.chat, discordClient)
            .catch(err => log('Error sending chat message:', err));
        }
    });







    // Handle player leaves

    client.on('remove_player', (packet) => {
        const username = packet.username;
        if (username && username !== config.username) {
            sendEmbed({
                title: 'Player Left',
                description: `${username} left the realm`,
                color: '#FFA500',
                timestamp: true
            }, realmConfig.logChannels.joinsAndLeaves, discordClient)
            .then(() => log(`Successfully sent remove message for ${username}`))
            .catch(err => log(`Error sending remove message for ${username}:`, err));
        }
    });

    client.on('error', (err) => {
        log(`Bot error in realm ${realmConfig.realmName}: ${err.message}`);
        // Attempt to reconnect after error
        setTimeout(() => {
            log(`Attempting to reconnect to realm: ${realmConfig.realmName}`);
            spawnBot();
        }, 5000);
    });

    client.on('kick', (reason) => {
        log(`Bot was kicked from realm ${realmConfig.realmName}: ${reason}`);
        sendEmbed({
            title: 'Realm Kick',
            description: `A player was kicked from the realm\nReason: ${reason}`,
            color: '#FF0000',
            timestamp: true
        }, realmConfig.logChannels.kicks, discordClient)
        .then(() => log('Successfully sent kick message'))
        .catch(err => log('Error sending kick message:', err));
        
        // Attempt to reconnect after kick
        setTimeout(() => {
            log(`Attempting to reconnect to realm: ${realmConfig.realmName}`);
            spawnBot();
        }, 5000);
    });

    return client;
}

// Function: Relay Discord messages to Minecraft
function relayMessageFromDiscordToMinecraft(message) {
    const client = realmClients.get(realmConfig.realmCode);

    if (!client) {
        log(`No client available for realm: ${realmConfig.realmName}`);

        return;
    }

    try {
        const username = message.member?.displayName || message.author.username;
        const cleanMessage = message.content.replace(/[§#"\\]/g, '');
        
        // Use tellraw for better formatting control
        const tellrawCommand = `/tellraw @a {"rawtext":[{"text":"§9[Discord] §f${username} §8» §r${cleanMessage}"}]}`;
        
        client.write('command_request', {
            command: tellrawCommand,
            origin: {
                type: 'player',
                uuid: uuid.v4(),
                request_id: uuid.v4()
            },
            internal: false,
            version: 52
        });
        
        log(`Relayed to Minecraft: ${username}: ${cleanMessage}`);
    } catch (err) {
        log(`Error relaying to Minecraft: ${err.message}`);
    }
}


module.exports = { spawnBot, relayMessageFromDiscordToMinecraft, setDiscordClient };
