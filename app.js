require('dotenv').config();
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

// Webhook
app.post('/webhook', async (req, res) => {
  const body = req.body;
  if (!body || !body.entry) return res.sendStatus(200);

  const event = body.entry[0].changes[0];
  const from = event.value.messages[0].from; // Número do usuário
  const text = event.value.messages[0].text.body;
  let responseText = '';
  let state = conversationStates[from]?.state || 'awaiting_name';

  if (!conversationStates[from]) conversationStates[from] = {};

  if (state === 'awaiting_name') {
    conversationStates[from].proposedName = text.trim();
    responseText = `Nome atualizado para "${text.trim()}". Confirme com "SIM" ou envie o correto.`;
    conversationStates[from].state = 'confirming_name';
  } else if (state === 'confirming_name') {
    if (text.toUpperCase() === 'SIM') {
      await User.create({ phone: from, name: conversationStates[from].proposedName, acceptedTerms: false });
      responseText = `Nome "${conversationStates[from].proposedName}" confirmado! Ao prosseguir, você aceita nossos termos de uso e autoriza mensagens futuras sobre [seu serviço]. Responda "ACEITO" para continuar ou "STOP" para cancelar.`;
      conversationStates[from].state = 'confirming_terms';
    } else {
      conversationStates[from].proposedName = text.trim();
      responseText = `Nome atualizado para "${text.trim()}". Confirme com "SIM" ou envie o correto.`;
    }
  } else if (state === 'confirming_terms') {
    if (text.toUpperCase() === 'ACEITO') {
      await User.findOneAndUpdate({ phone: from }, { acceptedTerms: true });
      responseText = 'Obrigado por aceitar! Sobre o que quer falar? Responda: 1 - Tópico A, 2 - Tópico B, 0 - Falar com atendente.';
      conversationStates[from].state = 'menu_selection';
    } else if (text.toUpperCase() === 'STOP') {
      await User.findOneAndUpdate({ phone: from }, { acceptedTerms: false });
      responseText = 'Você cancelou o recebimento de mensagens futuras. Até logo!';
      conversationStates[from].state = 'done';
    } else {
      responseText = 'Responda "ACEITO" para continuar ou "STOP" para cancelar.';
    }
  } else if (state === 'menu_selection') {
    const option = text.trim();
    if (option === '1') {
      responseText = 'Aqui está o link para Tópico A: https://link-a.com';
      conversationStates[from].state = 'done';
    } else if (option === '2') {
      responseText = 'Aqui está o link para Tópico B: https://link-b.com';
      conversationStates[from].state = 'done';
    } else if (option === '0') {
      responseText = 'Encaminhando para atendente. Aguarde.';
      conversationStates[from].state = 'done';
    } else {
      responseText = 'Opção inválida. Responda: 1 - Tópico A, 2 - Tópico B, 0 - Falar com atendente.';
    }
  }

  // Resposta simulada (substituir por envio real via API depois)
  console.log(`Resposta para ${from}: ${responseText}`);
  res.json({ status: 'ok', message: responseText }); // Envia resposta no corpo
});

// Iniciar servidor local (para teste)
app.listen(3000, () => console.log('Servidor rodando na porta 3000'));