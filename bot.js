
const { Client, Intents, MessageEmbed } = require('discord.js');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');

const client = new Client({
  intents: [
    Intents.FLAGS.GUILDS,
    Intents.FLAGS.GUILD_MESSAGES,
    Intents.FLAGS.GUILD_MESSAGE_REACTIONS
  ]
});

// ----- CONFIG -----
const BOT_VERSION = "2.5.0";
const RELEASE_NOTES = "Fanart por Doki, citas ampliadas, trivia, feeds Reddit/X/YouTube, merch semanal, ilustración máxima en embeds";
let serverConfig = {
  notificationChannel: null,
  mentionRole: null,
  checkInterval: 300000 // 5 minutes
};

// ----- SOURCES -----
const REDDIT_FANART_SR = ["DDLC", "DDLCMods", "ProjectClub"];
const REDDIT_MERCH_SR = ["DDLC", "DDLCMods", "ProjectClub"];
const TWITTER_SOURCES = {
  pclub: 'https://twitrss.me/twitter_user_to_rss/?user=ProjectClub_',
  teamSalvato: 'https://twitrss.me/twitter_user_to_rss/?user=TeamSalvato',
  ddlcMods: 'https://twitrss.me/twitter_user_to_rss/?user=DDLCMods',
  ddlcGame: 'https://twitrss.me/twitter_user_to_rss/?user=DDLCGame'
};

let lastPosts = {}; // track by id/url to prevent duplicates

// ----- UTILITIES -----
async function isLinkAlive(url) {
  if (!url) return false;
  try {
    const r = await axios.head(url, { maxRedirects: 2, timeout: 5000 });
    return r.status >= 200 && r.status < 400;
  } catch {
    try {
      const r = await axios.get(url, { maxRedirects: 2, timeout: 5000 });
      return r.status >= 200 && r.status < 400;
    } catch {
      return false;
    }
  }
}

function safeSubstring(s, len) {
  if (!s) return '';
  return s.length > len ? s.substring(0,len-1) + '…' : s;
}

function nowUnix() { return Math.floor(Date.now() / 1000); }

// ----- REDDIT HELPERS -----
async function fetchRedditPosts(subreddit, opts = {}) {
  try {
    const limit = opts.limit || 50;
    const sort = opts.sort || 'new';
    const t = opts.t || 'week';
    const url = `https://www.reddit.com/r/${subreddit}/${sort}.json?limit=${limit}&t=${t}`;
    const res = await axios.get(url, { headers: { 'User-Agent': 'ClubAssistant/1.0' } });
    return (res.data?.data?.children || []).map(c => c.data);
  } catch (e) {
    // network or reddit returned bad data
    return [];
  }
}

function pickImageFromReddit(post) {
  if (!post) return null;
  try {
    if (post.preview && post.preview.images && post.preview.images[0]) {
      const url = post.preview.images[0].source.url.replace(/&amp;/g, '&');
      return url;
    }
    if (post.thumbnail && post.thumbnail.startsWith('http')) return post.thumbnail;
    if (post.url && /\.(jpe?g|png|gif|webp)$/i.test(post.url)) return post.url;
    return null;
  } catch {
    return null;
  }
}

// Filter fanarts by keywords to favor drawn fanart / traditional / sketch / artwork
async function getFanartsByDoki(doki, limit = 50) {
  const mapping = {
    monika: ["DDLC", "ProjectClub"],
    sayori: ["DDLC", "ProjectClub"],
    yuri: ["DDLC", "ProjectClub"],
    natsuki: ["DDLC", "ProjectClub"]
  };
  const srs = doki === 'random' ? REDDIT_FANART_SR : (mapping[doki] || REDDIT_FANART_SR);
  let pool = [];
  const keywords = /(fanart|artwork|drawing|sketch|handmade|traditional|arte|dibujo|drawn|illustration|sketchbook)/i;

  for (const sr of srs) {
    const posts = await fetchRedditPosts(sr, { limit: limit, sort: 'hot', t: 'week' });
    for (const p of posts) {
      const img = pickImageFromReddit(p);
      const text = ((p.title || '') + ' ' + (p.selftext || '')).toLowerCase();
      if (img && keywords.test(text)) {
        pool.push({
          img,
          title: p.title,
          author: p.author,
          subreddit: sr,
          permalink: `https://reddit.com${p.permalink}`,
          created: p.created_utc
        });
      }
    }
  }
  return pool;
}

async function getMerchWeekly(source, limit = 10) {
  const key = (source || 'ddlc').toLowerCase();
  const sr = key === 'pclub' ? 'ProjectClub' : key === 'mods' ? 'DDLCMods' : 'DDLC';
  const posts = await fetchRedditPosts(sr, { limit, sort: 'new', t: 'week' });
  return posts.filter(p => /merch|store|shop|patreon|etsy|tienda|merchandise/i.test((p.title || '') + ' ' + (p.selftext || ''))).map(p => ({
    title: p.title,
    author: p.author,
    subreddit: sr,
    url: p.url,
    permalink: `https://reddit.com${p.permalink}`,
    thumb: pickImageFromReddit(p)
  }));
}

// ----- YOUTUBE SIMPLE PARSER (best-effort) -----
async function searchYouTubeLatestSpanish(query = 'ddlc español') {
  try {
    const q = encodeURIComponent(query);
    const url = `https://www.youtube.com/results?search_query=${q}&sp=EgIYAw%253D%253D`;
    const res = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const html = res.data;
    // try to find a videoId
    const m = html.match(/"videoRenderer":\s*({[\s\S]*?"videoId":"(.*?)"[\s\S]*?})/);
    if (!m) {
      const m2 = html.match(/watch\?v=(.{11})/);
      if (m2) {
        const id = m2[1];
        return { id, url: `https://www.youtube.com/watch?v=${id}`, title: 'Video relacionado', channel: 'Canal', thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` };
      }
      return null;
    }
    const jsonText = m[1];
    // extract videoId
    const idMatch = jsonText.match(/"videoId":"(.*?)"/);
    const vidId = idMatch ? idMatch[1] : null;
    if (!vidId) return null;
    const titleMatch = html.match(new RegExp(`"videoId":"${vidId}".*?"title":\\s*\\{[^}]*?"runs":\\s*\\[\\s*\\{\\s*"text":"(.*?)"`, 's'));
    const channelMatch = html.match(new RegExp(`"videoId":"${vidId}".*?"ownerText":\\s*\\{[^}]*?"runs":\\s*\\[\\s*\\{\\s*"text":"(.*?)"`, 's'));
    const title = titleMatch ? titleMatch[1] : 'Video';
    const channel = channelMatch ? channelMatch[1] : 'Canal';
    return { id: vidId, url: `https://www.youtube.com/watch?v=${vidId}`, title, channel, thumb: `https://i.ytimg.com/vi/${vidId}/hqdefault.jpg` };
  } catch {
    return null;
  }
}

// ----- NOTIFICATION SENDER (validates links/images) -----
async function sendNotification(embed, type) {
  try {
    if (!serverConfig.notificationChannel) return;
    const ch = await client.channels.fetch(serverConfig.notificationChannel).catch(()=>null);
    if (!ch) return;
    const embedData = embed.toJSON();
    if (embedData.url && !(await isLinkAlive(embedData.url))) return;
    if (embedData.image?.url && !(await isLinkAlive(embedData.image.url))) embed.setImage(null);

    const mention = serverConfig.mentionRole ? `<@&${serverConfig.mentionRole}> ` : '';
    const prefix = {
      pclub_video: '🎥 Nuevo video',
      pclub_tweet: '🐦 Tweet • Project Club',
      ddlc_tweet: '🐦 Tweet • DDLC',
      ddlc_news: '📰 Noticia DDLC',
      merch_week: '🛍️ Merch semanal'
    }[type] || '🔔 Actualización';

    await ch.send({ content: mention + prefix, embeds: [embed] });
  } catch (e) {
    console.error('Error enviando notificación:', e.message || e);
  }
}

// ----- TWITTER/X (rss via twitrss.me) -----
async function checkTwitter(user, type, color) {
  try {
    const url = TWITTER_SOURCES[user];
    if (!url) return;
    const res = await axios.get(url);
    const $ = cheerio.load(res.data);
    const latest = $('item').first();
    if (!latest || !latest.length) return;
    const link = latest.find('link').text();
    if (!link || lastPosts[link]) return;
    lastPosts[link] = true;
    const title = latest.find('title').text().slice(0,250);
    const date = latest.find('pubDate').text();
    const embed = new MessageEmbed().setTitle(`Tweet • @${user}`).setDescription(title).setURL(link).setColor(color || '#1DA1F2').setTimestamp(new Date(date)).setFooter('Fuente: X');
    await sendNotification(embed, type);
  } catch (e) {
    console.warn('checkTwitter error', e.message || e);
  }
}

// ----- AUTOMATED TASKS -----
async function autoWeeklyMerch() {
  try {
    const items = [];
    for (const src of ['pclub','ddlc','mods']) {
      const posts = await getMerchWeekly(src, 8);
      if (posts && posts.length) items.push(...posts.slice(0,2));
    }
    if (!items.length) return;
    const embed = new MessageEmbed().setTitle('Merch semanal').setTimestamp();
    for (const it of items.slice(0,6)) embed.addField(safeSubstring(it.title, 80), `r/${it.subreddit} • u/${it.author} • ${it.permalink || it.url}`);
    await sendNotification(embed, 'merch_week');
  } catch (e) {
    console.warn('autoWeeklyMerch err', e.message || e);
  }
}

async function autoLatestVideo() {
  try {
    const res = await searchYouTubeLatestSpanish('ddlc español');
    if (!res || lastPosts[res.id]) return;
    lastPosts[res.id] = true;
    const embed = new MessageEmbed().setTitle(res.title).setURL(res.url).setDescription(res.channel).setImage(res.thumb).setTimestamp();
    await sendNotification(embed, 'pclub_video');
  } catch (e) {
    console.warn('autoLatestVideo err', e.message || e);
  }
}

// ----- SLASH COMMANDS -----
const slashCommands = {
  // CONFIG
  config: {
    data: {
      name: 'config',
      description: 'Configura canal de notificaciones y rol de mención',
      options: [
        { name: 'canal', type: 7, description: 'Canal para notificaciones', required: true },
        { name: 'rol', type: 8, description: 'Rol para mencionar (opcional)', required: false }
      ]
    },
    async execute(interaction) {
      if (!interaction.member.permissions.has('ADMINISTRATOR')) {
        return interaction.reply({ content: '❌ Necesitas permisos de administrador.', ephemeral: true });
      }
      const canal = interaction.options.getChannel('canal');
      const rol = interaction.options.getRole('rol');
      serverConfig.notificationChannel = canal.id;
      serverConfig.mentionRole = rol ? rol.id : null;
      await interaction.reply({ content: `✅ Canal configurado: ${canal}\n${rol ? `Rol: ${rol}` : ''}`, ephemeral: true });
    }
  },

  version: {
    data: { name: 'version', description: 'Muestra la versión actual del bot' },
    async execute(interaction) {
      const embed = new MessageEmbed()
        .setTitle(`ClubAssistant v${BOT_VERSION}`)
        .setDescription(RELEASE_NOTES)
        .addField('Versión', BOT_VERSION, true)
        .addField('Última verificación', `<t:${nowUnix()}:R>`, true)
        .setTimestamp();
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  },

  estado: {
    data: { name: 'estado', description: 'Muestra estado del bot' },
    async execute(interaction) {
      const uptime = process.uptime() * 1000;
      const embed = new MessageEmbed()
        .setTitle('Estado del bot')
        .addField('Uptime', `${Math.floor(uptime/1000)}s`, true)
        .addField('Version', BOT_VERSION, true)
        .addField('Canal de notificaciones', serverConfig.notificationChannel ? `<#${serverConfig.notificationChannel}>` : 'No configurado', true)
        .setTimestamp();
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  },

  ayuda: {
    data: { name: 'ayuda', description: 'Muestra ayuda rápida' },
    async execute(interaction) {
      const embed = new MessageEmbed()
        .setTitle('Comandos disponibles')
        .setDescription('/fanart, /cita, /trivia, /merch, /video, /noticias, /config, /version, /estado, /ayuda')
        .setTimestamp();
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  },

  fanart: {
    data: {
      name: 'fanart',
      description: 'Muestra fanart de una Doki o random',
      options: [
        { name: 'doki', type: 3, description: 'sayori, monika, yuri, natsuki, random', required: false, choices: [
          { name: 'Sayori', value: 'sayori' }, { name: 'Monika', value: 'monika' }, { name: 'Yuri', value: 'yuri' }, { name: 'Natsuki', value: 'natsuki' }, { name: 'Random', value: 'random' }
        ] }
      ]
    },
    async execute(interaction) {
      await interaction.deferReply();
      const doki = interaction.options.getString('doki') || 'random';
      const pool = await getFanartsByDoki(doki, 100);
      if (!pool.length) return interaction.editReply('No encontré fanarts ahora mismo.');
      const chosen = pool[Math.floor(Math.random() * pool.length)];
      const embed = new MessageEmbed()
        .setTitle(safeSubstring(chosen.title || 'Fanart', 120))
        .setURL(chosen.permalink)
        .setImage(chosen.img)
        .setFooter(`u/${chosen.author} • r/${chosen.subreddit}`)
        .setTimestamp(new Date(chosen.created * 1000));
      await interaction.editReply({ embeds: [embed] });
      // Note: Avatar change is manual by user; we do NOT auto-change bot avatar here.
    }
  },

  cita: {
    data: {
      name: 'cita',
      description: 'Muestra una cita de una Doki',
      options: [
        { name: 'personaje', type: 3, description: 'sayori, monika, yuri, natsuki, random', required: false, choices: [
          { name: 'Sayori', value: 'sayori' }, { name: 'Monika', value: 'monika' }, { name: 'Yuri', value: 'yuri' }, { name: 'Natsuki', value: 'natsuki' }, { name: 'Random', value: 'random' }
        ] }
      ]
    },
    async execute(interaction) {
      const personaje = interaction.options.getString('personaje') || 'random';
      const frases = JSON.parse(fs.readFileSync(__dirname + '/ddlc_quotes.json', 'utf8'));
      const keys = Object.keys(frases);
      const key = personaje === 'random' ? keys[Math.floor(Math.random() * keys.length)] : personaje;
      if (!frases[key]) return interaction.reply('Personaje no disponible.');
      const quote = frases[key][Math.floor(Math.random() * frases[key].length)];
      const embed = new MessageEmbed().setTitle(`Cita de ${key.charAt(0).toUpperCase() + key.slice(1)}`).setDescription(`"${quote}"`).setTimestamp();
      await interaction.reply({ embeds: [embed] });
    }
  },

  trivia: {
    data: { name: 'trivia', description: 'Trivia sobre DDLC' },
    async execute(interaction) {
      await interaction.deferReply();
      const preguntas = [
        { q: "¿Qué personaje rompe la cuarta pared con más frecuencia?", opciones: ["Sayori", "Monika", "Yuri", "Natsuki"], correcta: 1 },
        { q: "¿En qué año se lanzó Doki Doki Literature Club (versión pública)?", opciones: ["2016", "2017", "2015", "2018"], correcta: 0 },
        { q: "¿Cuál es el hobby de Natsuki?", opciones: ["Leer manga", "Escribir poesía", "Cocinar", "Coleccionar peluches"], correcta: 0 },
        { q: "¿Qué color es más asociado a Yuri?", opciones: ["Rosa", "Morado", "Negro", "Verde"], correcta: 1 },
        { q: "¿Quién suele decir 'Just Monika'?", opciones: ["Sayori", "Monika", "Yuri", "Natsuki"], correcta: 1 }
      ];
      const p = preguntas[Math.floor(Math.random() * preguntas.length)];
      const opcionesText = p.opciones.map((o,i)=>`${i+1}. ${o}`).join('\n');
      const embed = new MessageEmbed().setTitle('Trivia DDLC').setDescription(`${p.q}\n\n${opcionesText}`).setFooter('Responde con el número (1-4)').setTimestamp();
      await interaction.editReply({ embeds: [embed] });
      const filter = m => m.author.id === interaction.user.id && /^[1-4]$/.test(m.content);
      const channel = interaction.channel;
      channel.awaitMessages({ filter, max: 1, time: 20000, errors: ['time'] })
        .then(collected => {
          const respuesta = parseInt(collected.first().content) - 1;
          const correcto = respuesta === p.correcta;
          channel.send(`${interaction.user}, ${correcto ? '✅ ¡Correcto!' : `❌ Incorrecto. Era **${p.opciones[p.correcta]}**.`}`);
        })
        .catch(()=>{ channel.send(`${interaction.user}, ⏰ Se acabó el tiempo.`); });
    }
  },

  merch: {
    data: {
      name: 'merch',
      description: 'Muestra merch de la semana (pclub, ddlc, mods)',
      options: [
        { name: 'fuente', type: 3, description: 'pclub, ddlc, mods, random', required: false, choices: [
          { name: 'P Club', value: 'pclub' }, { name: 'DDLC', value: 'ddlc' }, { name: 'Mods', value: 'mods' }, { name: 'Random', value: 'random' }
        ] }
      ]
    },
    async execute(interaction) {
      await interaction.deferReply();
      const fuente = interaction.options.getString('fuente') || 'random';
      const src = fuente === 'random' ? (Math.random() < 0.5 ? 'pclub' : (Math.random() < 0.5 ? 'ddlc' : 'mods')) : fuente;
      const items = await getMerchWeekly(src, 10);
      if (!items.length) return interaction.editReply('No encontré merch esta semana.');
      const embeds = items.slice(0,5).map(it => new MessageEmbed().setTitle(safeSubstring(it.title, 100)).setURL(it.permalink || it.url).setDescription(`u/${it.author} • r/${it.subreddit}`).setImage(it.thumb || null).setTimestamp());
      await interaction.editReply({ embeds });
    }
  },

  video: {
    data: { name: 'video', description: 'Muestra el último video en español relacionado con DDLC' },
    async execute(interaction) {
      await interaction.deferReply();
      const res = await searchYouTubeLatestSpanish('ddlc español');
      if (!res) return interaction.editReply('No encontré videos ahora mismo.');
      const embed = new MessageEmbed().setTitle(res.title).setURL(res.url).setDescription(res.channel).setImage(res.thumb).setTimestamp();
      await interaction.editReply({ embeds: [embed] });
    }
  },

  noticias: {
    data: { name: 'noticias', description: 'Resumen de noticias recientes (DDLC / P Club / Mods)' },
    async execute(interaction) {
      await interaction.deferReply();
      const srList = ['DDLC', 'DDLCMods', 'ProjectClub'];
      let collected = [];
      for (const sr of srList) {
        const posts = await fetchRedditPosts(sr, { limit: 5, sort: 'new', t: 'week' });
        for (const p of posts.slice(0,3)) {
          collected.push({ title: p.title, subreddit: sr, author: p.author, url: `https://reddit.com${p.permalink}`, created: p.created_utc });
        }
      }
      collected = collected.sort((a,b) => (b.created || 0) - (a.created || 0)).slice(0,8);
      if (!collected.length) return interaction.editReply('No hay noticias nuevas esta semana.');
      const embed = new MessageEmbed().setTitle('Boletín DDLC / P Club / Mods').setTimestamp();
      for (const c of collected) embed.addField(safeSubstring(c.title, 80), `r/${c.subreddit} • u/${c.author} • ${c.url}`);
      await interaction.editReply({ embeds: [embed] });
    }
  }
};

// ----- REGISTER COMMANDS AND STARTUP -----
client.once('ready', async () => {
  console.log(`✅ ClubAssistant v${BOT_VERSION} conectado como ${client.user.tag}`);
  client.user.setActivity('P Club & DDLC Updates', { type: 'WATCHING' });

  try {
    await client.application.commands.set(Object.values(slashCommands).map(c => c.data));
    console.log(`✅ ${Object.keys(slashCommands).length} slash commands registrados`);
  } catch (e) {
    console.error('❌ Error registrando slash commands', e);
  }

  // periodic checks every serverConfig.checkInterval (default 5 minutes)
  setInterval(async () => {
    try {
      if (!serverConfig.notificationChannel) return;
      // twitter feeds
      await checkTwitter('pclub','pclub_tweet','#FF6B6B');
      await checkTwitter('teamSalvato','ddlc_tweet','#F08A5D');
      await checkTwitter('ddlcMods','ddlcMods_tweet','#9B59B6');
      await checkTwitter('ddlcGame','ddlcGame_tweet','#FF69B4');
      // weekly merch + latest video
      await autoWeeklyMerch();
      await autoLatestVideo();
    } catch (e) {
      console.warn('Periodic check error', e.message || e);
    }
  }, serverConfig.checkInterval);
});

// ----- INTERACTION HANDLING -----
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;
  const cmd = slashCommands[interaction.commandName];
  if (!cmd) return;
  try {
    await cmd.execute(interaction);
  } catch (e) {
    console.error('Error ejecutando comando', e);
    try { await interaction.reply({ content: '❌ Error ejecutando comando.', ephemeral: true }); } catch {}
  }
});

// ----- LOGIN -----
client.login(process.env.DISCORD_TOKEN || process.env.TOKEN);
