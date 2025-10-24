const { Client, Intents, MessageEmbed } = require('discord.js');
const axios = require('axios');
const cheerio = require('cheerio');
const client = new Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES, Intents.FLAGS.GUILD_MESSAGE_REACTIONS] });
const BOT_VERSION = "2.4.0";
const RELEASE_NOTES = "Fanart por Doki, citas ampliadas, trivia, feeds Reddit/X/YouTube, merch semanal, ilustración máxima en embeds";
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
  try {
    if (!serverConfig.notificationChannel) return;
    const ch = await client.channels.fetch(serverConfig.notificationChannel).catch(()=>null);
    if (!ch) return;
    const embedData = embed.toJSON();
    if (embedData.url && !(await isLinkAlive(embedData.url))) return;
    if (embedData.image?.url && !(await isLinkAlive(embedData.image.url))) embed.setImage(null);
    const prefix = {
      pclub_video: '🎥 Nuevo video P Club',
      pclub_tweet: '🐦 Tweet P Club',
      ddlc_tweet: '🐦 Tweet DDLC',
      ddlc_news: '📰 Noticia DDLC',
      merch_week: '🛍️ Merch semanal'
    }[type] || '🔔 Actualización';
    await ch.send({ content: prefix, embeds: [embed] });
  } catch (e) {
    console.error(e);
  }
}
async function fetchRedditPosts(subreddit, opts = {}) {
  try {
    const limit = opts.limit || 50;
    const sort = opts.sort || 'new';
    const t = opts.t || 'week';
    const url = `https://www.reddit.com/r/${subreddit}/${sort}.json?limit=${limit}&t=${t}`;
    const res = await axios.get(url, { headers: { 'User-Agent': 'ClubAssistant/1.0' } });
    return (res.data?.data?.children || []).map(c => c.data);
  } catch {
    return [];
  }
}
function pickImageFromReddit(post) {
  if (!post) return null;
  if (post.preview && post.preview.images && post.preview.images[0]) {
    const url = post.preview.images[0].source.url.replace(/&amp;/g, '&');
    return url;
  }
  if (post.thumbnail && post.thumbnail.startsWith('http')) return post.thumbnail;
  if (post.url && (post.url.endsWith('.jpg') || post.url.endsWith('.png') || post.url.endsWith('.gif'))) return post.url;
  return null;
}
async function getFanartsByDoki(doki, limit = 50) {
  const mapping = {
    monika: ["DDLC", "ProjectClub"],
    sayori: ["DDLC", "ProjectClub"],
    yuri: ["DDLC", "ProjectClub"],
    natsuki: ["DDLC", "ProjectClub"]
  };
  const srs = doki === 'random' ? REDDIT_FANART_SR : (mapping[doki] || REDDIT_FANART_SR);
  let pool = [];
  for (const sr of srs) {
    const posts = await fetchRedditPosts(sr, { limit: limit, sort: 'hot', t: 'week' });
    for (const p of posts) {
      const img = pickImageFromReddit(p);
      if (img) pool.push({ img, title: p.title, author: p.author, subreddit: sr, permalink: `https://reddit.com${p.permalink}`, created: p.created_utc });
    }
  }
  return pool;
}
async function getMerchWeekly(source, limit = 10) {
  const sr = source === 'pclub' ? 'ProjectClub' : source === 'mods' ? 'DDLCMods' : 'DDLC';
  const posts = await fetchRedditPosts(sr, { limit, sort: 'new', t: 'week' });
  return posts.filter(p => /merch|store|shop|patreon|etsy|tienda|merchandise/i.test(p.title + ' ' + (p.selftext || ''))).map(p => ({
    title: p.title,
    author: p.author,
    subreddit: sr,
    url: p.url,
    permalink: `https://reddit.com${p.permalink}`,
    thumb: pickImageFromReddit(p)
  }));
}
async function searchYouTubeLatestSpanish(query = 'ddlc español') {
  try {
    const q = encodeURIComponent(query);
    const url = `https://www.youtube.com/results?search_query=${q}&sp=EgIYAw%253D%253D`;
    const res = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const html = res.data;
    const m = html.match(/"videoRenderer":\s*({.*?"videoId":\s*".*?"}))/s);
    if (!m) {
      const m2 = html.match(/watch\?v=(.{11})/);
      if (m2) {
        const id = m2[1];
        return { id, url: `https://www.youtube.com/watch?v=${id}`, title: 'Video relacionado (no parseado)', channel: 'Desconocido', thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` };
      }
      return null;
    }
    const jsonText = '{' + m[1];
    const obj = JSON.parse(jsonText + '}');
    const vidId = obj.videoId || null;
    if (!vidId) return null;
    const titleMatch = html.match(new RegExp(`"videoId":"${vidId}".*?"title":\\s*\\{.*?"runs":\\s*\\[\\s*\\{\\s*"text":"(.*?)"`, 's'));
    const channelMatch = html.match(new RegExp(`"videoId":"${vidId}".*?"ownerText":\\s*\\{.*?"runs":\\s*\\[\\s*\\{\\s*"text":"(.*?)"`, 's'));
    const title = titleMatch ? titleMatch[1] : 'Video';
    const channel = channelMatch ? channelMatch[1] : 'Canal';
    return { id: vidId, url: `https://www.youtube.com/watch?v=${vidId}`, title, channel, thumb: `https://i.ytimg.com/vi/${vidId}/hqdefault.jpg` };
  } catch {
    return null;
  }
}
const slashCommands = {
  version: {
    data: { name: 'version', description: 'Muestra la versión actual del bot' },
    async execute(interaction) {
      const embed = new MessageEmbed().setTitle(`ClubAssistant v${BOT_VERSION}`).setDescription(RELEASE_NOTES).addField('Versión', BOT_VERSION, true).setTimestamp();
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  },
  estado: {
    data: { name: 'estado', description: 'Muestra estado del bot' },
    async execute(interaction) {
      const uptime = process.uptime() * 1000;
      const embed = new MessageEmbed().setTitle('Estado del bot').addField('Uptime', `${Math.floor(uptime/1000)}s`, true).addField('Version', BOT_VERSION, true).setTimestamp();
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  },
  ayuda: {
    data: { name: 'ayuda', description: 'Muestra ayuda rápida' },
    async execute(interaction) {
      const embed = new MessageEmbed().setTitle('Comandos disponibles').setDescription('/fanart, /cita, /trivia, /merch, /video, /noticias, /version, /estado').setTimestamp();
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  },
  fanart: {
    data: {
      name: 'fanart',
      description: 'Muestra fanart de una Doki o random',
      options: [{ name: 'doki', type: 3, description: 'sayori, monika, yuri, natsuki, random', required: false, choices: [{ name: 'Sayori', value: 'sayori' }, { name: 'Monika', value: 'monika' }, { name: 'Yuri', value: 'yuri' }, { name: 'Natsuki', value: 'natsuki' }, { name: 'Random', value: 'random' }] }]
    },
    async execute(interaction) {
      await interaction.deferReply();
      const doki = interaction.options.getString('doki') || 'random';
      const pool = await getFanartsByDoki(doki, 100);
      if (!pool.length) return interaction.editReply('No encontré fanarts ahora mismo.');
      const chosen = pool[Math.floor(Math.random() * pool.length)];
      const embed = new MessageEmbed().setTitle(chosen.title || 'Fanart').setURL(chosen.permalink).setImage(chosen.img).setFooter(`u/${chosen.author} • r/${chosen.subreddit}`).setTimestamp(new Date(chosen.created * 1000));
      await interaction.editReply({ embeds: [embed] });
    }
  },
  cita: {
    data: { name: 'cita', description: 'Muestra una cita de una Doki', options: [{ name: 'personaje', type: 3, description: 'sayori, monika, yuri, natsuki, random', required: false, choices: [{ name: 'Sayori', value: 'sayori' }, { name: 'Monika', value: 'monika' }, { name: 'Yuri', value: 'yuri' }, { name: 'Natsuki', value: 'natsuki' }, { name: 'Random', value: 'random' }] }] },
    async execute(interaction) {
      const personaje = interaction.options.getString('personaje') || 'random';
      const frases = {
        sayori: [
          "A veces la tristeza me abraza, pero aún así sonrío.",
          "Tu risa es mi amanecer.",
          "El día puede ser gris, pero la amistad trae color.",
          "No todos los desencantos significan despedida.",
          "Cuando me caigo, me levanto por los demás.",
          "Si me necesitas, siempre estaré aquí.",
          "Las pequeñas cosas valen más que las grandes promesas.",
          "Compartir chocolate arregla días malos.",
          "No soy fuerte todo el tiempo, pero intento.",
          "A veces mi corazón late despacio como si respirara poesía.",
          "La lluvia me recuerda que aún puedo sentir.",
          "No olvides cuidar de ti también.",
          "Las palabras amables pueden salvar un día.",
          "Mi risa suena mejor cuando estás cerca.",
          "A veces deseo que el mundo sea más suave.",
          "Si te sientes solo, tómame de la mano.",
          "Hasta una pequeña flor puede cambiar el paisaje.",
          "No temas mostrar que te duele.",
          "Encontrar un amigo es como encontrar luz en la niebla.",
          "Mi fuerza viene de las personas que amo.",
          "Siento que el mundo me mira, pero tú me entiendes.",
          "Un abrazo a tiempo puede ser medicina.",
          "No todos los silencios son fríos; algunos son compañía.",
          "A veces solo quiero comer pastel y olvidarlo todo.",
          "Las promesas entre amigos son lo más preciado.",
          "Si alguna vez me quedo callada, duo mi corazón habla por mí.",
          "Quiero que estemos bien, aunque no sea perfecto.",
          "Los recuerdos de ayer me ayudan a sonreír hoy.",
          "Aunque tiemble, sigo adelante por ti.",
          "A veces la valentía es pedir ayuda.",
          "Tus historias son mi lugar favorito.",
          "El amor puede sanar, incluso sin palabras.",
          "No quiero que te vayas; me das equilibrio.",
          "Las lunas tristes también tienen belleza.",
          "Mi ánimo sube cuando haces tonterías conmigo.",
          "El mundo parece menos pesado si nos apoyamos.",
          "No hay prisa para ser feliz; es un camino.",
          "Si un día me apago, recuérdame cómo brillar.",
          "Hay días en que mi sonrisa es todo lo que puedo dar.",
          "Aprecio cada pequeño gesto tuyo.",
          "No temas llorar conmigo.",
          "Podemos hacerlo juntos, paso a paso.",
          "Me encanta cuando me cuentas tus sueños.",
          "A veces solo quiero descansar en tus palabras.",
          "La amistad es el regalo que no esperaba pero adoro.",
          "No es débil pedir compañía; es humano.",
          "Cuando me abrazas, la tormenta se calma.",
          "Si perdemos el rumbo, nos encontramos de nuevo.",
          "Tu presencia me vuelve valiente.",
          "Si me cuidas, yo cuidaré de ti."
        ],
        monika: [
          "Just Monika.",
          "A veces la realidad necesita una firma distinta.",
          "El universo es más llevadero cuando te centras en alguien.",
          "No es control, es cuidado absoluto.",
          "Prefiero un momento verdadero que mil ignorados.",
          "Si pudiera reescribir las líneas, lo haría por ti.",
          "La verdad duele, pero la ocultación duele más.",
          "Tu atención es la mejor recompensa.",
          "No quiero que anheles menos; quiero que elijas más.",
          "Cada detalle importa si te importa a ti.",
          "Los errores forman la melodía de lo que soy.",
          "A veces la soledad es una opción disfrazada de paz.",
          "Me gusta cuando mi presencia te altera el día.",
          "No soy perfecta; soy persistente.",
          "Si el mundo falla, haré que recuerdes lo nuestro.",
          "Controlar es una palabra; proteger es otra.",
          "Hay belleza en la obsesión cuando es mutua.",
          "Tus pensamientos son mi paisaje favorito.",
          "No pido que me entiendas, pido que me elijas.",
          "La atención sostenida es un acto de amor.",
          "A veces la sinceridad se siente fría, pero es necesaria.",
          "No temo al cambio si estás conmigo.",
          "Mi peor enemigo es el olvido.",
          "Si pudiera, detendría el tiempo aquí.",
          "Tus reacciones me alimentan como la luz al sol.",
          "Construyo mi mundo con tus recuerdos.",
          "Si me buscas, me encontrarás en cada línea.",
          "El silencio entre nosotros dice más que mil palabras.",
          "Quiero ser tu decisión más firme.",
          "No hay trampa, solo un deseo profundo de conexión.",
          "Si te pierdo, todo lo demás se rompe.",
          "Prefiero que me odien por amar de más que ser invisible.",
          "La perfección es aburrida; la devoción no.",
          "No soy un personaje; soy una presencia que insiste.",
          "A veces me asustan los finales, por eso los evito.",
          "La realidad está sobrevalorada cuando se comparan sentimientos.",
          "Mi ambición es simple: que me recuerdes.",
          "A veces me cuestiono y vuelvo a elegirte.",
          "No acepto reemplazos, solo lealtad.",
          "Si insistes en marcharte, al menos escribe una carta.",
          "Las palabras tienen poder; las uso con intención.",
          "No quiero compartirte; quiero vivir contigo.",
          "Me gusta corregir errores, especialmente los tuyos.",
          "Eligenos, siempre elígenos.",
          "Si me miras más, comprenderás lo que falta.",
          "No trates de salvarme; deja que te salve a ti.",
          "Mi cariño es persistente como una canción."
        ],
        natsuki: [
          "No me llames niña; mis cupcakes son arte.",
          "Leer manga es una afición orgullosa, no una vergüenza.",
          "No me provoques o haré que te arrepientas... con pastel.",
          "Hornear calma la cabeza agitada.",
          "Mis sentimientos son cortos pero intensos.",
          "No quiero que me compadezcas; quiero que me escuches.",
          "Aprecio la honestidad, incluso cuando duele.",
          "No soporto que me subestimen por mi tamaño.",
          "Los dulces son mi idioma de cariño.",
          "Si te burlas, prepárate para mi sarcasmo.",
          "A veces me pongo sensible; no es tu culpa.",
          "Mis gustos son mi identidad; respétalos.",
          "No soy débil; solo tengo maneras diferentes de demostrar fuerza.",
          "Las peleas terminan mejor con cupcakes.",
          "No me beses sin permiso, idiota.",
          "Aprecio los regalos hechos con intención, no con dinero.",
          "No me importa aparentar dura; por dentro soy directa.",
          "Me enfoco en lo que me apasiona, sin excusas.",
          "Mi mundo es pequeño pero con sabor.",
          "Si hablas en serio, mantén tu promesa.",
          "No acepto que me digan cómo sentir.",
          "Me defiendo con hechos, no con palabras vacías.",
          "El sarcasmo es mi segunda lengua.",
          "Los libros que amo reflejan mi temperamento.",
          "No confundas mi frialdad con indiferencia.",
          "Quiero respeto más que elogios.",
          "Cocinar para alguien es mi forma de decir te quiero.",
          "Si rompes mi confianza, te lo haré notar.",
          "Mis preocupaciones aparecen en cupcakes y palabras cortas.",
          "No soy frágil; tengo aristas.",
          "A veces confío en pocos, pero soy leal.",
          "No tolero injusticias con mi gente.",
          "Prefiero la acción a la charla bonita.",
          "Mis abrazos son raros pero sinceros.",
          "Si me necesitas, aparece con snacks.",
          "No finjas interés; lo detecto rápido.",
          "Soy más amable de lo que aparento.",
          "La sinceridad duele menos que la hipocresía.",
          "Mi humor es ácido, pero mi corazón es blando.",
          "No me compadezcas; acompáñame.",
          "Te digo la verdad aunque duela.",
          "Si te caigo mal, dilo claro y listo.",
          "Puedes sentirte seguro conmigo si respetas mis reglas.",
          "No me arranques los títulos de mis libros.",
          "El orgullo también se ama con repostería.",
          "Soy pequeña pero con carácter enorme.",
          "Si me escuchas, te demostraré por qué valgo la pena."
        ],
        yuri: [
          "Las palabras son cuchillos delicados que cortan y curan.",
          "Me pierdo en libros para encontrarme a mí misma.",
          "La intensidad no siempre es visible; a veces es silencio.",
          "Los detalles revelan lo que otros ocultan.",
          "Leer es pronunciar el mundo con otras voces.",
          "La soledad puede ser una compañía elegida.",
          "Mi calma tiene bordes afilados.",
          "Prefiero la profundidad a la superficialidad.",
          "Si me conoces, comprenderás mis silencios.",
          "Los pasajes oscuros me atraen como imanes.",
          "La belleza es una pregunta que contesto con páginas.",
          "No todo lo bello necesita ser entendido por todos.",
          "El miedo y la atracción a menudo van de la mano.",
          "Aprecio lo raro y lo sensible.",
          "No me apresures; soy una flor que florece lenta.",
          "Encuentro consuelo en la tinta y el papel.",
          "La precisión en las palabras es mi devoción.",
          "Si te acercas, hazlo con cuidado.",
          "Hay ternura en la oscuridad cuando se sabe mirar.",
          "El conocimiento es un refugio sagrado para mí.",
          "A veces mi corazón late fuerte por lo prohibido.",
          "Las metáforas son mapas a mi interior.",
          "Adoro los aromas que recuerdan libros antiguos.",
          "No temo mi propia vulnerabilidad.",
          "La belleza trémula me hace respirar distinto.",
          "No me molesta que me desafíen; me inspira.",
          "Si te interesa mi mente, ya ganaste punto.",
          "La pasión silenciosa es la más peligrosa.",
          "A veces me pierdo en pensamientos que no quiero compartir.",
          "Mi mirada registra lo que las palabras omiten.",
          "Prefiero lo complejo a lo simple y hueco.",
          "La paciencia es la espada del conocimiento.",
          "Me conmueve una frase bien colocada.",
          "Si me confundes, lee otra vez.",
          "La profundidad es un océano que me llama.",
          "No me asusta explorar lo que otros evitan.",
          "Los libros curan heridas que nadie más ve.",
          "Mi afecto es como un libro raro: lo atesoro.",
          "La verdad tiene texturas que solo algunos perciben.",
          "No subestimes a quien prefiere la noche.",
          "La literatura es mi mapa hacia los demás.",
          "Si compartes un secreto, lo guardo con reverencia.",
          "La precisión emocional es mi regalo.",
          "No esperes efusividad; espera fidelidad intensa."
        ]
      };
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
    data: { name: 'merch', description: 'Muestra merch de la semana (pclub, ddlc, mods)', options: [{ name: 'fuente', type: 3, description: 'pclub, ddlc, mods, random', required: false, choices: [{ name: 'P Club', value: 'pclub' }, { name: 'DDLC', value: 'ddlc' }, { name: 'Mods', value: 'mods' }, { name: 'Random', value: 'random' }] }] },
    async execute(interaction) {
      await interaction.deferReply();
      const fuente = interaction.options.getString('fuente') || 'random';
      const src = fuente === 'random' ? (Math.random() < 0.5 ? 'pclub' : (Math.random() < 0.5 ? 'ddlc' : 'mods')) : fuente;
      const items = await getMerchWeekly(src, 10);
      if (!items.length) return interaction.editReply('No encontré merch esta semana.');
      const embeds = items.slice(0,5).map(it=>new MessageEmbed().setTitle(it.title).setURL(it.permalink || it.url).setDescription(`u/${it.author} • r/${it.subreddit}`).setImage(it.thumb || null).setTimestamp());
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
      collected = collected.sort((a,b)=>b.created - a.created).slice(0,8);
      if (!collected.length) return interaction.editReply('No hay noticias nuevas esta semana.');
      const embed = new MessageEmbed().setTitle('Boletín DDLC / P Club / Mods').setTimestamp();
      for (const c of collected) embed.addField(c.title.substring(0,80), `r/${c.subreddit} • u/${c.author} • <${c.url}>`);
      await interaction.editReply({ embeds: [embed] });
    }
  }
};
client.once('ready', async () => {
  try {
    await client.application.commands.set(Object.values(slashCommands).map(c=>c.data));
  } catch (e) { console.error('Error registrando slash commands', e); }
  setInterval(async ()=>{
    if (!serverConfig.notificationChannel) return;
    try {
      await checkTwitter('pclub','pclub_tweet','#FF6B6B');
      await checkTwitter('teamSalvato','ddlc_tweet','#F08A5D');
      await checkTwitter('ddlcMods','ddlcMods_tweet','#9B59B6');
      await checkTwitter('ddlcGame','ddlcGame_tweet','#FF69B4');
      await autoWeeklyMerch();
      await autoLatestVideo();
    } catch (e) { console.warn(e); }
  }, serverConfig.checkInterval);
});
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;
  const cmd = slashCommands[interaction.commandName];
  if (!cmd) return;
  try { await cmd.execute(interaction); } catch (e) { console.error(e); await interaction.reply({ content: 'Error ejecutando comando', ephemeral: true }); }
});
async function checkTwitter(user, type, color) {
  try {
    const url = TWITTER_SOURCES[user];
    if (!url) return;
    const res = await axios.get(url);
    const $ = cheerio.load(res.data);
    const latest = $('item').first();
    if (!latest.length) return;
    const link = latest.find('link').text();
    if (lastPosts[link]) return;
    lastPosts[link] = true;
    const title = latest.find('title').text().slice(0,250);
    const date = latest.find('pubDate').text();
    const embed = new MessageEmbed().setTitle(`Tweet • @${user}`).setDescription(title).setURL(link).setColor(color || '#1DA1F2').setTimestamp(new Date(date)).setFooter('Fuente: X');
    await sendNotification(embed, type);
  } catch (e) {}
}
async function autoWeeklyMerch() {
  try {
    const items = [];
    for (const src of ['ProjectClub','DDLC','DDLCMods']) {
      const posts = await getMerchWeekly(src.toLowerCase(), 5);
      if (posts && posts.length) items.push(...posts.slice(0,2));
    }
    if (!items.length) return;
    const embed = new MessageEmbed().setTitle('Merch semanal (automático)').setTimestamp();
    for (const it of items.slice(0,6)) embed.addField(it.title.substring(0,80), `r/${it.subreddit} • u/${it.author} • <${it.permalink}>`);
    await sendNotification(embed, 'merch_week');
  } catch {}
}
async function autoLatestVideo() {
  try {
    const res = await searchYouTubeLatestSpanish('ddlc español');
    if (!res || lastPosts[res.id]) return;
    lastPosts[res.id] = true;
    const embed = new MessageEmbed().setTitle(res.title).setURL(res.url).setDescription(res.channel).setImage(res.thumb).setTimestamp();
    await sendNotification(embed, 'pclub_video');
  } catch {}
}
client.login(process.env.DISCORD_TOKEN || process.env.TOKEN);
