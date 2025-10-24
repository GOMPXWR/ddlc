global.ReadableStream = require("stream/web").ReadableStream;
const { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const axios = require('axios');
const cheerio = require('cheerio');
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent], partials: [Partials.Channel] });
const BOT_VERSION = "2.6.1";
let serverConfig = { notificationChannel: null, mentionRole: null, checkInterval: 300000 };
const REDDIT_FANART_SR = ["DDLC", "DDLCMods", "ProjectClub"];
const REDDIT_MERCH_SR = ["DDLC", "DDLCMods", "ProjectClub"];
const TWITTER_SOURCES = {
  pclub: 'https://twitrss.me/twitter_user_to_rss/?user=ProjectClub_',
  teamSalvato: 'https://twitrss.me/twitter_user_to_rss/?user=TeamSalvato',
  ddlcMods: 'https://twitrss.me/twitter_user_to_rss/?user=DDLCMods',
  ddlcGame: 'https://twitrss.me/twitter_user_to_rss/?user=DDLCGame'
};
let lastPosts = {};
async function isLinkAlive(url) {
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
async function sendNotification(embed, type) {
  if (!serverConfig.notificationChannel) return;
  const ch = await client.channels.fetch(serverConfig.notificationChannel).catch(()=>null);
  if (!ch) return;
  const embedData = embed.toJSON();
  if (embedData.url && !(await isLinkAlive(embedData.url))) return;
  if (embedData.image?.url && !(await isLinkAlive(embedData.image.url))) embed.setImage(null);
  const prefix = { pclub_video: '🎥 Nuevo video P Club', pclub_tweet: '🐦 Tweet P Club', ddlc_tweet: '🐦 Tweet DDLC', ddlc_news: '📰 Noticia DDLC', merch_week: '🛍️ Merch semanal' }[type] || '🔔 Actualización';
  await ch.send({ content: prefix, embeds: [embed] });
}
async function fetchRedditPosts(subreddit, opts = {}) {
  try {
    const limit = opts.limit || 50;
    const sort = opts.sort || 'new';
    const t = opts.t || 'week';
    const url = `https://www.reddit.com/r/${subreddit}/${sort}.json?limit=${limit}&t=${t}`;
    const res = await axios.get(url, { headers: { 'User-Agent': 'ClubAssistant/2.6' } });
    return (res.data?.data?.children || []).map(c => c.data);
  } catch {
    return [];
  }
}
function pickImageFromReddit(post) {
  if (!post) return null;
  try {
    if (post.preview && post.preview.images && post.preview.images[0]) {
      const imgObj = post.preview.images[0];
      if (imgObj.resolutions && imgObj.resolutions.length) {
        const best = imgObj.resolutions[imgObj.resolutions.length - 1];
        return best.url.replace(/&amp;/g, '&');
      }
      if (imgObj.source?.url) return imgObj.source.url.replace(/&amp;/g, '&');
    }
    if (post.media_metadata) {
      const first = Object.values(post.media_metadata)[0];
      if (first?.p && first.p.length) {
        const best = first.p[first.p.length - 1];
        return best.u.replace(/&amp;/g, '&');
      }
    }
    if (post.url && /\.(jpe?g|png|gif|webp)$/i.test(post.url)) return post.url;
    if (post.thumbnail && post.thumbnail.startsWith('http')) return post.thumbnail;
    return null;
  } catch {
    return null;
  }
}
async function getFanartsByDoki(doki, limit = 50) {
  const mapping = { monika: ["DDLC", "ProjectClub"], sayori: ["DDLC", "ProjectClub"], yuri: ["DDLC", "ProjectClub"], natsuki: ["DDLC", "ProjectClub"] };
  const srs = doki === 'random' ? REDDIT_FANART_SR : (mapping[doki] || REDDIT_FANART_SR);
  let pool = [];
  for (const sr of srs) {
    const posts = await fetchRedditPosts(sr, { limit, sort: 'hot', t: 'week' });
    for (const p of posts) {
      const img = pickImageFromReddit(p);
      if (!img) continue;
      const text = (p.title + ' ' + (p.link_flair_text || '') + ' ' + (p.selftext || '')).toLowerCase();
      if (doki === 'random' || text.includes(doki.toLowerCase())) pool.push({ img, title: p.title, author: p.author, subreddit: sr, permalink: `https://reddit.com${p.permalink}`, created: p.created_utc });
    }
  }
  const unique = [];
  const seen = new Set();
  for (const p of pool) {
    if (!seen.has(p.img)) {
      seen.add(p.img);
      unique.push(p);
    }
  }
  return unique;
}
async function searchYouTubeLatestSpanish(query = 'ddlc español') {
  try {
    const q = encodeURIComponent(query);
    const url = `https://www.youtube.com/results?search_query=${q}&sp=EgIQAQ%253D%253D`;
    const res = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const html = res.data;
    const match = html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
    if (!match) return null;
    const vidId = match[1];
    const titleMatch = html.match(new RegExp(`"videoId":"${vidId}".*?"title":\\{"runs":\\[\\{"text":"(.*?)"`, 's'));
    const channelMatch = html.match(new RegExp(`"videoId":"${vidId}".*?"ownerText":\\{"runs":\\[\\{"text":"(.*?)"`, 's'));
    const title = titleMatch ? titleMatch[1] : 'Video relacionado';
    const channel = channelMatch ? channelMatch[1] : 'Canal';
    return { id: vidId, url: `https://www.youtube.com/watch?v=${vidId}`, title, channel, thumb: `https://i.ytimg.com/vi/${vidId}/hqdefault.jpg` };
  } catch {
    return null;
  }
}
const slashCommands = {
  trivia: {
    data: { name: 'trivia', description: 'Trivia interactiva sobre DDLC' },
    async execute(interaction) {
      const preguntas = [
        { q: "¿Quién dice 'Just Monika'?", o: ["Sayori", "Monika", "Yuri", "Natsuki"], c: 1 },
        { q: "¿A qué club pertenece el jugador?", o: ["Club de arte", "Club de literatura", "Club de cocina", "Club de juegos"], c: 1 },
        { q: "¿Qué color identifica a Sayori?", o: ["Rosa", "Naranja", "Celeste", "Rojo"], c: 2 },
        { q: "¿Qué hace Natsuki para relajarse?", o: ["Leer manga", "Coser", "Pintar", "Escuchar música"], c: 0 },
        { q: "¿Qué año se lanzó DDLC?", o: ["2016", "2017", "2018", "2015"], c: 1 }
      ];
      const p = preguntas[Math.floor(Math.random() * preguntas.length)];
      const embed = new EmbedBuilder().setTitle('Trivia DDLC').setDescription(p.q).setColor('#ff66cc');
      const row = new ActionRowBuilder();
      p.o.forEach((opt, i) => row.addComponents(new ButtonBuilder().setCustomId(`trivia_${i}`).setLabel(opt).setStyle(ButtonStyle.Secondary)));
      await interaction.reply({ embeds: [embed], components: [row] });
      const collector = interaction.channel.createMessageComponentCollector({ time: 15000, filter: i => i.user.id === interaction.user.id });
      collector.on('collect', async i => {
        const index = parseInt(i.customId.split('_')[1]);
        const correct = index === p.c;
        await i.update({ content: `${correct ? '✅ Correcto' : `❌ Incorrecto, era ${p.o[p.c]}`}`, embeds: [], components: [] });
      });
      collector.on('end', collected => {
        if (collected.size === 0) interaction.editReply({ content: '⏰ Tiempo agotado.', embeds: [], components: [] });
      });
    }
  },
  video: {
    data: { name: 'video', description: 'Últimos videos variados sobre DDLC' },
    async execute(interaction) {
      await interaction.deferReply();
      const res = await searchYouTubeLatestSpanish('doki doki literature club');
      if (!res) return interaction.editReply('No encontré videos ahora mismo.');
      const embed = new EmbedBuilder().setTitle(res.title).setURL(res.url).setDescription(res.channel).setImage(res.thumb).setColor('#ff99cc').setTimestamp();
      await interaction.editReply({ embeds: [embed] });
    }
  },
  fanart: {
    data: {
      name: 'fanart',
      description: 'Fanart por Doki o random',
      options: [{ name: 'doki', type: 3, description: 'sayori, monika, yuri, natsuki, random', required: false, choices: [{ name: 'Sayori', value: 'sayori' }, { name: 'Monika', value: 'monika' }, { name: 'Yuri', value: 'yuri' }, { name: 'Natsuki', value: 'natsuki' }, { name: 'Random', value: 'random' }] }]
    },
    async execute(interaction) {
      await interaction.deferReply();
      const doki = interaction.options.getString('doki') || 'random';
      const pool = await getFanartsByDoki(doki, 100);
      if (!pool.length) return interaction.editReply('No encontré fanarts ahora mismo.');
      const chosen = pool[Math.floor(Math.random() * pool.length)];
      const embed = new EmbedBuilder().setTitle(chosen.title).setURL(chosen.permalink).setImage(chosen.img).setFooter({ text: `u/${chosen.author} • r/${chosen.subreddit}` }).setColor('#ff66cc').setTimestamp(new Date(chosen.created * 1000));
      await interaction.editReply({ embeds: [embed] });
    }
  }
};
client.once('ready', async () => {
  await client.application.commands.set(Object.values(slashCommands).map(c => c.data));
  console.log(`ClubAssistant v${BOT_VERSION} listo.`);
});
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;
  const cmd = slashCommands[interaction.commandName];
  if (!cmd) return;
  try { await cmd.execute(interaction); } catch (e) { console.error(e); await interaction.reply({ content: 'Error ejecutando comando', ephemeral: true }); }
});
client.login(process.env.DISCORD_TOKEN || process.env.TOKEN);

