const { Client, Intents, MessageEmbed } = require('discord.js');
const axios = require('axios');
const cheerio = require('cheerio');

const client = new Client({
    intents: [
        Intents.FLAGS.GUILDS,
        Intents.FLAGS.GUILD_MESSAGES,
        Intents.FLAGS.GUILD_MESSAGE_REACTIONS
    ]
});

// ===== CONFIGURACIÓN GENERAL =====
const BOT_VERSION = "2.2.0";
const LAST_UPDATE = new Date().toISOString();
const RELEASE_NOTES = "🎴 Nuevo comando /cita\n🧠 Nuevo comando /trivia\n🐦 Feeds actualizados desde X (Twitter)\n✅ Verificación de enlaces e imágenes";

let lastChecked = {};
let serverConfig = { notificationChannel: null, mentionRole: null, checkInterval: 300000 };

// ===== FUENTES =====
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

// 🐦 Nuevas fuentes de X (Twitter)
const TWITTER_SOURCES = {
    pclub: 'https://twitrss.me/twitter_user_to_rss/?user=ProjectClub_',
    teamSalvato: 'https://twitrss.me/twitter_user_to_rss/?user=TeamSalvato',
    ddlcMods: 'https://twitrss.me/twitter_user_to_rss/?user=DDLCMods',
    ddlcGame: 'https://twitrss.me/twitter_user_to_rss/?user=DDLCGame'
};

let lastPosts = {};

// ===== UTILIDADES =====
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

function formatUptime(ms) {
    const d = Math.floor(ms / 86400000);
    const h = Math.floor(ms / 3600000) % 24;
    const m = Math.floor(ms / 60000) % 60;
    const s = Math.floor(ms / 1000) % 60;
    return d > 0 ? `${d}d ${h}h ${m}m` :
           h > 0 ? `${h}h ${m}m ${s}s` :
           m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// ===== ENVIAR NOTIFICACIÓN =====
async function sendNotification(embed, type) {
    try {
        const channel = await client.channels.fetch(serverConfig.notificationChannel);
        let mention = serverConfig.mentionRole ? `<@&${serverConfig.mentionRole}> ` : '';

        const embedData = embed.toJSON();
        if (embedData.url && !(await isLinkAlive(embedData.url))) return;
        if (embedData.image?.url && !(await isLinkAlive(embedData.image.url))) embed.setImage(null);

        const prefix = {
            pclub_video: '🎥 **¡Nuevo video de P Club!**',
            ddlc_news: '📰 **¡Nueva noticia DDLC!**',
            ddlc_tweet: '🐦 **¡Tweet oficial DDLC!**',
            pclub_tweet: '🐦 **¡Tweet de P Club!**'
        }[type] || '🔔 **¡Nueva actualización!**';

        await channel.send({ content: mention + prefix, embeds: [embed] });
    } catch (err) {
        console.error('Error al enviar notificación:', err.message);
    }
}

// ===== CHECK TWITTER =====
async function checkTwitterFeed(user, type, color = '#1DA1F2') {
    try {
        const response = await axios.get(TWITTER_SOURCES[user]);
        const $ = cheerio.load(response.data);
        const latest = $('item').first();

        const title = latest.find('title').text();
        const link = latest.find('link').text();
        if (!link || lastPosts[user] === link) return;
        lastPosts[user] = link;

        const embed = new MessageEmbed()
            .setTitle(`🐦 Nuevo post en X (@${user})`)
            .setURL(link)
            .setDescription(title.substring(0, 250))
            .setColor(color)
            .setFooter(`Twitter • @${user}`)
            .setTimestamp();

        await sendNotification(embed, `${user}_tweet`);
    } catch (err) {
        console.warn(`Error en checkTwitterFeed(${user}):`, err.message);
    }
}

// ===== COMANDOS SLASH =====
const slashCommands = {
    version: {
        data: {
            name: 'version',
            description: 'Muestra la versión actual del bot'
        },
        async execute(interaction) {
            const embed = new MessageEmbed()
                .setTitle(`📦 ClubAssistant v${BOT_VERSION}`)
                .setDescription('Tu asistente oficial de DDLC y Project Club')
                .setColor('#5865F2')
                .addField('🕐 Última actualización', `<t:${Math.floor(new Date(LAST_UPDATE).getTime() / 1000)}:R>`, true)
                .addField('📄 Notas de la versión', RELEASE_NOTES, false)
                .setFooter('ClubAssistant Bot')
                .setTimestamp();
            await interaction.reply({ embeds: [embed], ephemeral: true });
        }
    },

    // 🎴 CITA
    cita: {
        data: {
            name: 'cita',
            description: 'Obtén una cita aleatoria de una Doki',
            options: [
                {
                    name: 'personaje',
                    type: 3,
                    description: 'Elige un personaje (sayori, monika, natsuki, yuri, aleatoria)',
                    required: false,
                    choices: [
                        { name: 'Sayori 💖', value: 'sayori' },
                        { name: 'Monika 💚', value: 'monika' },
                        { name: 'Natsuki 💗', value: 'natsuki' },
                        { name: 'Yuri 💜', value: 'yuri' },
                        { name: 'Aleatoria 🎲', value: 'random' }
                    ]
                }
            ]
        },
        async execute(interaction) {
            const personaje = interaction.options.getString('personaje') || 'random';
            const frases = {
                sayori: [
                    "Ser feliz no significa no estar triste, solo significa seguir adelante.",
                    "A veces pienso que morir sería más fácil... pero luego recuerdo a mis amigos.",
                    "¿No es lindo cómo el sol aún sale, incluso en los días tristes?"
                ],
                monika: [
                    "Just Monika.",
                    "¿No te gustaría que este mundo fuera solo tú y yo?",
                    "A veces el amor es una prisión disfrazada de paraíso."
                ],
                natsuki: [
                    "¡No me mires así! No es que me moleste o algo, b-baka.",
                    "Leer manga no es inmaduro. Es arte con alma.",
                    "Hornear cupcakes me calma más que hablar con la gente."
                ],
                yuri: [
                    "La belleza del miedo está en su incertidumbre.",
                    "Cuando lees, el mundo desaparece. Solo quedan las palabras.",
                    "No temas a la oscuridad; teme a lo que podrías encontrar en ella."
                ]
            };

            const chars = Object.keys(frases);
            const char = personaje === 'random' ? chars[Math.floor(Math.random() * chars.length)] : personaje;
            const quote = frases[char][Math.floor(Math.random() * frases[char].length)];

            const embed = new MessageEmbed()
                .setTitle(`💬 Cita de ${char.charAt(0).toUpperCase() + char.slice(1)}`)
                .setDescription(`*"${quote}"*`)
                .setColor('#FF69B4')
                .setFooter('Doki Doki Literature Club!')
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });
        }
    },

    // 🧠 TRIVIA
    trivia: {
        data: {
            name: 'trivia',
            description: 'Pon a prueba tus conocimientos sobre DDLC'
        },
        async execute(interaction) {
            const preguntas = [
                {
                    q: "¿Qué personaje rompe la cuarta pared con más frecuencia?",
                    opciones: ["Sayori", "Monika", "Yuri", "Natsuki"],
                    correcta: 1
                },
                {
                    q: "¿En qué año se lanzó Doki Doki Literature Club?",
                    opciones: ["2016", "2017", "2018", "2019"],
                    correcta: 1
                },
                {
                    q: "¿Cuál es el hobby de Natsuki?",
                    opciones: ["Leer manga", "Escribir poesía", "Cocinar", "Coleccionar peluches"],
                    correcta: 0
                },
                {
                    q: "¿Qué color de cabello tiene Yuri?",
                    opciones: ["Rosa", "Morado", "Castaño", "Azul"],
                    correcta: 1
                },
                {
                    q: "¿Qué personaje dice 'Just Monika'?",
                    opciones: ["Sayori", "Yuri", "Monika", "Natsuki"],
                    correcta: 2
                }
            ];

            const p = preguntas[Math.floor(Math.random() * preguntas.length)];
            const opcionesText = p.opciones.map((opt, i) => `${i + 1}. ${opt}`).join('\n');

            const embed = new MessageEmbed()
                .setTitle("🧩 Trivia DDLC")
                .setDescription(`${p.q}\n\n${opcionesText}`)
                .setColor('#9B59B6')
                .setFooter('Responde con el número correcto (1-4)')
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });

            const filter = m => m.author.id === interaction.user.id && /^[1-4]$/.test(m.content);
            const channel = interaction.channel;

            channel.awaitMessages({ filter, max: 1, time: 15000, errors: ['time'] })
                .then(collected => {
                    const respuesta = parseInt(collected.first().content) - 1;
                    const correcto = respuesta === p.correcta;
                    const msg = correcto ? "✅ ¡Correcto!" : `❌ Incorrecto. Era **${p.opciones[p.correcta]}**.`;
                    channel.send(`${interaction.user}, ${msg}`);
                })
                .catch(() => {
                    channel.send(`${interaction.user}, ⏰ se acabó el tiempo.`);
                });
        }
    }
};

// ===== READY =====
client.once('ready', async () => {
    console.log(`✅ ClubAssistant v${BOT_VERSION} conectado como ${client.user.tag}`);
    client.user.setActivity('P Club & DDLC Updates', { type: 'WATCHING' });

    try {
        await client.application.commands.set(Object.values(slashCommands).map(c => c.data));
        console.log(`✅ ${Object.keys(slashCommands).length} slash commands registrados`);
    } catch (e) {
        console.error('❌ Error registrando slash commands:', e);
    }

    setInterval(() => {
        checkTwitterFeed('pclub', 'pclub_tweet', '#FF6B6B');
        checkTwitterFeed('teamSalvato', 'ddlc_tweet', '#F08A5D');
        checkTwitterFeed('ddlcMods', 'ddlcMods_tweet', '#9B59B6');
        checkTwitterFeed('ddlcGame', 'ddlcGame_tweet', '#FF69B4');
    }, serverConfig.checkInterval);
});

// ===== EVENTOS =====
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;
    const command = slashCommands[interaction.commandName];
    if (!command) return;
    try {
        await command.execute(interaction);
    } catch (err) {
        console.error(err);
        await interaction.reply({ content: '❌ Error ejecutando el comando.', ephemeral: true });
    }
});

// ===== LOGIN =====
client.login(process.env.DISCORD_TOKEN || process.env.TOKEN);
