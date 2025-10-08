const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');

const app = express();
app.use(express.json());

// Conexão MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Conectado ao MongoDB'))
  .catch(err => console.error('Erro:', err));

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
  const body = req.body;
  if (!body || !body.entry) return res.sendStatus(200);

  const entry = body.entry[0];
  if (!entry.changes || !entry.changes[0] || !entry.changes[0].value || !entry.changes[0].value.messages || !entry.changes[0].value.messages[0]) {
    console.error('Payload inválido:', body);
    return res.sendStatus(200);
  }

  const event = entry.changes[0];
  const from = event.value.messages[0].from;
  const text = event.value.messages[0].text.body;
  let responseText = '';
  let state = conversationStates[from]?.state || 'awaiting_name';
  const now = Date.now();

  // Verifica timeout de 30 minutos
  if (conversationStates[from] && now - conversationStates[from].lastMessageTime > 30 * 60 * 1000) {
    state = 'awaiting_name'; // Reset após 30 min
  }

  if (!conversationStates[from]) conversationStates[from] = {};

  conversationStates[from].lastMessageTime = now; // Atualiza timestamp

  // Reinicia fluxo se estado for 'done' ou timeout ultrapassado
  if (state === 'done' || (conversationStates[from] && now - conversationStates[from].lastMessageTime > 30 * 60 * 1000)) {
    delete conversationStates[from]; // Limpa estado após "Sair" ou timeout
    state = 'awaiting_name';
  }

  if (state === 'awaiting_name') {
    const existingUser = await User.findOne({ phone: from });
    if (existingUser && existingUser.acceptedTerms) {
      conversationStates[from] = { state: 'menu_selection', proposedName: existingUser.name, lastMessageTime: now };
      responseText = 'Sobre o que deseja falar?\n1. Agenda.\n2. Edital.\n3. Falar com atendente.\n4. Sair e encerrar o atendimento.';
    } else {
      // Novo usuário: controla fluxo em duas etapas
      if (!conversationStates[from].proposedName && !text.trim()) {
        // Primeira mensagem: solicita nome
        conversationStates[from] = { state: 'awaiting_name', lastMessageTime: now };
        responseText = 'Bem vindo ao atendimento de IA!\nPor favor, *escreva qual seu nome*.';
      } else if (!conversationStates[from].proposedName && text.trim()) {
        // Segunda mensagem: processa nome e avança para confirmação
        let cleanedName = text.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z]/g, '');
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
      delete conversationStates[from].proposedName; // Limpa nome para nova tentativa
      responseText = 'Por favor, escreva qual seu nome.';
    } else if (option === '3') {
      delete conversationStates[from]; // Limpa estado ao sair
      responseText = 'Agradecemos seu contato.';
    } else {
      responseText = `Não entendi sua resposta.\nO nome que você escreveu é ${conversationStates[from].proposedName}, correto?\n\nDigite:\n1. Para SIM.\n2. Para NAO.\n3. Para SAIR.\nObservação: Ao digitar "1. Para SIM" também estará aceitando a politica de privacidade: https://github.com/raphaelfnds/bot-whatsapp-privacidade/tree/main?tab=readme-ov-file#pol%C3%ADtica-de-privacidade---bot-whatsapp.`;
    }
  } else if (state === 'menu_selection') {
    const option = text.trim();
    if (option === '1') {
      responseText = 'Por favor, acesso o link: https://cultura.pontagrossa.pr.gov.br/agenda-cultural/';
    } else if (option === '2') {
      responseText = 'Por favor, acesso o link: https://cultura.pontagrossa.pr.gov.br/2025-2/';
    } else if (option === '3') {
      responseText = 'Por favor, clique no link para ser redirecionado: https://wa.me/554288768668';
    } else if (option === '4') {
      delete conversationStates[from]; // Limpa estado ao sair
      responseText = 'Agradecemos seu contato.';
    } else {
      responseText = 'Opção inválida.\nSobre o que deseja falar?\n1. Agenda.\n2. Edital.\n3. Falar com atendente.\n4. Sair e encerrar o atendimento.';
    }
  }

  // Enviar resposta via WhatsApp API
  if (responseText) {
    try {
      await axios.post(
        `https://graph.facebook.com/v22.0/748970534975341/messages`,
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