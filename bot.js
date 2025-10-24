const { Client, Intents, MessageEmbed } = require('discord.js');
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

// Configuración
let serverConfig = {
    notificationChannel: null,
    mentionRole: null,
    checkInterval: 300000
};

// Fuentes oficiales P Club
const PCLUB_SOURCES = {
    youtube: 'https://www.youtube.com/@ProjectClub_/videos',
    twitter: 'https://nitter.net/ProjectClub_/rss',
    merch: 'https://www.reddit.com/r/ProjectClub/search.json?q=merch+OR+mercancía+OR+tienda&sort=new',
    announcements: 'https://www.reddit.com/r/ProjectClub/new/.json'
};

// Fuentes DDLC general
const DDLC_SOURCES = {
    officialNews: 'https://www.reddit.com/r/DDLC/new/.json',
    ddlcMods: 'https://www.reddit.com/r/DDLCMods/new/.json',
    teamSalvato: 'https://nitter.net/TeamSalvato/rss',
    ddlcMerch: 'https://www.reddit.com/r/DDLC/search.json?q=merch+OR+store+OR+shop&sort=new'
};

let lastPosts = {
    pClubYouTube: '',
    pClubTwitter: '',
    pClubMerch: '',
    pClubAnnouncements: '',
    ddlcNews: '',
    ddlcMods: '',
    teamSalvato: '',
    ddlcMerch: ''
};

client.once('ready', () => {
    console.log(`✅ ClubAssistant conectado como ${client.user.tag}`);
    client.user.setActivity('P Club & DDLC Updates', { type: 'WATCHING' });
    
    checkForUpdates();
    setInterval(checkForUpdates, serverConfig.checkInterval);
});

// Comandos básicos (sin slash commands por ahora)
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const args = message.content.slice('!').trim().split(/ +/);
    const command = args.shift().toLowerCase();

    switch(command) {
        case 'config':
            await configCommand(message, args);
            break;
        case 'fanart':
            await getFanart(message);
            break;
        case 'noticias':
            await getLatestNews(message);
            break;
        case 'merch':
            await getMerch(message);
            break;
        case 'mods':
            await getTopMods(message);
            break;
        case 'ddlc':
            await getDDLCNews(message);
            break;
        case 'pclub':
            await getPClubInfo(message);
            break;
        case 'estado':
            await showStatus(message);
            break;
        case 'ayuda':
            await showHelp(message);
            break;
    }
});

// Comando de configuración
async function configCommand(message, args) {
    if (!message.member.permissions.has('ADMINISTRATOR')) {
        return message.reply('❌ Necesitas permisos de administrador para configurar el bot.');
    }

    const channel = message.mentions.channels.first();
    const role = message.mentions.roles.first();

    if (!channel) {
        return message.reply('❌ Menciona un canal: `!config #canal @rol`');
    }

    serverConfig.notificationChannel = channel.id;
    serverConfig.mentionRole = role ? role.id : null;

    message.reply(`✅ Configuración guardada:\n📢 Canal: ${channel}\n${role ? `👥 Rol: ${role}` : '👥 Sin rol mencionado'}`);
}

// Función principal de chequeo
async function checkForUpdates() {
    if (!serverConfig.notificationChannel) return;

    try {
        await checkPClubYouTube();
        await checkPClubTwitter();
        await checkPClubMerch();
        await checkPClubAnnouncements();
        await checkDDLCNews();
        await checkDDLCMerch();
        await checkTeamSalvato();
    } catch (error) {
        console.error('Error en checkForUpdates:', error);
    }
}

// ========== P CLUB ==========
async function checkPClubYouTube() {
    try {
        const response = await axios.get(PCLUB_SOURCES.youtube, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });

        const $ = cheerio.load(response.data);
        const videoElements = $('a#video-title-link');
        
        if (videoElements.length > 0) {
            const latestVideo = videoElements.first();
            const videoTitle = latestVideo.attr('title');
            const videoUrl = 'https://www.youtube.com' + latestVideo.attr('href');

            if (videoUrl !== lastPosts.pClubYouTube) {
                lastPosts.pClubYouTube = videoUrl;

                const embed = new MessageEmbed()
                    .setTitle(`🎥 NUEVO VIDEO P CLUB: ${videoTitle}`)
                    .setURL(videoUrl)
                    .setDescription('¡Nuevo video oficial de Project Club!')
                    .setColor('#FF6B6B')
                    .setTimestamp()
                    .setFooter('YouTube • Project Club Oficial');

                await sendNotification(embed, 'pclub_video');
            }
        }
    } catch (error) {
        console.error('Error checkPClubYouTube:', error.message);
    }
}

async function checkPClubTwitter() {
    try {
        const response = await axios.get(PCLUB_SOURCES.twitter);
        const $ = cheerio.load(response.data);
        
        const latestTweet = $('item').first();
        const title = latestTweet.find('title').text();
        const link = latestTweet.find('link').text();
        const date = latestTweet.find('pubDate').text();

        if (link !== lastPosts.pClubTwitter) {
            lastPosts.pClubTwitter = link;

            const embed = new MessageEmbed()
                .setTitle(`🐦 NUEVO TWEET P CLUB: ${title.substring(0, 100)}`)
                .setURL(link)
                .setDescription(title)
                .setColor('#4ECDC4')
                .setTimestamp(new Date(date))
                .setFooter('Twitter • @ProjectClub_');

            await sendNotification(embed, 'pclub_tweet');
        }
    } catch (error) {
        console.error('Error checkPClubTwitter:', error.message);
    }
}

async function checkPClubMerch() {
    try {
        const response = await axios.get(PCLUB_SOURCES.merch, {
            headers: { 'User-Agent': 'PClub-Discord-Bot/1.0' }
        });
        
        const posts = response.data.data.children;
        if (posts.length > 0 && posts[0].data.id !== lastPosts.pClubMerch) {
            lastPosts.pClubMerch = posts[0].data.id;
            const merch = posts[0].data;

            const embed = new MessageEmbed()
                .setTitle(`🛍️ NUEVA MERCANCÍA P CLUB: ${merch.title}`)
                .setURL(`https://reddit.com${merch.permalink}`)
                .setDescription(merch.selftext?.substring(0, 200) || '¡Nueva mercancía disponible!')
                .setColor('#FFE66D')
                .setTimestamp(merch.created_utc * 1000)
                .setFooter('Mercancía Oficial • Project Club');

            await sendNotification(embed, 'pclub_merch');
        }
    } catch (error) {
        console.error('Error checkPClubMerch:', error.message);
    }
}

async function checkPClubAnnouncements() {
    try {
        const response = await axios.get(PCLUB_SOURCES.announcements, {
            headers: { 'User-Agent': 'PClub-Discord-Bot/1.0' }
        });
        
        const posts = response.data.data.children;
        const announcement = posts.find(post => 
            post.data.title.toLowerCase().includes('anuncio') ||
            post.data.title.toLowerCase().includes('importante')
        );

        if (announcement && announcement.data.id !== lastPosts.pClubAnnouncements) {
            lastPosts.pClubAnnouncements = announcement.data.id;

            const embed = new MessageEmbed()
                .setTitle(`📢 ANUNCIO P CLUB: ${announcement.data.title}`)
                .setURL(`https://reddit.com${announcement.data.permalink}`)
                .setDescription(announcement.data.selftext?.substring(0, 200) || '¡Anuncio oficial!')
                .setColor('#6A0572')
                .setTimestamp(announcement.data.created_utc * 1000)
                .setFooter('Anuncio Oficial • Project Club');

            await sendNotification(embed, 'pclub_announcement');
        }
    } catch (error) {
        console.error('Error checkPClubAnnouncements:', error.message);
    }
}

// ========== DDLC GENERAL ==========
async function checkDDLCNews() {
    try {
        const response = await axios.get(DDLC_SOURCES.officialNews, {
            headers: { 'User-Agent': 'DDLC-Discord-Bot/1.0' }
        });
        
        const posts = response.data.data.children;
        const importantNews = posts.find(post => 
            post.data.title.toLowerCase().includes('update') ||
            post.data.title.toLowerCase().includes('announcement') ||
            post.data.title.toLowerCase().includes('official')
        );

        if (importantNews && importantNews.data.id !== lastPosts.ddlcNews) {
            lastPosts.ddlcNews = importantNews.data.id;

            const embed = new MessageEmbed()
                .setTitle(`📰 NOTICIA DDLC: ${importantNews.data.title}`)
                .setURL(`https://reddit.com${importantNews.data.permalink}`)
                .setDescription(importantNews.data.selftext?.substring(0, 200) || 'Nueva noticia oficial')
                .setColor('#FF69B4')
                .setTimestamp(importantNews.data.created_utc * 1000)
                .setFooter('DDLC Oficial • Team Salvato');

            await sendNotification(embed, 'ddlc_news');
        }
    } catch (error) {
        console.error('Error checkDDLCNews:', error.message);
    }
}

async function checkDDLCMerch() {
    try {
        const response = await axios.get(DDLC_SOURCES.ddlcMerch, {
            headers: { 'User-Agent': 'DDLC-Discord-Bot/1.0' }
        });
        
        const posts = response.data.data.children;
        const officialMerch = posts.find(post => 
            post.data.title.toLowerCase().includes('official') ||
            post.data.title.toLowerCase().includes('team salvato')
        );

        if (officialMerch && officialMerch.data.id !== lastPosts.ddlcMerch) {
            lastPosts.ddlcMerch = officialMerch.data.id;

            const embed = new MessageEmbed()
                .setTitle(`🎁 MERCANCÍA DDLC: ${officialMerch.data.title}`)
                .setURL(`https://reddit.com${officialMerch.data.permalink}`)
                .setDescription(officialMerch.data.selftext?.substring(0, 200) || '¡Nueva mercancía oficial!')
                .setColor('#95E1D3')
                .setTimestamp(officialMerch.data.created_utc * 1000)
                .setFooter('Mercancía Oficial • DDLC');

            await sendNotification(embed, 'ddlc_merch');
        }
    } catch (error) {
        console.error('Error checkDDLCMerch:', error.message);
    }
}

async function checkTeamSalvato() {
    try {
        const response = await axios.get(DDLC_SOURCES.teamSalvato);
        const $ = cheerio.load(response.data);
        
        const latestTweet = $('item').first();
        const title = latestTweet.find('title').text();
        const link = latestTweet.find('link').text();
        const date = latestTweet.find('pubDate').text();

        if (link !== lastPosts.teamSalvato && title.toLowerCase().includes('ddlc')) {
            lastPosts.teamSalvato = link;

            const embed = new MessageEmbed()
                .setTitle(`🐦 TWEET OFICIAL DDLC: ${title.substring(0, 100)}`)
                .setURL(link)
                .setDescription(title)
                .setColor('#F08A5D')
                .setTimestamp(new Date(date))
                .setFooter('Twitter • @TeamSalvato');

            await sendNotification(embed, 'ddlc_tweet');
        }
    } catch (error) {
        console.error('Error checkTeamSalvato:', error.message);
    }
}

// ========== COMANDOS ==========
async function getFanart(message) {
    try {
        const sources = [
            'https://www.reddit.com/r/ProjectClub/hot/.json?limit=50',
            'https://www.reddit.com/r/DDLC/hot/.json?limit=50'
        ];
        
        const randomSource = sources[Math.floor(Math.random() * sources.length)];
        const response = await axios.get(randomSource);
        const posts = response.data.data.children;
        const fanarts = posts.filter(post => 
            post.data.post_hint === 'image' && 
            !post.data.over_18
        );
        
        if (fanarts.length > 0) {
            const randomFanart = fanarts[Math.floor(Math.random() * fanarts.length)].data;
            const source = randomSource.includes('ProjectClub') ? 'P Club' : 'DDLC';
            
            const embed = new MessageEmbed()
                .setTitle(`🎨 ${randomFanart.title}`)
                .setURL(`https://reddit.com${randomFanart.permalink}`)
                .setImage(randomFanart.url)
                .setColor('#FF69B4')
                .setFooter(`${source} • por u/${randomFanart.author}`);
            
            await message.channel.send({ embeds: [embed] });
        } else {
            await message.channel.send('❌ No se encontraron fanarts');
        }
    } catch (error) {
        await message.channel.send('❌ Error al obtener fanart');
    }
}

async function getLatestNews(message) {
    try {
        const embed = new MessageEmbed()
            .setTitle('📰 ÚLTIMAS NOTICIAS P CLUB & DDLC')
            .setColor('#5865F2')
            .setTimestamp()
            .addField('🎮 PROJECT CLUB', 'Usa `!pclub` para noticias específicas', false)
            .addField('💖 DOKI DOKI LITERATURE CLUB', 'Usa `!ddlc` para noticias del juego original', false)
            .addField('🛠️ MODS', 'Usa `!mods` para los mods más populares', false)
            .addField('🛍️ MERCANCÍA', 'Usa `!merch` para productos oficiales', false);

        await message.channel.send({ embeds: [embed] });
    } catch (error) {
        await message.channel.send('❌ Error al obtener noticias');
    }
}

async function getMerch(message) {
    try {
        const [pclubResponse, ddlcResponse] = await Promise.all([
            axios.get(PCLUB_SOURCES.merch, { headers: { 'User-Agent': 'PClub-Discord-Bot/1.0' } }),
            axios.get(DDLC_SOURCES.ddlcMerch, { headers: { 'User-Agent': 'DDLC-Discord-Bot/1.0' } })
        ]);

        const embed = new MessageEmbed()
            .setTitle('🛍️ MERCANCÍA OFICIAL')
            .setColor('#FFD700')
            .setTimestamp();

        // P Club Merch
        const pclubMerch = pclubResponse.data.data.children.slice(0, 3);
        if (pclubMerch.length > 0) {
            embed.addField('🎮 PROJECT CLUB', pclubMerch.map(merch => 
                `• [${merch.data.title}](https://reddit.com${merch.data.permalink})`
            ).join('\n'), false);
        }

        // DDLC Merch
        const ddlcMerch = ddlcResponse.data.data.children.slice(0, 3);
        if (ddlcMerch.length > 0) {
            embed.addField('💖 DDLC OFICIAL', ddlcMerch.map(merch => 
                `• [${merch.data.title}](https://reddit.com${merch.data.permalink})`
            ).join('\n'), false);
        }

        await message.channel.send({ embeds: [embed] });
    } catch (error) {
        await message.channel.send('❌ Error al obtener mercancía');
    }
}

async function getTopMods(message) {
    try {
        const response = await axios.get('https://www.reddit.com/r/DDLCMods/top/.json?t=week&limit=20', {
            headers: { 'User-Agent': 'DDLC-Discord-Bot/1.0' }
        });

        const mods = response.data.data.children
            .filter(post => 
                post.data.title.toLowerCase().includes('release') ||
                post.data.title.toLowerCase().includes('download') ||
                post.data.link_flair_text?.toLowerCase().includes('release')
            )
            .slice(0, 5);

        if (mods.length > 0) {
            const embed = new MessageEmbed()
                .setTitle('🏆 TOP 5 MODS DE LA SEMANA')
                .setColor('#9B59B6')
                .setDescription('Mods más populares de r/DDLCMods esta semana')
                .setTimestamp();

            mods.forEach((mod, index) => {
                embed.addField(`${index + 1}. ${mod.data.title}`, `↑ ${mod.data.ups} votes • [Descargar](https://reddit.com${mod.data.permalink})`, false);
            });

            await message.channel.send({ embeds: [embed] });
        } else {
            await message.channel.send('❌ No se encontraron mods recientes');
        }
    } catch (error) {
        await message.channel.send('❌ Error al obtener mods');
    }
}

async function getDDLCNews(message) {
    try {
        const [newsResponse, twitterResponse] = await Promise.all([
            axios.get(DDLC_SOURCES.officialNews, { headers: { 'User-Agent': 'DDLC-Discord-Bot/1.0' } }),
            axios.get(DDLC_SOURCES.teamSalvato)
        ]);

        const embed = new MessageEmbed()
            .setTitle('💖 ÚLTIMAS NOTICIAS DDLC')
            .setColor('#FF69B4')
            .setTimestamp();

        // Noticias de Reddit
        const news = newsResponse.data.data.children.slice(0, 3);
        if (news.length > 0) {
            embed.addField('📰 r/DDLC', news.map(post => 
                `• [${post.data.title}](https://reddit.com${post.data.permalink})`
            ).join('\n'), false);
        }

        // Twitter Team Salvato
        const $ = cheerio.load(twitterResponse.data);
        const tweets = $('item').slice(0, 2);
        tweets.each((i, el) => {
            if (i < 2) {
                const title = $(el).find('title').text();
                const link = $(el).find('link').text();
                if (title.toLowerCase().includes('ddlc')) {
                    embed.addField(`🐦 Tweet ${i + 1}`, `[${title.substring(0, 100)}](${link})`, false);
                }
            }
        });

        await message.channel.send({ embeds: [embed] });
    } catch (error) {
        await message.channel.send('❌ Error al obtener noticias de DDLC');
    }
}

async function getPClubInfo(message) {
    try {
        const [youtubeResponse, twitterResponse, merchResponse] = await Promise.all([
            axios.get(PCLUB_SOURCES.youtube, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }),
            axios.get(PCLUB_SOURCES.twitter),
            axios.get(PCLUB_SOURCES.merch, { headers: { 'User-Agent': 'PClub-Discord-Bot/1.0' } })
        ]);

        const embed = new MessageEmbed()
            .setTitle('🎮 INFORMACIÓN PROJECT CLUB')
            .setColor('#FF6B6B')
            .setDescription('Toda la información oficial de Project Club')
            .setTimestamp();

        // YouTube
        const $yt = cheerio.load(youtubeResponse.data);
        const videos = $yt('a#video-title-link').slice(0, 2);
        if (videos.length > 0) {
            embed.addField('🎥 Últimos Videos', Array.from(videos).map(video => 
                `• [${$yt(video).attr('title')}](https://www.youtube.com${$yt(video).attr('href')})`
            ).join('\n'), false);
        }

        // Twitter
        const $tw = cheerio.load(twitterResponse.data);
        const tweets = $tw('item').slice(0, 2);
        if (tweets.length > 0) {
            embed.addField('🐦 Últimos Tweets', Array.from(tweets).map((tweet, i) => 
                `• [Tweet ${i + 1}](${$tw(tweet).find('link').text()})`
            ).join('\n'), false);
        }

        // Merch
        const merch = merchResponse.data.data.children.slice(0, 2);
        if (merch.length > 0) {
            embed.addField('🛍️ Mercancía Reciente', merch.map(item => 
                `• [${item.data.title}](https://reddit.com${item.data.permalink})`
            ).join('\n'), false);
        }

        await message.channel.send({ embeds: [embed] });
    } catch (error) {
        await message.channel.send('❌ Error al obtener información de P Club');
    }
}

async function showStatus(message) {
    const channel = serverConfig.notificationChannel ? 
        message.guild.channels.cache.get(serverConfig.notificationChannel) : 'No configurado';
    const role = serverConfig.mentionRole ? 
        message.guild.roles.cache.get(serverConfig.mentionRole) : 'No configurado';

    const embed = new MessageEmbed()
        .setTitle('📊 ESTADO DEL BOT P CLUB & DDLC')
        .setColor('#3498DB')
        .addField('📢 Canal de notificaciones', channel.toString() || 'No configurado', true)
        .addField('👥 Rol mencionado', role.toString() || 'No configurado', true)
        .addField('🕒 Uptime', formatUptime(client.uptime), true)
        .addField('🎮 Monitoreando P Club', 'YouTube, Twitter, Merch, Anuncios', true)
        .addField('💖 Monitoreando DDLC', 'Noticias, Merch, Team Salvato', true)
        .addField('✅ Estado', '🟢 ACTIVO', true)
        .setTimestamp();

    await message.channel.send({ embeds: [embed] });
}

async function showHelp(message) {
    const embed = new MessageEmbed()
        .setTitle('🎮 COMANDOS BOT P CLUB & DDLC')
        .setColor('#5865F2')
        .setDescription('Bot completo para Project Club y Doki Doki Literature Club')
        .addField('!config', 'Configurar canal y rol (Admin)', true)
        .addField('!fanart', 'Fanart aleatorio de P Club o DDLC', true)
        .addField('!noticias', 'Resumen de noticias', true)
        .addField('!merch', 'Mercancía oficial de ambos', true)
        .addField('!mods', 'Top 5 mods más populares de la semana', true)
        .addField('!ddlc', 'Noticias específicas del juego original', true)
        .addField('!pclub', 'Información específica de Project Club', true)
        .addField('!estado', 'Estado y configuración del bot', true)
        .addField('!ayuda', 'Muestra esta ayuda', true)
        .setFooter('Notificaciones automáticas para ambos proyectos');

    await message.channel.send({ embeds: [embed] });
}

// Función para enviar notificaciones
async function sendNotification(embed, type) {
    try {
        const channel = await client.channels.fetch(serverConfig.notificationChannel);
        let mention = serverConfig.mentionRole ? `<@&${serverConfig.mentionRole}> ` : '';

        let content = '';
        switch(type) {
            case 'pclub_video':
                content = '🎥 **¡NUEVO VIDEO DE P CLUB!**';
                break;
            case 'pclub_tweet':
                content = '🐦 **¡NUEVO TWEET DE P CLUB!**';
                break;
            case 'pclub_merch':
                content = '🛍️ **¡NUEVA MERCANCÍA DE P CLUB!**';
                break;
            case 'pclub_announcement':
                content = '📢 **¡ANUNCIO IMPORTANTE DE P CLUB!**';
                break;
            case 'ddlc_news':
                content = '💖 **¡NUEVA NOTICIA DE DDLC!**';
                break;
            case 'ddlc_merch':
                content = '🎁 **¡NUEVA MERCANCÍA DE DDLC!**';
                break;
            case 'ddlc_tweet':
                content = '🐦 **¡TWEET OFICIAL DE DDLC!**';
                break;
            default:
                content = '🔔 **¡NUEVA ACTUALIZACIÓN!**';
        }

        await channel.send({ 
            content: mention + content,
            embeds: [embed] 
        });
    } catch (error) {
        console.error('Error enviando notificación:', error);
    }
}

// Formatear uptime
function formatUptime(ms) {
    const days = Math.floor(ms / 86400000);
    const hours = Math.floor(ms / 3600000) % 24;
    const minutes = Math.floor(ms / 60000) % 60;
    return `${days}d ${hours}h ${minutes}m`;
}

// Manejo de errores
client.on('error', console.error);
process.on('unhandledRejection', console.error);

// Iniciar bot
client.login(process.env.DISCORD_TOKEN || process.env.TOKEN);