// app.js - ETAPA 2: Axios + Cheerio + Groq (Llama3-8B) + Quota em memória
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const cheerio = require('cheerio');
const { Groq } = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const app = express();
app.use(express.json());

// ---------- MongoDB ----------
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB conectado'))
  .catch(err => console.error('Erro MongoDB:', err));

const User = require('./models/User');

// ---------- Quota diária (em memória) ----------
const DAILY_QUOTA = 200;
let dailyCalls = 0;
let quotaResetDate = new Date().toISOString().split('T')[0];

function resetQuotaIfNeeded() {
  const today = new Date().toISOString().split('T')[0];
  if (today !== quotaResetDate) {
    dailyCalls = 0;
    quotaResetDate = today;
  }
}

// ---------- Cache ----------
const conversationStates = {};
const processedWamids = new Map();
const CACHE_TTL = 10 * 60 * 1000;

const scrapeCache = new Map();
const SCRAPE_CACHE_TTL = 5 * 60 * 1000;

// ---------- Webhook GET ----------
app.get('/webhook', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === 'meuTokenSecreto2025') {
    res.send(req.query['hub.challenge']);
  } else {
    res.sendStatus(403);
  }
});

// ---------- Webhook POST ----------
app.post('/webhook', async (req, res) => {
  const body = req.body;
  if (!body?.entry?.[0]?.changes?.[0]?.value) return res.sendStatus(200);

  const change = body.entry[0].changes[0].value;
  const wamid = change.messages?.[0]?.id || change.statuses?.[0]?.id;
  if (!wamid || processedWamids.has(wamid)) return res.sendStatus(200);
  processedWamids.set(wamid, Date.now());
  setTimeout(() => processedWamids.delete(wamid), CACHE_TTL);

  if (!change.messages?.[0]) return res.sendStatus(200);

  const { from, text } = change.messages[0];
  const message = text?.body?.trim();
  if (!message) return res.sendStatus(200);

  let state = conversationStates[from]?.state || 'awaiting_name';
  const now = Date.now();

  // timeout 30 min
  if (conversationStates[from] && now - conversationStates[from].lastMessageTime > 30 * 60 * 1000) {
    delete conversationStates[from];
    state = 'awaiting_name';
  }
  if (!conversationStates[from]) conversationStates[from] = { lastMessageTime: now };
  conversationStates[from].lastMessageTime = now;

  let response = '';

  // ==================== ESTADOS ====================
  if (state === 'awaiting_name') {
    const user = await User.findOne({ phone: from });
    if (user) {
      conversationStates[from].state = 'menu_selection';
      response = 'Sobre o que deseja falar?\n1. Agenda.\n2. Edital.\n3. Falar com atendente.\n4. Sair.';
    } else {
      if (!conversationStates[from].welcomed) {
        conversationStates[from].welcomed = true;
        response = 'Bem-vindo! Por favor, *escreva seu nome*.';
      } else {
        const name = message.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z ]/g, '');
        const cleanName = name.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
        conversationStates[from].proposedName = cleanName || 'Usuário';
        conversationStates[from].state = 'confirming_name';
        response = `Seu nome é *${cleanName}*?\n\n1. SIM\n2. NÃO\n3. SAIR\n\n*Ao digitar "1" você aceita nossa política de privacidade.*`;
      }
    }
  } else if (state === 'confirming_name') {
    if (message === '1') {
      await User.create({ phone: from, name: conversationStates[from].proposedName });
      conversationStates[from].state = 'menu_selection';
      response = 'Sobre o que deseja falar?\n1. Agenda.\n2. Edital.\n3. Falar com atendente.\n4. Sair.';
    } else if (message === '2') {
      conversationStates[from].state = 'awaiting_name';
      delete conversationStates[from].proposedName;
      response = 'Por favor, escreva seu nome novamente.';
    } else if (message === '3') {
      delete conversationStates[from];
      response = 'Atendimento encerrado.';
    } else {
      response = 'Resposta inválida. Digite 1, 2 ou 3.';
    }
  } else if (state === 'menu_selection') {
    if (message === '1') {
      conversationStates[from].topic = 'agenda';
      conversationStates[from].state = 'awaiting_question';
      response = 'Qual sua dúvida sobre a *agenda cultural*?';
    } else if (message === '2') {
      conversationStates[from].topic = 'edital';
      conversationStates[from].state = 'awaiting_question';
      response = 'Qual sua dúvida sobre o *edital*?';
    } else if (message === '3') {
      response = 'Redirecionando: https://wa.me/554288768668';
    } else if (message === '4') {
      delete conversationStates[from];
      response = 'Obrigado!';
    } else {
      response = 'Opção inválida. Escolha 1 a 4.';
    }
  } else if (state === 'awaiting_question') {
    const url = conversationStates[from].topic === 'agenda'
      ? 'https://cultura.pontagrossa.pr.gov.br/agenda-cultural/'
      : 'https://cultura.pontagrossa.pr.gov.br/2025-2/';

    let data;
    try {
      // ---- CACHE + RETRY SCRAPING ----
      const cacheKey = url;
      const cached = scrapeCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < SCRAPE_CACHE_TTL) {
        data = cached.html;
        console.log('Cache hit para:', url);
      } else {
        let attempts = 0;
        const maxAttempts = 3;
        while (attempts < maxAttempts) {
          try {
            const resp = await axios.get(url, {
              timeout: 30000,
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'pt-BR,pt;q=0.9',
                'Connection': 'keep-alive'
              }
            });
            data = resp.data;
            scrapeCache.set(cacheKey, { html: data, timestamp: Date.now() });
            break;
          } catch (err) {
            attempts++;
            console.error(`Tentativa ${attempts}/${maxAttempts} falhou para ${url}:`, err.code || err.message);
            if (attempts >= maxAttempts) throw err;
            await new Promise(r => setTimeout(r, 2000 * attempts));
          }
        }
      }

      const $ = cheerio.load(data);
      const context = $('body').text().replace(/\s+/g, ' ').trim().substring(0, 50000);

      // ---- QUOTA DIÁRIA ----
      resetQuotaIfNeeded();
      if (dailyCalls >= DAILY_QUOTA) {
        response = 'Limite diário de consultas à IA atingido. Acesse diretamente o site.\n\n1. Voltar ao menu\n2. Sair';
      } else {
        // ---- GROQ CALL (Llama3-8B - 100% gratuito, 2025) ----
        let aiResult = '';

        try {
          const completion = await groq.chat.completions.create({
            model: 'llama-3.1-8b-instant',
            messages: [
              {
                role: 'system',
                content: 'Você é um assistente da Secretaria de Cultura de Ponta Grossa. Responda em português, de forma clara e objetiva (máx 200 palavras). Use apenas o contexto abaixo. Se não souber, diga: "Não encontrei informações sobre isso."\n\nContexto: ' + context.substring(0, 30000)
              },
              {
                role: 'user',
                content: message
              }
            ],
            max_tokens: 150,
            temperature: 0.7
          });

          aiResult = completion.choices[0].message.content.trim();

          dailyCalls++;
          response = aiResult + '\n\n1. Voltar ao menu\n2. Sair';

        } catch (err) {
          console.error('Groq erro:', err.message);
          response = 'Desculpe, não consegui processar sua dúvida agora. Tente novamente.\n\n1. Voltar ao menu\n2. Sair';
        }
      }

      conversationStates[from].state = 'awaiting_help';
    } catch (err) {
      console.error('Erro scraping/IA:', err.message);
      response = 'Desculpe, não consegui acessar o site agora. Tente novamente.\n\n1. Voltar ao menu\n2. Sair';
      conversationStates[from].state = 'awaiting_help';
    }
  } else if (state === 'awaiting_help') {
    if (message === '1') {
      conversationStates[from].state = 'menu_selection';
      response = 'Sobre o que deseja falar?\n1. Agenda.\n2. Edital.\n3. Falar com atendente.\n4. Sair.';
    } else if (message === '2') {
      delete conversationStates[from];
      response = 'Atendimento encerrado.';
    } else {
      response = 'Digite 1 ou 2.';
    }
  }

  // ==================== ENVIO ====================
  if (response) {
    try {
      await axios.post(
        `https://graph.facebook.com/v24.0/${process.env.PHONE_NUMBER_ID}/messages`,
        { messaging_product: 'whatsapp', to: from, text: { body: response } },
        { headers: { Authorization: `Bearer ${process.env.ACCESS_TOKEN}` } }
      );
      console.log(`Enviado para ${from}: ${response.substring(0, 50)}...`);
    } catch (err) {
      console.error('Erro envio:', err.response?.data || err.message);
    }
  }

  res.sendStatus(200);
});

app.listen(process.env.PORT || 4000, () => console.log('Bot rodando na porta', process.env.PORT || 4000));