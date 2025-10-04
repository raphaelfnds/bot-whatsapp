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

  if (!conversationStates[from]) conversationStates[from] = {};

  // Nova regra: Início com "Olá" ou qualquer texto
  if (state === 'awaiting_name') {
    let cleanedName = text.trim().replace(/[^a-zA-Z]/g, ''); // Remove caracteres especiais
    cleanedName = cleanedName.charAt(0).toUpperCase() + cleanedName.slice(1).toLowerCase(); // Primeira maiúscula
    conversationStates[from].proposedName = cleanedName || 'Usuário'; // Fallback se vazio
    responseText = `Bem-vindo ao atendimento de IA! O nome que você escreveu é ${cleanedName}, correto? Digite SIM para confirmar, NAO para corrigir ou SAIR para encerrar o atendimento.`;
    conversationStates[from].state = 'confirming_name';
  } else if (state === 'confirming_name') {
    if (text.toUpperCase() === 'SIM') {
      await User.create({ phone: from, name: conversationStates[from].proposedName, acceptedTerms: false });
      responseText = `Link para política de privacidade: https://github.com/raphaelfnds/bot-whatsapp-privacidade/blob/main/PRIVACY.md\nVocê concorda com as políticas de privacidade? Digite SIM para confirmar, NAO para recusar e sair.`;
      conversationStates[from].state = 'confirming_terms';
    } else if (text.toUpperCase() === 'NAO') {
      responseText = 'Por favor, escreva como gostaria de ser chamado.';
      conversationStates[from].state = 'awaiting_name'; // Loop
    } else if (text.toUpperCase() === 'SAIR') {
      responseText = 'Agradecemos seu contato.';
      conversationStates[from].state = 'done';
    } else {
      responseText = 'Opção inválida. Digite SIM para confirmar, NAO para corrigir ou SAIR para encerrar.';
    }
  } else if (state === 'confirming_terms') {
    if (text.toUpperCase() === 'SIM') {
      await User.findOneAndUpdate({ phone: from }, { acceptedTerms: true });
      responseText = 'Digite o número do item ao qual deseja falar:\n1. Agenda.\n2. Assunto X.\n3. Falar com atendente.\n4. Sair e encerrar o atendimento.';
      conversationStates[from].state = 'menu_selection';
    } else if (text.toUpperCase() === 'NAO') {
      responseText = 'Agradecemos seu contato.';
      conversationStates[from].state = 'done';
    } else {
      responseText = 'Responda SIM para confirmar ou NAO para recusar.';
    }
  } else if (state === 'menu_selection') {
    const option = text.trim();
    let helpMore = '\nPodemos ajudar em mais alguma coisa? Digite SIM para voltar ao menu anterior ou SAIR para encerrar.';
    if (option === '1') {
      responseText = 'Segue link para visualizar: https://calendar.google.com/calendar/u/0/r?pli=1' + helpMore;
    } else if (option === '2') {
      responseText = 'Segue link para visualizar: https://github.com/raphaelfnds?tab=repositories' + helpMore;
    } else if (option === '3') {
      responseText = 'Certo, por favor clique no link para ser encaminhado: https://wa.me/554288768668' + helpMore;
    } else if (option === '4') {
      responseText = 'Agradecemos seu contato.';
      conversationStates[from].state = 'done';
    } else if (text.toUpperCase() === 'SIM') {
      responseText = 'Digite o número do item ao qual deseja falar:\n1. Agenda.\n2. Assunto X.\n3. Falar com atendente.\n4. Sair e encerrar o atendimento.';
    } else if (text.toUpperCase() === 'SAIR') {
      responseText = 'Agradecemos seu contato.';
      conversationStates[from].state = 'done';
    } else {
      responseText = 'Opção inválida. Digite o número do item ou SIM/SAIR.';
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