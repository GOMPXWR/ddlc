const { Client, Intents, MessageEmbed, Collection } = require('discord.js');
const axios = require('axios');
const cheerio = require('cheerio');

const client = new Client({
    intents: [
        Intents.FLAGS.GUILDS,
        Intents.FLAGS.GUILD_MESSAGES,
        Intents.FLAGS.GUILD_MESSAGE_REACTIONS,
        Intents.FLAGS.MESSAGE_CONTENT
    ]
});

// Información de versión y estado
const BOT_VERSION = "2.1.0";
const LAST_UPDATE = new Date().toISOString();
const RELEASE_NOTES = "🆕 Integración con X (Twitter)\n✅ Verificación de links e imágenes\n⚡ Mejor estabilidad en embeds";

// Tiempos de última verificación
let lastChecked = {
    pClubYouTube: Date.now(),
    pClubTwitter: Date.now(),
    pClubMerch: Date.now(),
    pClubAnnouncements: Date.now(),
    ddlcNews: Date.now(),
    ddlcMerch: Date.now(),
    teamSalvato: Date.now(),
    ddlcModsTwitter: Date.now(),
    ddlcGameTwitter: Date.now()
};

// Configuración general del servidor
let serverConfig = {
    notificationChannel: null,
    mentionRole: null,
    checkInterval: 300000 // 5 minutos
};

// Fuentes oficiales
const PCLUB_SOURCES = {
    youtube: 'https://www.youtube.com/@ProjectClub_/videos',
    twitter: 'https://nitter.net/ProjectClub_/rss',
    merch: 'https://www.reddit.com/r/ProjectClub/search.json?q=merch+OR+mercancía+OR+tienda&sort=new',
    announcements: 'https://www.reddit.com/r/ProjectClub/new/.json'
};

const DDLC_SOURCES = {
    officialNews: 'https://www.reddit.com/r/DDLC/new/.json',
    ddlcMods: 'https://www.reddit.com/r/DDLCMods/new/.json',
    teamSalvato: 'https://nitter.net/TeamSalvato/rss',
    ddlcMerch: 'https://www.reddit.com/r/DDLC/search.json?q=merch+OR+store+OR+shop&sort=new'
};

// 🐦 Nuevas fuentes de Twitter/X usando twitrss.me
const TWITTER_SOURCES = {
    pclub: 'https://twitrss.me/twitter_user_to_rss/?user=ProjectClub_',
    teamSalvato: 'https://twitrss.me/twitter_user_to_rss/?user=TeamSalvato',
    ddlcMods: 'https://twitrss.me/twitter_user_to_rss/?user=DDLCMods',
    ddlcGame: 'https://twitrss.me/twitter_user_to_rss/?user=DDLCGame'
};

let lastPosts = {
    pClubYouTube: '',
    pClubTwitter: '',
    pClubMerch: '',
    pClubAnnouncements: '',
    ddlcNews: '',
    ddlcMods: '',
    teamSalvato: '',
    ddlcMerch: '',
    ddlcModsTwitter: '',
    ddlcGameTwitter: ''
};

// ===== FUNCIONES BASE =====

async function isLinkAlive(url) {
    try {
        const res = await axios.head(url, { maxRedirects: 2, timeout: 5000 });
        return res.status >= 200 && res.status < 400;
    } catch {
        try {
            const res = await axios.get(url, { maxRedirects: 2, timeout: 5000 });
            return res.status >= 200 && res.status < 400;
        } catch {
            return false;
        }
    }
}

async function sendNotification(embed, type) {
    try {
        const channel = await client.channels.fetch(serverConfig.notificationChannel);
        let mention = serverConfig.mentionRole ? `<@&${serverConfig.mentionRole}> ` : '';

        const embedData = embed.toJSON();
        if (embedData.url && !(await isLinkAlive(embedData.url))) {
            console.warn(`⚠️ Link caído: ${embedData.url}`);
            return;
        }
        if (embedData.image?.url && !(await isLinkAlive(embedData.image.url))) {
            console.warn(`⚠️ Imagen caída: ${embedData.image.url}`);
            embed.setImage(null);
        }

        let content = {
            pclub_video: '🎥 **¡NUEVO VIDEO DE P CLUB!**',
            pclub_tweet: '🐦 **¡NUEVO TWEET DE P CLUB!**',
            pclub_merch: '🛍️ **¡NUEVA MERCANCÍA DE P CLUB!**',
            pclub_announcement: '📢 **¡ANUNCIO IMPORTANTE DE P CLUB!**',
            ddlc_news: '💖 **¡NUEVA NOTICIA DE DDLC!**',
            ddlc_merch: '🎁 **¡NUEVA MERCANCÍA DE DDLC!**',
            ddlc_tweet: '🐦 **¡TWEET OFICIAL DE DDLC!**',
            ddlcMods_tweet: '🧩 **¡NUEVO POST DE DDLC MODS!**',
            ddlcGame_tweet: '💖 **¡ACTUALIZACIÓN DE DDLCGAME!**'
        }[type] || '🔔 **¡NUEVA ACTUALIZACIÓN!**';

        await channel.send({ content: mention + content, embeds: [embed] });
    } catch (err) {
        console.error('Error enviando notificación:', err);
    }
}

// ===== FEEDS DE X =====

async function checkTwitterFeed(user, type, color = '#1DA1F2') {
    try {
        const response = await axios.get(TWITTER_SOURCES[user], {
            headers: { 'User-Agent': 'Mozilla/5.0 (TwitterBot/1.0)' }
        });
        const $ = cheerio.load(response.data);
        const latest = $('item').first();

        if (!latest) return;

        const title = latest.find('title').text();
        const link = latest.find('link').text();
        const date = latest.find('pubDate').text();

        if (lastPosts[user] === link) return;
        lastPosts[user] = link;
        lastChecked[user] = Date.now();

        const embed = new MessageEmbed()
            .setTitle(`🐦 NUEVO POST EN X (${user})`)
            .setURL(link)
            .setDescription(title.substring(0, 250))
            .setColor(color)
            .setTimestamp(new Date(date))
            .setFooter(`X (Twitter) • @${user}`);

        await sendNotification(embed, `${user}_tweet`);
    } catch (error) {
        console.error(`Error al chequear tweets de ${user}:`, error.message);
    }
}

// ===== FUNCIÓN PRINCIPAL DE CHEQUEO =====
async function checkForUpdates() {
    if (!serverConfig.notificationChannel) return;
    try {
        // Ya existentes
        await checkPClubYouTube();
        await checkPClubMerch();
        await checkPClubAnnouncements();
        await checkDDLCNews();
        await checkDDLCMerch();

        // Nuevos de Twitter/X
        await checkTwitterFeed('pclub', 'pclub_tweet', '#FF6B6B');
        await checkTwitterFeed('teamSalvato', 'ddlc_tweet', '#F08A5D');
        await checkTwitterFeed('ddlcMods', 'ddlcMods_tweet', '#9B59B6');
        await checkTwitterFeed('ddlcGame', 'ddlcGame_tweet', '#FF69B4');
    } catch (error) {
        console.error('Error en checkForUpdates:', error);
    }
}

// ===== RESTO DE FUNCIONES ORIGINALES =====
// (por espacio, mantén tus funciones de checkPClubYouTube, checkPClubMerch,
// checkPClubAnnouncements, checkDDLCNews, checkDDLCMerch y todos tus comandos
// slash tal como ya están; no necesitan cambios)

// ===== CLIENT READY =====
client.once('ready', async () => {
    console.log(`✅ ClubAssistant v${BOT_VERSION} conectado como ${client.user.tag}`);
    client.user.setActivity('P Club & DDLC Updates', { type: 'WATCHING' });

    const now = Date.now();
    Object.keys(lastChecked).forEach(k => lastChecked[k] = now);

    try {
        const commands = Object.values(slashCommands).map(c => c.data);
        await client.application.commands.set(commands);
        console.log(`✅ ${commands.length} slash commands registrados`);
    } catch (err) {
        console.error('❌ Error registrando slash commands:', err);
    }

    checkForUpdates();
    setInterval(checkForUpdates, serverConfig.checkInterval);
});

// ===== UTILIDADES =====
function formatUptime(ms) {
    const d = Math.floor(ms / 86400000);
    const h = Math.floor(ms / 3600000) % 24;
    const m = Math.floor(ms / 60000) % 60;
    const s = Math.floor(ms / 1000) % 60;
    return d > 0 ? `${d}d ${h}h ${m}m` :
           h > 0 ? `${h}h ${m}m ${s}s` :
           m > 0 ? `${m}m ${s}s` : `${s}s`;
}

client.on('error', console.error);
process.on('unhandledRejection', console.error);

// ===== LOGIN =====
client.login(process.env.DISCORD_TOKEN || process.env.TOKEN);
