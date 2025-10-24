const { Client, GatewayIntentBits, EmbedBuilder, ActivityType, REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const axios = require('axios');
const cheerio = require('cheerio');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
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

// Comandos Slash
const commands = [
    new SlashCommandBuilder()
        .setName('config')
        .setDescription('Configurar el bot para P Club y DDLC')
        .addChannelOption(option =>
            option.setName('canal')
                .setDescription('Canal para notificaciones')
                .setRequired(true))
        .addRoleOption(option =>
            option.setName('rol')
                .setDescription('Rol a mencionar en notificaciones')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName('fanart')
        .setDescription('Obtener un fanart aleatorio de P Club o DDLC'),

    new SlashCommandBuilder()
        .setName('noticias')
        .setDescription('Últimas noticias de P Club y DDLC'),

    new SlashCommandBuilder()
        .setName('merch')
        .setDescription('Mercancía oficial de P Club y DDLC'),

    new SlashCommandBuilder()
        .setName('mods')
        .setDescription('Top 5 mods más descargados de la semana'),

    new SlashCommandBuilder()
        .setName('ddlc')
        .setDescription('Últimas noticias del juego original DDLC'),

    new SlashCommandBuilder()
        .setName('pclub')
        .setDescription('Información específica de Project Club'),

    new SlashCommandBuilder()
        .setName('estado')
        .setDescription('Estado del bot y configuración'),

    new SlashCommandBuilder()
        .setName('ayuda')
        .setDescription('Muestra todos los comandos disponibles')
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN || process.env.TOKEN);

client.once('ready', async () => {
    console.log(`✅ Bot P Club & DDLC conectado como ${client.user.tag}`);
    client.user.setActivity('P Club & DDLC Updates', { type: ActivityType.Watching });

    try {
        console.log('🔧 Registrando comandos slash...');
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );
        console.log('✅ Comandos slash registrados');
    } catch (error) {
        console.error('❌ Error registrando comandos:', error);
    }

    checkForUpdates();
    setInterval(checkForUpdates, serverConfig.checkInterval);
});

// Manejar comandos slash
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;

    const { commandName, options, guild } = interaction;

    switch (commandName) {
        case 'config':
            await configCommand(interaction, options, guild);
            break;
        case 'fanart':
            await getFanart(interaction);
            break;
        case 'noticias':
            await getLatestNews(interaction);
            break;
        case 'merch':
            await getMerch(interaction);
            break;
        case 'mods':
            await getTopMods(interaction);
            break;
        case 'ddlc':
            await getDDLCNews(interaction);
            break;
        case 'pclub':
            await getPClubInfo(interaction);
            break;
        case 'estado':
            await showStatus(interaction, guild);
            break;
        case 'ayuda':
            await showHelp(interaction);
            break;
    }
});

// Comando de configuración
async function configCommand(interaction, options, guild) {
    const channel = options.getChannel('canal');
    const role = options.getRole('rol');

    if (!channel.isTextBased()) {
        return await interaction.reply({ 
            content: '❌ El canal debe ser un canal de texto.', 
            ephemeral: true 
        });
    }

    serverConfig.notificationChannel = channel.id;
    serverConfig.mentionRole = role ? role.id : null;

    await interaction.reply({ 
        content: `✅ Configuración guardada:\n📢 Canal: ${channel}\n${role ? `👥 Rol: ${role}` : '👥 Sin rol mencionado'}`,
        ephemeral: true 
    });
}

// Función principal de chequeo
async function checkForUpdates() {
    if (!serverConfig.notificationChannel) return;

    try {
        // P Club
        await checkPClubYouTube();
        await checkPClubTwitter();
        await checkPClubMerch();
        await checkPClubAnnouncements();
        
        // DDLC General
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

                const embed = new EmbedBuilder()
                    .setTitle(`🎥 NUEVO VIDEO P CLUB: ${videoTitle}`)
                    .setURL(videoUrl)
                    .setDescription('¡Nuevo video oficial de Project Club!')
                    .setColor(0xFF6B6B)
                    .setTimestamp()
                    .setFooter({ text: 'YouTube • Project Club Oficial' });

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

            const embed = new EmbedBuilder()
                .setTitle(`🐦 NUEVO TWEET P CLUB: ${title.substring(0, 100)}`)
                .setURL(link)
                .setDescription(title)
                .setColor(0x4ECDC4)
                .setTimestamp(new Date(date))
                .setFooter({ text: 'Twitter • @ProjectClub_' });

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

            const embed = new EmbedBuilder()
                .setTitle(`🛍️ NUEVA MERCANCÍA P CLUB: ${merch.title}`)
                .setURL(`https://reddit.com${merch.permalink}`)
                .setDescription(merch.selftext?.substring(0, 200) || '¡Nueva mercancía disponible!')
                .setColor(0xFFE66D)
                .setTimestamp(merch.created_utc * 1000)
                .setFooter({ text: 'Mercancía Oficial • Project Club' });

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

            const embed = new EmbedBuilder()
                .setTitle(`📢 ANUNCIO P CLUB: ${announcement.data.title}`)
                .setURL(`https://reddit.com${announcement.data.permalink}`)
                .setDescription(announcement.data.selftext?.substring(0, 200) || '¡Anuncio oficial!')
                .setColor(0x6A0572)
                .setTimestamp(announcement.data.created_utc * 1000)
                .setFooter({ text: 'Anuncio Oficial • Project Club' });

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

            const embed = new EmbedBuilder()
                .setTitle(`📰 NOTICIA DDLC: ${importantNews.data.title}`)
                .setURL(`https://reddit.com${importantNews.data.permalink}`)
                .setDescription(importantNews.data.selftext?.substring(0, 200) || 'Nueva noticia oficial')
                .setColor(0xFF69B4)
                .setTimestamp(importantNews.data.created_utc * 1000)
                .setFooter({ text: 'DDLC Oficial • Team Salvato' });

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

            const embed = new EmbedBuilder()
                .setTitle(`🎁 MERCANCÍA DDLC: ${officialMerch.data.title}`)
                .setURL(`https://reddit.com${officialMerch.data.permalink}`)
                .setDescription(officialMerch.data.selftext?.substring(0, 200) || '¡Nueva mercancía oficial!')
                .setColor(0x95E1D3)
                .setTimestamp(officialMerch.data.created_utc * 1000)
                .setFooter({ text: 'Mercancía Oficial • DDLC' });

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

            const embed = new EmbedBuilder()
                .setTitle(`🐦 TWEET OFICIAL DDLC: ${title.substring(0, 100)}`)
                .setURL(link)
                .setDescription(title)
                .setColor(0xF08A5D)
                .setTimestamp(new Date(date))
                .setFooter({ text: 'Twitter • @TeamSalvato' });

            await sendNotification(embed, 'ddlc_tweet');
        }
    } catch (error) {
        console.error('Error checkTeamSalvato:', error.message);
    }
}

// ========== COMANDOS ==========
async function getFanart(interaction) {
    await interaction.deferReply();
    
    const sources = [
        'https://www.reddit.com/r/ProjectClub/hot/.json?limit=50',
        'https://www.reddit.com/r/DDLC/hot/.json?limit=50'
    ];
    
    const randomSource = sources[Math.floor(Math.random() * sources.length)];
    
    try {
        const response = await axios.get(randomSource);
        const posts = response.data.data.children;
        const fanarts = posts.filter(post => 
            post.data.post_hint === 'image' && 
            !post.data.over_18
        );
        
        if (fanarts.length > 0) {
            const randomFanart = fanarts[Math.floor(Math.random() * fanarts.length)].data;
            const source = randomSource.includes('ProjectClub') ? 'P Club' : 'DDLC';
            
            const embed = new EmbedBuilder()
                .setTitle(`🎨 ${randomFanart.title}`)
                .setURL(`https://reddit.com${randomFanart.permalink}`)
                .setImage(randomFanart.url)
                .setColor(0xFF69B4)
                .setFooter({ text: `${source} • por u/${randomFanart.author}` });
            
            await interaction.editReply({ embeds: [embed] });
        } else {
            await interaction.editReply('❌ No se encontraron fanarts');
        }
    } catch (error) {
        await interaction.editReply('❌ Error al obtener fanart');
    }
}

async function getLatestNews(interaction) {
    await interaction.deferReply();

    try {
        const embed = new EmbedBuilder()
            .setTitle('📰 ÚLTIMAS NOTICIAS P CLUB & DDLC')
            .setColor(0x5865F2)
            .setTimestamp();

        // P Club
        embed.addFields({
            name: '🎮 PROJECT CLUB',
            value: 'Usa `/pclub` para noticias específicas',
            inline: false
        });

        // DDLC
        embed.addFields({
            name: '💖 DOKI DOKI LITERATURE CLUB',
            value: 'Usa `/ddlc` para noticias del juego original',
            inline: false
        });

        embed.addFields({
            name: '🛠️ MODS',
            value: 'Usa `/mods` para los mods más populares',
            inline: false
        });

        embed.addFields({
            name: '🛍️ MERCANCÍA',
            value: 'Usa `/merch` para productos oficiales',
            inline: false
        });

        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        await interaction.editReply('❌ Error al obtener noticias');
    }
}

async function getMerch(interaction) {
    await interaction.deferReply();

    try {
        const [pclubResponse, ddlcResponse] = await Promise.all([
            axios.get(PCLUB_SOURCES.merch, { headers: { 'User-Agent': 'PClub-Discord-Bot/1.0' } }),
            axios.get(DDLC_SOURCES.ddlcMerch, { headers: { 'User-Agent': 'DDLC-Discord-Bot/1.0' } })
        ]);

        const embed = new EmbedBuilder()
            .setTitle('🛍️ MERCANCÍA OFICIAL')
            .setColor(0xFFD700)
            .setTimestamp();

        // P Club Merch
        const pclubMerch = pclubResponse.data.data.children.slice(0, 3);
        if (pclubMerch.length > 0) {
            embed.addFields({
                name: '🎮 PROJECT CLUB',
                value: pclubMerch.map(merch => 
                    `• [${merch.data.title}](https://reddit.com${merch.data.permalink})`
                ).join('\n'),
                inline: false
            });
        }

        // DDLC Merch
        const ddlcMerch = ddlcResponse.data.data.children.slice(0, 3);
        if (ddlcMerch.length > 0) {
            embed.addFields({
                name: '💖 DDLC OFICIAL',
                value: ddlcMerch.map(merch => 
                    `• [${merch.data.title}](https://reddit.com${merch.data.permalink})`
                ).join('\n'),
                inline: false
            });
        }

        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        await interaction.editReply('❌ Error al obtener mercancía');
    }
}

async function getTopMods(interaction) {
    await interaction.deferReply();

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
            const embed = new EmbedBuilder()
                .setTitle('🏆 TOP 5 MODS DE LA SEMANA')
                .setColor(0x9B59B6)
                .setDescription('Mods más populares de r/DDLCMods esta semana')
                .setTimestamp();

            mods.forEach((mod, index) => {
                embed.addFields({
                    name: `${index + 1}. ${mod.data.title}`,
                    value: `↑ ${mod.data.ups} votes • [Descargar](https://reddit.com${mod.data.permalink})`,
                    inline: false
                });
            });

            await interaction.editReply({ embeds: [embed] });
        } else {
            await interaction.editReply('❌ No se encontraron mods recientes');
        }
    } catch (error) {
        await interaction.editReply('❌ Error al obtener mods');
    }
}

async function getDDLCNews(interaction) {
    await interaction.deferReply();

    try {
        const [newsResponse, twitterResponse] = await Promise.all([
            axios.get(DDLC_SOURCES.officialNews, { headers: { 'User-Agent': 'DDLC-Discord-Bot/1.0' } }),
            axios.get(DDLC_SOURCES.teamSalvato)
        ]);

        const embed = new EmbedBuilder()
            .setTitle('💖 ÚLTIMAS NOTICIAS DDLC')
            .setColor(0xFF69B4)
            .setTimestamp();

        // Noticias de Reddit
        const news = newsResponse.data.data.children.slice(0, 3);
        if (news.length > 0) {
            embed.addFields({
                name: '📰 r/DDLC',
                value: news.map(post => 
                    `• [${post.data.title}](https://reddit.com${post.data.permalink})`
                ).join('\n'),
                inline: false
            });
        }

        // Twitter Team Salvato
        const $ = cheerio.load(twitterResponse.data);
        const tweets = $('item').slice(0, 2);
        tweets.each((i, el) => {
            if (i < 2) {
                const title = $(el).find('title').text();
                const link = $(el).find('link').text();
                if (title.toLowerCase().includes('ddlc')) {
                    embed.addFields({
                        name: `🐦 Tweet ${i + 1}`,
                        value: `[${title.substring(0, 100)}](${link})`,
                        inline: false
                    });
                }
            }
        });

        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        await interaction.editReply('❌ Error al obtener noticias de DDLC');
    }
}

async function getPClubInfo(interaction) {
    await interaction.deferReply();

    try {
        const [youtubeResponse, twitterResponse, merchResponse] = await Promise.all([
            axios.get(PCLUB_SOURCES.youtube, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }),
            axios.get(PCLUB_SOURCES.twitter),
            axios.get(PCLUB_SOURCES.merch, { headers: { 'User-Agent': 'PClub-Discord-Bot/1.0' } })
        ]);

        const embed = new EmbedBuilder()
            .setTitle('🎮 INFORMACIÓN PROJECT CLUB')
            .setColor(0xFF6B6B)
            .setDescription('Toda la información oficial de Project Club')
            .setTimestamp();

        // YouTube
        const $yt = cheerio.load(youtubeResponse.data);
        const videos = $yt('a#video-title-link').slice(0, 2);
        if (videos.length > 0) {
            embed.addFields({
                name: '🎥 Últimos Videos',
                value: Array.from(videos).map(video => 
                    `• [${$yt(video).attr('title')}](https://www.youtube.com${$yt(video).attr('href')})`
                ).join('\n'),
                inline: false
            });
        }

        // Twitter
        const $tw = cheerio.load(twitterResponse.data);
        const tweets = $tw('item').slice(0, 2);
        if (tweets.length > 0) {
            embed.addFields({
                name: '🐦 Últimos Tweets',
                value: Array.from(tweets).map((tweet, i) => 
                    `• [Tweet ${i + 1}](${$tw(tweet).find('link').text()})`
                ).join('\n'),
                inline: false
            });
        }

        // Merch
        const merch = merchResponse.data.data.children.slice(0, 2);
        if (merch.length > 0) {
            embed.addFields({
                name: '🛍️ Mercancía Reciente',
                value: merch.map(item => 
                    `• [${item.data.title}](https://reddit.com${item.data.permalink})`
                ).join('\n'),
                inline: false
            });
        }

        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        await interaction.editReply('❌ Error al obtener información de P Club');
    }
}

async function showStatus(interaction, guild) {
    const channel = serverConfig.notificationChannel ? 
        guild.channels.cache.get(serverConfig.notificationChannel) : 'No configurado';
    const role = serverConfig.mentionRole ? 
        guild.roles.cache.get(serverConfig.mentionRole) : 'No configurado';

    const embed = new EmbedBuilder()
        .setTitle('📊 ESTADO DEL BOT P CLUB & DDLC')
        .setColor(0x3498DB)
        .addFields(
            { name: '📢 Canal de notificaciones', value: channel.toString() || 'No configurado', inline: true },
            { name: '👥 Rol mencionado', value: role.toString() || 'No configurado', inline: true },
            { name: '🕒 Uptime', value: formatUptime(client.uptime), inline: true },
            { name: '🎮 Monitoreando P Club', value: 'YouTube, Twitter, Merch, Anuncios', inline: true },
            { name: '💖 Monitoreando DDLC', value: 'Noticias, Merch, Team Salvato', inline: true },
            { name: '✅ Estado', value: '🟢 ACTIVO', inline: true }
        )
        .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function showHelp(interaction) {
    const embed = new EmbedBuilder()
        .setTitle('🎮 COMANDOS BOT P CLUB & DDLC')
        .setColor(0x5865F2)
        .setDescription('Bot completo para Project Club y Doki Doki Literature Club')
        .addFields(
            { name: '/config', value: 'Configurar canal y rol (Admin)' },
            { name: '/fanart', value: 'Fanart aleatorio de P Club o DDLC' },
            { name: '/noticias', value: 'Resumen de noticias' },
            { name: '/merch', value: 'Mercancía oficial de ambos' },
            { name: '/mods', value: 'Top 5 mods más populares de la semana' },
            { name: '/ddlc', value: 'Noticias específicas del juego original' },
            { name: '/pclub', value: 'Información específica de Project Club' },
            { name: '/estado', value: 'Estado y configuración del bot' },
            { name: '/ayuda', value: 'Muestra esta ayuda' }
        )
        .setFooter({ text: 'Notificaciones automáticas para ambos proyectos' });

    await interaction.reply({ embeds: [embed], ephemeral: true });
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