// app.js - VERSÃO FINAL: Axios + Cheerio + Gemini + Deduplicação
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const cheerio = require('cheerio');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(express.json());

// MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB conectado'))
  .catch(err => console.error('Erro MongoDB:', err));

// Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const geminiModel = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

// Model
const User = require('./models/User');

// Estados + Cache de wamids
const conversationStates = {};
const processedWamids = new Map();
const CACHE_TTL = 10 * 60 * 1000;

app.get('/webhook', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === 'meuTokenSecreto2025') {
    res.send(req.query['hub.challenge']);
  } else {
    res.sendStatus(403);
  }
});

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
  if (conversationStates[from] && now - conversationStates[from].lastMessageTime > 30 * 60 * 1000) {
    delete conversationStates[from];
    state = 'awaiting_name';
  }
  if (!conversationStates[from]) conversationStates[from] = { lastMessageTime: now };
  conversationStates[from].lastMessageTime = now;

  let response = '';

  // ========== ESTADOS ==========
  if (state === 'awaiting_name') {
    const user = await User.findOne({ phone: from });
    if (user?.acceptedTerms) {
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
        response = `Seu nome é *${cleanName}*?\n\n1. SIM\n2. NÃO\n3. SAIR`;
      }
    }
  }

  else if (state === 'confirming_name') {
    if (message === '1') {
      await User.create({ phone: from, name: conversationStates[from].proposedName, acceptedTerms: true });
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
  }

  else if (state === 'menu_selection') {
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
  }

  else if (state === 'awaiting_question') {
    const url = conversationStates[from].topic === 'agenda'
      ? 'https://cultura.pontagrossa.pr.gov.br/agenda-cultural/'
      : 'https://cultura.pontagrossa.pr.gov.br/2025-2/';

    try {
      const { data } = await axios.get(url, { timeout: 15000 });
      const $ = cheerio.load(data);
      const context = $('body').text().replace(/\s+/g, ' ').trim().substring(0, 50000);

      const result = await geminiModel.generateContent(
        `Contexto do site oficial:\n${context}\n\nPergunta do usuário: ${message}\n\nResponda em português, de forma clara e objetiva. Se não souber, diga: "Não encontrei informações sobre isso."`
      );
      response = result.response.text() + '\n\n1. Voltar ao menu\n2. Sair';
    } catch (err) {
      console.error('Erro scraping/IA:', err.message);
      response = 'Desculpe, não consegui acessar o site agora. Tente novamente.\n\n1. Voltar ao menu\n2. Sair';
    }
    conversationStates[from].state = 'awaiting_help';
  }

  else if (state === 'awaiting_help') {
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

  // === ENVIO ===
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

app.listen(process.env.PORT || 10000, () => console.log('Bot rodando na porta', process.env.PORT || 10000));