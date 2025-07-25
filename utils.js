const discord = require('discord.js');
const fs = require('fs');
const config = require('./config.json');

let client = null; // <-- Ensure this is set from your main file

// Allow setting client externally
function setClient(c) {
    client = c;
}

// Logging function
function log(...text) {
    console.log(new Date().toLocaleString(), '|', ...text);
}

// Send Embed to Discord Channel (object-based)
async function sendEmbed({ title = "Bot Message", description, color = 'Grey', channelId, timestamp = true }) {
    const embed = new discord.EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(color);

    if (timestamp) embed.setTimestamp();

    try {
        const channel = await client.channels.fetch(channelId);
        await channel.send({ embeds: [embed] });
    } catch (err) {
        log("Error sending embed:", err.message);
    }
}

module.exports = { log, sendEmbed, setClient };
