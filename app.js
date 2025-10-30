// app.js - ETAPA 2: Axios + Cheerio + Groq (Llama3-8B) + Quota em memória
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
  // Substitui % inválidos por %25 para evitar malformed
  str = str.replace(/%(?![0-9a-fA-F]{2})/g, '%25');
  try {
    return decodeURIComponent(str);
  } catch (e) {
    console.error('Falha ao decodificar:', str, e.message);
    return str; // Retorna original se falhar
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

  // Timeout 30 min para reset completo, e TTL 5 min para inatividade em awaiting_help
  if (conversationStates[from] && now - conversationStates[from].lastMessageTime > 30 * 60 * 1000) {
    delete conversationStates[from];
    state = 'awaiting_name';
  }
  if (!conversationStates[from]) conversationStates[from] = { lastMessageTime: now };
  conversationStates[from].lastMessageTime = now;

  // TTL extra para awaiting_help: reset se >5min inativo
  if (state === 'awaiting_help' && now - conversationStates[from].lastMessageTime > 5 * 60 * 1000) {
    state = 'menu_selection';
  }

  let response = '';

  console.log(`[DEPURAÇÃO] Estado inicial: ${state}, De: ${from}, Mensagem: "${message}"`);

  // ==================== ESTADOS ====================
  if (state === 'awaiting_name') {
    const user = await User.findOne({ phone: from });
    if (user && user.acceptedTerms) {
      conversationStates[from].state = 'menu_selection';
      conversationStates[from].proposedName = user.name;
      conversationStates[from].lastMessageTime = now;
      response = 'Sobre o que deseja falar?\n1. Agenda.\n2. Edital.\n3. Falar com atendente.\n4. Sair e encerrar o atendimento.';
    } else {
      if (!conversationStates[from].welcomed) {
        conversationStates[from].welcomed = true;
        conversationStates[from].lastMessageTime = now;
        response = 'Bem vindo ao atendimento de IA!\nPor favor, *escreva qual seu nome*.';
      } else {
        let cleanedName = message.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z]/g, '');
        cleanedName = cleanedName.charAt(0).toUpperCase() + cleanedName.slice(1).toLowerCase();
        conversationStates[from].proposedName = cleanedName || 'Usuario';
        conversationStates[from].state = 'confirming_name';
        conversationStates[from].lastMessageTime = now;
        response = `O nome que você escreveu é ${cleanedName}, correto?\n\nDigite:\n1. Para SIM.\n2. Para NAO.\n3. Para SAIR.\nObservação: Ao digitar "1. Para SIM" também estará aceitando a politica de privacidade: https://github.com/raphaelfnds/bot-whatsapp-privacidade/tree/main?tab=readme-ov-file#pol%C3%ADtica-de-privacidade---bot-whatsapp.`;
      }
    }
  } else if (state === 'confirming_name') {
    const option = message.trim();
    if (option === '1') {
      await User.create({ phone: from, name: conversationStates[from].proposedName, acceptedTerms: true });
      conversationStates[from].state = 'menu_selection';
      conversationStates[from].lastMessageTime = now;
      response = 'Sobre o que deseja falar?\n1. Agenda.\n2. Edital.\n3. Falar com atendente.\n4. Sair e encerrar o atendimento.';
    } else if (option === '2') {
      conversationStates[from].state = 'awaiting_name';
      delete conversationStates[from].proposedName;
      conversationStates[from].lastMessageTime = now;
      response = 'Por favor, escreva qual seu nome.';
    } else if (option === '3') {
      delete conversationStates[from];
      response = 'Agradecemos seu contato.';
    } else {
      response = `Não entendi sua resposta.\nO nome que você escreveu é ${conversationStates[from].proposedName}, correto?\n\nDigite:\n1. Para SIM.\n2. Para NAO.\n3. Para SAIR.\nObservação: Ao digitar "1. Para SIM" também estará aceitando a politica de privacidade: https://github.com/raphaelfnds/bot-whatsapp-privacidade/tree/main?tab=readme-ov-file#pol%C3%ADtica-de-privacidade---bot-whatsapp.`;
    }
  } else if (state === 'menu_selection') {
    const option = message.trim();
    if (option === '1') {
      conversationStates[from].state = 'agenda_help';
      conversationStates[from].lastMessageTime = now;
      response = 'Qual sua dúvida sobre a agenda?\n\nVocê também pode acessar mais detalhes através do link: https://cultura.pontagrossa.pr.gov.br/agenda-cultural/';
    } else if (option === '2') {
      const editais = await Edital.find();
      let editaisList = 'Editais disponíveis:\n';
      editais.forEach((edital, index) => {
        editaisList += `${index + 1}. ${edital.nome}\nLink: ${edital.link_principal}\n\n`;
      });
      conversationStates[from].state = 'edital_selection';
      conversationStates[from].lastMessageTime = now;
      response = editaisList + 'Digite o número do edital para mais detalhes.';
    } else if (option === '3') {
      delete conversationStates[from];
      response = 'Por favor, clique no link para ser redirecionado: https://wa.me/554288768668';
    } else if (option === '4') {
      delete conversationStates[from];
      response = 'Agradecemos seu contato.';
    } else {
      response = 'Opção inválida.\nSobre o que deseja falar?\n1. Agenda.\n2. Edital.\n3. Falar com atendente.\n4. Sair e encerrar o atendimento.';
    }
  } else if (state === 'edital_selection') {
    const editais = await Edital.find();
    const index = parseInt(message.trim()) - 1;
    if (index >= 0 && index < editais.length) {
      const selectedEdital = editais[index];
      conversationStates[from].selectedEdital = selectedEdital;
      conversationStates[from].state = 'edital_help';
      conversationStates[from].lastMessageTime = now;
      response = `Edital selecionado: ${selectedEdital.nome}\nLink PDF: ${selectedEdital.link_pdf || 'Não disponível'}\n\nQual sua dúvida sobre este edital?`;
    } else {
      response = 'Número inválido. Tente novamente ou digite 4 para sair.';
    }
  } else if (state === 'agenda_help' || state === 'edital_help') {
    conversationStates[from].state = 'awaiting_help';
    conversationStates[from].lastMessageTime = now;

    try {
      let url, pdfUrl = '';
      if (state === 'agenda_help') {
        url = 'https://cultura.pontagrossa.pr.gov.br/agenda-cultural/';
      } else {
        url = conversationStates[from].selectedEdital.link_principal;
        pdfUrl = conversationStates[from].selectedEdital.link_pdf || '';
      }

      let data, pdfText = '', relevantText = '';
      const cacheKey = url;
      const cached = scrapeCache.get(cacheKey);

      if (cached && Date.now() - cached.timestamp < SCRAPE_CACHE_TTL) {
        data = cached.html;
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
            console.log('[DEPURAÇÃO] Scraping bem-sucedido na tentativa ' + (attempts + 1));
            break;
          } catch (err) {
            attempts++;
            console.error(`[DEPURAÇÃO] Tentativa ${attempts}/${maxAttempts} falhou para ${url}:`, err.code || err.message);
            if (attempts >= maxAttempts) throw err;
            await new Promise(r => setTimeout(r, 2000 * attempts));
          }
        }
      }

      const $ = cheerio.load(data);
      $('script, style').remove(); // Remover tags irrelevantes para otimizar
      let context = $('body').text().replace(/\s+/g, ' ').trim().substring(0, 8000); // Reduzido para 8000 chars

      if (pdfUrl) {
        try {
          const pdfBuffer = (await axios.get(pdfUrl, { responseType: 'arraybuffer' })).data;
          const pdfParser = new PDFParser();
          pdfText = await new Promise((resolve, reject) => {
            pdfParser.on('pdfParser_dataError', err => reject(err));
            pdfParser.on('pdfParser_dataReady', (pdfData) => {
              let text = '';
              try {
                pdfData.Pages.forEach(page => {
                  page.Texts.forEach(textItem => {
                    if (textItem.R && textItem.R[0] && textItem.R[0].T) {
                      let decoded = safeDecodeURI(textItem.R[0].T);
                      text += decoded.replace(/[^\x00-\x7F]/g, '') + ' '; // Sanitização
                    }
                  });
                });
                resolve(text.trim().substring(0, 2000)); // Reduzido para 2000 chars
              } catch (e) {
                reject(e);
              }
            });
            pdfParser.parseBuffer(pdfBuffer);
          });
        } catch (err) {
          console.error('PDF extração falhou:', err.message);
          pdfText = ''; // Fallback para scraping puro
        }
      }

      // Extrair trechos relevantes (busca %LIKE%)
      const keywords = message.toLowerCase().split(' ').map(word => new RegExp(word, 'i'));
      relevantText = context.split(' ').filter(word => keywords.some(regex => regex.test(word))).join(' ').substring(0, 1000);

      context += pdfText ? `\n\nConteúdo extraído do PDF: ${pdfText}` : '';
      context += relevantText ? `\n\nTrechos relevantes: ${relevantText}` : '';
      console.log('[DEPURAÇÃO] Contexto gerado. Tamanho: ' + context.length);

      resetQuotaIfNeeded();
      console.log('[DEPURAÇÃO] Chamadas diárias atuais: ' + dailyCalls);
      if (dailyCalls >= DAILY_QUOTA) {
        response = 'Limite diário de consultas à IA atingido. Acesse diretamente o site.\n\n1. Voltar ao menu\n2. Sair';
      } else {
        let aiResult = '';
        try {
          const completion = await groq.chat.completions.create({
            model: 'llama-3.1-8b-instant',
            messages: [
              {
                role: 'system',
                content: 'Você é um assistente da Secretaria de Cultura de Ponta Grossa. Responda em português, claro e objetivo (máx 150 palavras). Use apenas o contexto. Considere termos aproximados, sinônimos e contextos semelhantes (busca fuzzy ou %LIKE%) para responder. Ex: "vagas" inclui "oportunidades" ou "posições". Se não souber, diga: "Não encontrei informações sobre isso."\n\nContexto: ' + context.substring(0, 10000) // Reduzido total
              },
              {
                role: 'user',
                content: message
              }
            ],
            max_tokens: 200, // Aumentado para evitar cortes
            temperature: 0.7
          });

          if (completion.choices && completion.choices[0] && completion.choices[0].message.content) {
            aiResult = completion.choices[0].message.content.trim();
            console.log('[DEPURAÇÃO] Resultado da IA gerado. Tamanho: ' + aiResult.length);
          } else {
            console.log('[DEPURAÇÃO] Choices da IA vazio ou inválido.');
            aiResult = 'Não encontrei informações sobre isso.';
          }

          dailyCalls++;
          response = aiResult + '\n\n1. Voltar ao menu\n2. Sair';

        } catch (err) {
          console.error('Groq erro:', err.message);
          response = 'Desculpe, não consegui processar sua dúvida agora. Tente novamente.\n\n1. Voltar ao menu\n2. Sair';
        }
      }
    } catch (err) {
      console.error('Erro scraping/IA:', err.message);
      response = 'Desculpe, não consegui acessar o site agora. Tente novamente.\n\n1. Voltar ao menu\n2. Sair';
    }
  } else if (state === 'awaiting_help') {
    const option = message.trim();
    if (option === '1') {
      conversationStates[from].state = 'menu_selection';
      response = 'Sobre o que deseja falar?\n1. Agenda.\n2. Edital.\n3. Falar com atendente.\n4. Sair e encerrar o atendimento.';
    } else if (option === '2') {
      delete conversationStates[from];
      response = 'Agradecemos seu contato.';
    } else {
      // Validação para evitar "vácuo": reset se inválido
      conversationStates[from].state = 'menu_selection';
      response = 'Opção inválida. Voltando ao menu.\nSobre o que deseja falar?\n1. Agenda.\n2. Edital.\n3. Falar com atendente.\n4. Sair e encerrar o atendimento.';
    }
  }

  if (!response) {
    console.log('[DEPURAÇÃO] Resposta não gerada; definindo fallback.');
    response = 'Desculpe, erro interno. Tente novamente.\n\n1. Voltar ao menu\n2. Sair';
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