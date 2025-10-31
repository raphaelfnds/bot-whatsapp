if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const cheerio = require('cheerio');
const { Groq } = require('groq-sdk');
const PDFParser = require('pdf2json');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const app = express();
app.use(express.json());

// Função safe para decodeURIComponent
function safeDecodeURI(str) {
  str = str.replace(/%(?![0-9a-fA-F]{2})/g, '%25');
  try {
    return decodeURIComponent(str);
  } catch (e) {
    console.error('Falha ao decodificar:', str, e.message);
    return str;
  }
}

// ---------- MongoDB ----------
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB conectado'))
  .catch(err => console.error('Erro MongoDB:', err));

const User = require('./models/User');
const Edital = require('./models/Edital');

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

// Handlers
const nameHandler = require('./handlers/nameHandler');
const menuHandler = require('./handlers/menuHandler');
const agendaHandler = require('./handlers/agendaHandler');
const editalHandler = require('./handlers/editalHandler');
const attendantHandler = require('./handlers/attendantHandler');
const awaitingHelpHandler = require('./handlers/awaitingHelpHandler');

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

  if (conversationStates[from] && now - conversationStates[from].lastMessageTime > 10 * 60 * 1000) {
    delete conversationStates[from];
    state = 'awaiting_name';
  }
  if (!conversationStates[from]) {
    conversationStates[from] = { lastMessageTime: now, state: 'awaiting_name' };
  } else {
    conversationStates[from].lastMessageTime = now;
  }

  if (state === 'awaiting_help' && now - conversationStates[from].lastMessageTime > 5 * 60 * 1000) {
    state = 'menu_selection';
  }

  let response = '';
  let newState = state;

  console.log(`[DEPURAÇÃO] Estado inicial: ${state}, De: ${from}, Mensagem: "${message}"`);

  // Chama handler baseado no estado
  let handlerResult;
  switch (state) {
    case 'awaiting_name':
    case 'confirming_name':
      handlerResult = await nameHandler.handle(from, message, conversationStates, User);
      break;
    case 'menu_selection':
      handlerResult = await menuHandler.handle(from, message, conversationStates, Edital);
      break;
    case 'agenda_help':
      handlerResult = await agendaHandler.handle(from, message, conversationStates, {
        axios, cheerio, groq, PDFParser, safeDecodeURI, scrapeCache, SCRAPE_CACHE_TTL, resetQuotaIfNeeded, dailyCalls, DAILY_QUOTA
      });
      dailyCalls = handlerResult.dailyCalls || dailyCalls; // Atualiza quota se usada
      break;
    case 'edital_selection':
    case 'edital_help':
      handlerResult = await editalHandler.handle(from, message, conversationStates, {
        axios, cheerio, groq, PDFParser, safeDecodeURI, scrapeCache, SCRAPE_CACHE_TTL, resetQuotaIfNeeded, dailyCalls, DAILY_QUOTA, Edital
      });
      dailyCalls = handlerResult.dailyCalls || dailyCalls;
      break;
    case 'awaiting_help':
      handlerResult = awaitingHelpHandler.handle(from, message, conversationStates);
      break;
    default:
      handlerResult = { response: 'Estado inválido. Reiniciando.', newState: 'awaiting_name' };
  }

  response = handlerResult.response || 'Desculpe, erro interno. Tente novamente.\n\n1. Voltar ao menu\n2. Sair';
  newState = handlerResult.newState || 'menu_selection';
  
  if (newState) {
    conversationStates[from].state = newState;
  } else {
      delete conversationStates[from];
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
  } else {
    console.log('[DEPURAÇÃO] Nenhuma resposta gerada; possível vácuo no fluxo.');
  }

  res.sendStatus(200);
});

app.listen(process.env.PORT || 1000, () => console.log('Bot rodando na porta', process.env.PORT || 1000));