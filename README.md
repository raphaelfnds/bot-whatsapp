# Bot WhatsApp - Projeto de Extensão Universitária

**Descrição breve:** Bot SaaS via WhatsApp Cloud API para difusão cultural na Secretaria de Cultura de Ponta Grossa-PR. Coleta nome/número com opt-in de privacidade, envia links fixos (Etapa 1) e respostas dinâmicas via scraping/IA (Etapa 2). Alinha-se às ODS 4.7, 9.c, 11.4 e 17.16. Zero custos, compliance WhatsApp, sem obrigações empregatícias.

**Data de Atualização:** 06/11/2025  
**Autor:** Raphael Fernandes (Engenharia de Software - Bacharelado, Projeto de Extensão I)

## Tecnologias Utilizadas
- **Linguagem e Frameworks:** Node.js (v20.x), Express (v5.1.0).

- **Bibliotecas:** Axios (v1.13.1), Cheerio (v1.1.2), Dotenv (v17.2.3), Mongoose (v8.19.2), Groq-sdk (v0.34.0), PDF2json (v4.0.0), AWS-Serverless-Express (v3.4.0).

- **Banco de Dados:** MongoDB Atlas (free tier M0, 512MB, URI com retryWrites=true e w=majority).

- **Hospedagem:** AWS Lambda (free tier, runtime Node.js 20.x, memória 1024 MB, timeout 120s, handler wrap via aws-serverless-express) integrada a API Gateway (REST regional, proxy, timeout 29s).

- **API:** WhatsApp Cloud API (gratuita até 1.000 conv/mês, token permanente para whatsapp_business_messaging/management).

- **IA:** Groq com modelo Llama-3.1-8B-Instant (quota diária de 200 calls, max_tokens 1000, temperature 0.7).

- **Controle de Versão:** Git, GitHub (repositório privado: https://github.com/raphaelfnds/bot-whatsapp).

## Instalação
1. Clone o repositório: `git clone https://github.com/raphaelfnds/bot-whatsapp.git`.
2. Instale dependências: `npm install`.
3. Configure variáveis em `.env` (exemplo: MONGODB_URI, GROQ_API_KEY, PHONE_NUMBER_ID, ACCESS_TOKEN).
4. Rode localmente: `node app.js` (porta 1000 padrão).

**Requisitos:** Node.js v20.x, MongoDB Atlas free tier, contas em WhatsApp Developers e Groq.

## Uso
- **Webhook:** Configure no Meta Developers: GET/POST para `/webhook` com token `meuTokenSecreto2025`.
- **Fluxo de Conversa:** Inicie com "Olá" no WhatsApp para o número configurado. Estados: awaiting_name (coleta nome), confirming_name (confirma), menu_selection (opções: Agenda, Edital, Atendente, Sair).

- **Exemplo Etapa 1:** Envie "1" para agenda > recebe link fixo.

- **Exemplo Etapa 2:** Envie dúvida sobre agenda/edital > scraping + IA Groq responde (quota limitada).

Exemplo de código para handler POST:
```javascript
app.post('/webhook', async (req, res) => {
  await connectDB();
  // Processamento de mensagem...
  res.sendStatus(200);
});
```

## Escopo do Projeto

### Escopo Abstrato
Facilita difusão cultural, com opt-in de privacidade e respostas informativas. Etapa 1: links fixos; Etapa 2: scraping e IA para dinamicidade.

### Escopo Técnico
- **Fluxo:** Estados em memória (`conversationStates`): awaiting_name > confirming_name > menu_selection > agenda_help / edital_selection / edital_help / awaiting_help. Idempotência via cache wamid (TTL 10min). Reset por inatividade ou "SAIR".

- **Schemas:** User `{ phone: String (único), name: String, acceptedTerms: Boolean }`; Edital `{ nome: String, link_principal: String, link_pdf: String }`.

- **Webhook:** GET valida Meta; POST processa, salva DB, responde via API.

- **Etapa 2:** Scraping Axios+Cheerio (agenda site), PDF2json (editais); IA Groq (prompt contextual); quota diária; caches TTL; retries Axios; safeDecodeURI.

- **Restrições:** Zero custos; compliance (opt-in, privacidade em https://github.com/raphaelfnds/bot-whatsapp-privacidade/blob/main/PRIVACY.md); escalabilidade; segurança (IP 0.0.0.0/0 temporário).


## Histórico do Desenvolvimento

### Etapa 1 (Concluída)
- Ambiente Local: Instalação Node.js, dependências iniciais.
- MongoDB Atlas: Cluster free, IP liberado.
- WhatsApp API: App criado, token permanente.
- Código: Fluxo básico, testes Postman.
- Hospedagem: Migração para AWS após falhas Render/Vercel.
- GitHub: Repositório configurado.
- Testes: Fluxo completo validado.

### Etapa 2 (Concluída)
- Integração: Scraping/IA com Groq (substituindo Hugging Face).
- Otimizações: Caches, retries, conexão DB reutilizável.
- Resolução: Timeouts cold starts fixados na AWS.
- Testes: Fluxo dinâmico validado; estabilidade confirmada.
- Encerramento: Funcional na AWS; foco em relatório.

## Contribuição
Contribuições bem-vindas via pull requests. Abra issues para discussões. Rode testes localmente antes de submeter.

## Licença
ISC (ver package.json).

## Observações
- **Segurança:** Token Meta monitorado; IP temporário.
- **Políticas:** Opt-in explícito; conteúdo informativo.
- **Próximos Passos:** PDCA, relatório final, carta para Secretaria de Cultura de Ponta Grossa-PR.