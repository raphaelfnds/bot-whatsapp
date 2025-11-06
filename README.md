Atualização da Documentação do Projeto Bot WhatsApp - Etapas 1 e 2

Data de Atualização: 06/11/2025, 17:00 PM -03

Autor: Raphael Fernandes (Engenharia de Software - Bacharelado, Projeto de Extensão I)

Objetivo Geral: Desenvolver um bot SaaS utilizando a WhatsApp Cloud API para difusão cultural, coletando nome e número de usuários, confirmando termos de uso (opt-in) e enviando links fixos sobre agendas e editais culturais (Etapa 1), com evolução para respostas dinâmicas via scraping e IA (Etapa 2), alinhado às ODS 4.7 (educação sustentável), 9.c (inclusão digital), 11.4 (preservação patrimonial) e 17.16 (parcerias globais).

Tecnologias Utilizadas
Linguagem e Frameworks: Node.js (v20.x), Express (v5.1.0)
Bibliotecas: Axios (v1.13.1), Cheerio (v1.1.2), Dotenv (v17.2.3), Mongoose (v8.19.2), Groq-sdk (v0.34.0), PDF2json (v4.0.0), AWS-Serverless-Express (v3.4.0)
Banco de Dados: MongoDB Atlas (free tier M0, 512MB)
Hospedagem: AWS Lambda (free tier, runtime Node.js 20.x, memória 1024 MB, timeout 120s) com API Gateway (REST regional, integração Lambda Proxy)
API: WhatsApp Cloud API (gratuita até 1.000 conv/mês)
IA: Groq com modelo Llama-3.1-8B-Instant (quota diária implementada)
Controle de Versão: Git, GitHub (repositório privado https://github.com/raphaelfnds/bot-whatsapp)

Escopo do Projeto

Escopo Abstrato
O bot facilita a difusão cultural, coletando dados de usuários (nome, número), confirmando termos de uso (opt-in), e enviando informações sobre editais e agendas culturais. Na Etapa 1, usa links fixos; na Etapa 2, integra scraping e IA para respostas dinâmicas. Alinha-se à educação sustentável, inclusão digital, preservação do patrimônio e parcerias globais, promovendo acesso a informações culturais via WhatsApp.

Escopo Técnico
1. Fluxo Geral: Estados em memória (conversationStates): awaiting_name > confirming_name > menu_selection > agenda_help / edital_selection / edital_help / awaiting_help Processa mensagens idempotentes via wamid cache (TTL 10min). Reset de estados por inatividade (10min) ou saída explícita.
2. Schema User: { phone: String (único), name: String, acceptedTerms: { type: Boolean, default: false } }.
3. Schema Edital: { nome: String, link_principal: String, link_pdf: String } (para seleção dinâmica de editais).
4. Webhook: GET /webhook valida assinatura Meta; POST /webhook processa mensagens, salva dados no MongoDB, responde via API Cloud.
5. Etapa 1 Deliverables: Código app.js com fluxo básico, webhook configurado, MongoDB com schemas, testes manuais concluídos (coleta nome, opt-in, menu com links fixos).
6. Etapa 2 Implementações: Scraping com Axios+Cheerio (agenda cultural) e PDF2json (editais); IA via Groq (Llama-3.1-8B, max_tokens 1000, temperature 0.7) para respostas contextuais; quota diária (200 calls, reset diário); cache TTL para scraping (5min) e PDF (relevantText fuzzy); handlers modulares (nameHandler, menuHandler, agendaHandler, editalHandler, etc.); resolução de timeouts via conexão DB reutilizável (global conn).
7. Restrições: Custos zero (tiers gratuitos de MongoDB Atlas, AWS Lambda/Gateway, Groq, WhatsApp API); compliance WhatsApp (opt-in explícito, privacidade em GitHub); escalabilidade (estados/cache em memória, quota IA); segurança (IP 0.0.0.0/0 temporário, token permanente Meta); não gerar vínculos empregatícios.

Histórico do Desenvolvimento

Etapa 1 (Concluída)

. Ambiente Local (Passo 1): Instalação Node.js (v20.x), npm. Projeto inicializado com dependências básicas (express, axios, dotenv, mongoose). Arquivos: app.js, .env, models/User.js.
. MongoDB Atlas (Passo 2): Cluster free tier criado, database whatsapp-users, coleção users. URI configurada. Liberação de IP: 0.0.0.0/0 para suportar IPs dinâmicos.
. WhatsApp Cloud API (Passo 3): Conta verificada, app "bot-wtspp" criado, número +55 (42) 98839-3375. System User Admin com token permanente para permissões whatsapp_business_messaging/management.
. Código app.js (Passo 4): Fluxo implementado para coleta nome/opt-in, menu com links fixos. Handler GET/POST para webhook, envio respostas via API Cloud. Testes locais via Postman OK.
. Hospedagem Inicial (Passo 5): Tentativas em Render.com e Vercel com timeouts em cold starts e ETIMEDOUT em MongoDB/scraping (latência EUA-Brasil). Migração para AWS sa-east-1: Lambda criada do zero (handler app.handler via aws-serverless-express), API Gateway REST regional (recurso /webhook, ANY method, proxy). URL: https://[id].execute-api.sa-east-1.amazonaws.com/default/webhook. Webhook configurado no Meta, testes OK.
. GitHub (Versionamento): Repositório criado. .env removido, .gitignore configurado. Política de privacidade em https://github.com/raphaelfnds/bot-whatsapp-privacidade/blob/main/PRIVACY.md.
. Testes Manuais (Passo 6): Fluxo completo testado: "Olá" > nome > confirmação > menu > links > sair. Dados salvos no MongoDB. Cancelamento via "SAIR" OK.

Etapa 2 (Concluída)

. Integração Scraping e IA (Passo 1): Adicionadas bibliotecas cheerio, pdf2json, groq-sdk. Handlers para agenda_help (scraping https://cultura.pontagrossa.pr.gov.br/agenda-cultural/) e edital_help (seleção editais via schema Edital, parsing PDF). IA com Groq: system prompt contextualizado, user message processada, respostas limitadas a 500 palavras. Quota diária (200 calls) em memória com reset.
Cache e Otimizações (Passo 2): scrapeCache (TTL 5min) para evitar requests repetidos; processedWamids (TTL 10min) para idempotência; safeDecodeURI para PDF. Retries em Axios (3 tentativas, backoff) para timeouts.
. Resolução de Problemas (Passo 3): Timeouts em cold starts resolvidos via conexão DB reutilizável (global conn, serverSelectionTimeoutMS 5000). Migração de Render/Vercel para AWS: handler wrap com aws-serverless-express, context.callbackWaitsForEmptyEventLoop = false. Logs granulares para depuração.
. Testes Manuais (Passo 4): Fluxo Etapa 2 testado: seleção edital > dúvida via IA > resposta contextual (ex: "agenda completa de dezembro" via scraping + Groq). Quota e cache validados. Erros como ECONNABORTED isolados em Render, estabilidade confirmada na AWS.
. Encerramento Etapa 2: Projeto funcional na AWS, com scraping/IA escaláveis. Sem pendências técnicas; foco em relatório final e carta de apresentação.

Observações

Portas e Segurança: AWS usa portas dinâmicas; IP 0.0.0.0/0. Token Meta permanente monitorado.
Políticas WhatsApp: Opt-in explícito, privacidade alinhada. Links/IA informativos permitidos.
Próximos Documentos: PDCA atualizado, relatório final com evidências, carta de apresentação para Secretaria de Cultura de Ponta Grossa-PR.