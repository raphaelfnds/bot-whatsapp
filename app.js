// Carrega .env apenas em desenvolvimento
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const puppeteer = require('puppeteer-core'); // Usa Chrome já instalado no Render
const chromium = require('@sparticuz/chromium'); // Chrome binário para Render

const app = express();
app.use(express.json());

// Conexão MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Conectado ao MongoDB'))
  .catch(err => console.error('Erro:', err));

// Inicialização Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const geminiModel = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

// Schema User
const User = require('./models/User');

// Estados + cache deduplicação
const conversationStates = {};
const processedCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === 'meuTokenSecreto2025') {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post('/webhook', async (req, res) => {
  console.log('Webhook recebido:', JSON.stringify(req.body, null, 2));

  const body = req.body;
  if (!body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
    console.log('Payload inválido');
    return res.sendStatus(200);
  }

  const message = body.entry[0].changes[0].value.messages[0];
  const msgId = message.id;
  const from = message.from;
  const text = message.text?.body?.trim();

  // === DEDUPLICAÇÃO ===
  if (processedCache.has(msgId)) {
    console.log(`Duplicado ignorado: ${msgId}`);
    return res.sendStatus(200);
  }
  processedCache.set(msgId, Date.now());
  setTimeout(() => processedCache.delete(msgId), CACHE_TTL);

  let state = conversationStates[from]?.state || 'awaiting_name';
  const now = Date.now();

  if (conversationStates[from] && now - conversationStates[from].lastMessageTime > 30 * 60 * 1000) {
    state = 'awaiting_name';
  }

  if (!conversationStates[from]) conversationStates[from] = {};
  conversationStates[from].lastMessageTime = now;

  let responseText = '';

  // ---------- ESTADOS ----------
  if (state === 'awaiting_name') {
    const existingUser = await User.findOne({ phone: from });
    if (existingUser && existingUser.acceptedTerms) {
      conversationStates[from] = { state: 'menu_selection', proposedName: existingUser.name, lastMessageTime: now };
      responseText = 'Sobre o que deseja falar?\n1. Agenda.\n2. Edital.\n3. Falar com atendente.\n4. Sair e encerrar o atendimento.';
    } else {
      if (!conversationStates[from].welcomed) {
        conversationStates[from].welcomed = true;
        responseText = 'Bem vindo ao atendimento de IA!\nPor favor, *escreva qual seu nome*.';
      } else {
        let cleanedName = text.trim().normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z]/g, '');
        cleanedName = cleanedName.charAt(0).toUpperCase() + cleanedName.slice(1).toLowerCase();
        conversationStates[from].proposedName = cleanedName || 'Usuario';
        conversationStates[from].state = 'confirming_name';
        responseText = `O nome que você escreveu é ${cleanedName}, correto?\n\nDigite:\n1. Para SIM.\n2. Para NAO.\n3. Para SAIR.\nObservação: Ao digitar "1. Para SIM" também estará aceitando a politica de privacidade: https://github.com/raphaelfnds/bot-whatsapp-privacidade/tree/main?tab=readme-ov-file#pol%C3%ADtica-de-privacidade---bot-whatsapp.`;
      }
    }
  } else if (state === 'confirming_name') {
    const option = text.trim();
    if (option === '1') {
      await User.create({ phone: from, name: conversationStates[from].proposedName, acceptedTerms: true });
      conversationStates[from].state = 'menu_selection';
      responseText = 'Sobre o que deseja falar?\n1. Agenda.\n2. Edital.\n3. Falar com atendente.\n4. Sair e encerrar o atendimento.';
    } else if (option === '2') {
      conversationStates[from].state = 'awaiting_name';
      delete conversationStates[from].proposedName;
      responseText = 'Por favor, escreva qual seu nome.';
    } else if (option === '3') {
      delete conversationStates[from];
      responseText = 'Agradecemos seu contato.';
    } else {
      responseText = `Não entendi sua resposta.\nO nome que você escreveu é ${conversationStates[from].proposedName}, correto?\n\nDigite:\n1. Para SIM.\n2. Para NAO.\n3. Para SAIR.\nObservação: Ao digitar "1. Para SIM" também estará aceitando a politica de privacidade: https://github.com/raphaelfnds/bot-whatsapp-privacidade/tree/main?tab=readme-ov-file#pol%C3%ADtica-de-privacidade---bot-whatsapp.`;
    }
  } else if (state === 'menu_selection') {
    const option = text.trim();
    if (option === '1') {
      conversationStates[from].topic = 'agenda';
      conversationStates[from].state = 'awaiting_question';
      responseText = 'Qual é a sua dúvida sobre a *agenda cultural*?';
    } else if (option === '2') {
      conversationStates[from].topic = 'edital';
      conversationStates[from].state = 'awaiting_question';
      responseText = 'Qual é a sua dúvida sobre o *edital*?';
    } else if (option === '3') {
      responseText = 'Por favor, clique no link para ser redirecionado: https://wa.me/554288768668';
    } else if (option === '4') {
      delete conversationStates[from];
      responseText = 'Agradecemos seu contato.';
    } else {
      responseText = 'Opção inválida.\nSobre o que deseja falar?\n1. Agenda.\n2. Edital.\n3. Falar com atendente.\n4. Sair e encerrar o atendimento.';
    }
  } else if (state === 'awaiting_question') {
    const question = text.trim();
    let context = '';
    const url = conversationStates[from].topic === 'agenda'
      ? 'https://cultura.pontagrossa.pr.gov.br/agenda-cultural/'
      : 'https://cultura.pontagrossa.pr.gov.br/2025-2/';

    try {
      // === PUPPETEER SCRAPING ===
      const browser = await puppeteer.launch({
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(),
        headless: true,
        timeout: 30000 // 30s
      });
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      const html = await page.content();
      await browser.close();

      // Remove scripts, estilos e limpa
      const cleanText = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      context = cleanText.substring(0, 60000); // Gemini aceita até 1M, mas limitamos
      console.log('Contexto extraído (primeiros 500):', context.substring(0, 500));

      // === GEMINI IA ===
      const prompt = `Contexto do site oficial (extraído com Puppeteer):\n${context}\n\nPergunta do usuário: ${question}\n\nResponda em português, de forma clara, objetiva e amigável. Se não souber, diga: "Não encontrei informações sobre isso."`;
      const result = await geminiModel.generateContent(prompt);
      const aiResponse = result.response.text();

      responseText = aiResponse + '\n\n1. Voltar ao menu\n2. Sair';
      conversationStates[from].state = 'awaiting_help';
    } catch (error) {
      console.error('Erro Puppeteer/Gemini:', {
        message: error.message,
        stack: error.stack,
        url,
        question
      });
      responseText = 'Desculpe, ocorreu um erro ao processar sua dúvida. Tente novamente.\n\n1. Voltar ao menu\n2. Sair';
      conversationStates[from].state = 'awaiting_help';
    }
  } else if (state === 'awaiting_help') {
    const opt = text.trim();
    if (opt === '1') {
      conversationStates[from].state = 'menu_selection';
      responseText = 'Sobre o que deseja falar?\n1. Agenda.\n2. Edital.\n3. Falar com atendente.\n4. Sair e encerrar o atendimento.';
    } else if (opt === '2') {
      delete conversationStates[from];
      responseText = 'Agradecemos seu contato.';
    } else {
      responseText = 'Opção inválida. Digite:\n1. Voltar ao menu\n2. Sair';
    }
  }

  // Envio
  if (responseText) {
    try {
      await axios.post(
        `https://graph.facebook.com/v24.0/${process.env.PHONE_NUMBER_ID}/messages`,
        {
          messaging_product: 'whatsapp',
          to: from,
          type: 'text',
          text: { body: responseText }
        },
        {
          headers: {
            'Authorization': `Bearer ${process.env.ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
          }
        }
      );
      console.log(`Enviado para ${from}: ${responseText}`);
    } catch (error) {
      console.error('Erro envio:', error.response?.data || error.message);
    }
  }

  console.log(`Resposta gerada para ${from}: ${responseText}`);
  res.sendStatus(200);
});

app.listen(process.env.PORT || 10000, () => console.log('Servidor na porta', process.env.PORT || 10000));