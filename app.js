// Carrega .env apenas em desenvolvimento (não afeta Render.com)
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config(); // Carrega .env localmente
}

const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const { InferenceClient } = require('@huggingface/inference'); // Cliente recomendado
const { Firecrawl } = require('@mendable/firecrawl-js');
const pdfParse = require('pdf-parse'); // ainda não usado, mas já importado

const app = express();
app.use(express.json());

// Conexão MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Conectado ao MongoDB'))
  .catch(err => console.error('Erro:', err));

// Inicialização de clients para IA e scraping
const hf = new InferenceClient({ token: process.env.HUGGINGFACE_TOKEN });
const firecrawl = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY });

// Schema User
const User = require('./models/User');

// Estados em memória
const conversationStates = {};

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log('Webhook Challenge:', { mode, token, challenge });

  if (mode === 'subscribe' && token === 'meuTokenSecreto2025') {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Webhook
app.post('/webhook', async (req, res) => {
  console.log('Webhook recebido:', JSON.stringify(req.body, null, 2)); // Novo: Log completo do payload para diagnóstico

  const body = req.body;
  if (!body || !body.entry) {
    console.log('Payload sem entry ou inválido'); // Novo: Log específico
    return res.sendStatus(200);
  }

  const entry = body.entry[0];
  if (!entry.changes || !entry.changes[0] || !entry.changes[0].value || !entry.changes[0].value.messages || !entry.changes[0].value.messages[0]) {
    console.error('Payload inválido (sem messages):', JSON.stringify(body, null, 2)); // Atualizado: Log mais detalhado
    return res.sendStatus(200);
  }

  const event = entry.changes[0];
  const from = event.value.messages[0].from;
  const text = event.value.messages[0].text.body;
  let responseText = '';
  let state = conversationStates[from]?.state || 'awaiting_name';
  const now = Date.now();

  // ---------- TIMEOUT ----------
  if (conversationStates[from] && now - conversationStates[from].lastMessageTime > 30 * 60 * 1000) {
    state = 'awaiting_name'; // Reset após 30 min
  }

  if (!conversationStates[from]) conversationStates[from] = {};
  conversationStates[from].lastMessageTime = now;

  // Reinicia fluxo se estado for 'done' ou timeout
  if (state === 'done' || (conversationStates[from] && now - conversationStates[from].lastMessageTime > 30 * 60 * 1000)) {
    delete conversationStates[from];
    state = 'awaiting_name';
  }

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

    // ---------- OPÇÕES QUE LEVAM A DÚVIDA ----------
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

  // ---------- ESTADO DE COLETA DA DÚVIDA ----------
  } else if (state === 'awaiting_question') {
    const question = text.trim();
    let context = '';
    const urls = [];

    // URLs de contexto (expansível via DB futuramente)
    if (conversationStates[from].topic === 'agenda') {
      urls.push('https://cultura.pontagrossa.pr.gov.br/agenda-cultural/');
    } else if (conversationStates[from].topic === 'edital') {
      urls.push('https://cultura.pontagrossa.pr.gov.br/2025-2/');
    }

    try {
      // Scraping
      for (const url of urls) {
        const scraped = await firecrawl.scrape({ url });
        context += scraped.markdown + ' ';
      }

      // IA (Hugging Face)
      const aiResponse = await hf.questionAnswering({
        model: 'deepset/roberta-base-squad2',
        inputs: { question, context }
      });

      responseText = aiResponse.answer || 'Desculpe, não consegui encontrar uma resposta clara.';
      responseText += '\n\nPodemos ajudar em mais alguma coisa?\n1. Voltar ao menu\n2. Sair';
      conversationStates[from].state = 'awaiting_help';
    } catch (error) {
    console.error('Erro na IA/Firecrawl (detalhes):', {
      message: error.message,
      stack: error.stack,
      topic: conversationStates[from].topic,
      urls: urls,
      question: question
    });
    responseText = 'Desculpe, ocorreu um erro ao processar sua dúvida. Tente novamente.';
    responseText += '\n\n1. Voltar ao menu\n2. Sair';
    conversationStates[from].state = 'awaiting_help';
  }

  // ---------- ESTADO PÓS‑RESPOSTA ----------
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

  // ---------- ENVIO DA RESPOSTA ----------
  if (responseText) {
    try {
      await axios.post(
        `https://graph.facebook.com/v24.0/${process.env.PHONE_NUMBER_ID}/messages`, // ← Corrigido
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
      console.log(`Mensagem enviada para ${from}: ${responseText}`);
    } catch (error) {
      console.error('Erro ao enviar mensagem:', {
        status: error.response?.status,
        data: error.response?.data,
        message: error.message
      });
    }
  }

  console.log(`Resposta gerada para ${from}: ${responseText}`);
  res.sendStatus(200);
});

// Iniciar servidor
app.listen(process.env.PORT || 10000, () => console.log('Servidor rodando na porta', process.env.PORT || 10000));