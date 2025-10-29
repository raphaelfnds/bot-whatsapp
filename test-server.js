// test-server.js - SOMENTE PARA TESTAR WEBHOOK
const express = require('express');
const app = express();

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

app.get('/webhook', (req, res) => {
  console.log('GET /webhook:', req.query);
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === 'meuTokenSecreto2025') {
    res.send(req.query['hub.challenge']);
  } else {
    res.sendStatus(403);
  }
});

app.listen(4000, () => {
  console.log('TEST SERVER rodando na porta 4000');
  console.log('Use ngrok: C:\\ngrok\\ngrok.exe http 4000');
});