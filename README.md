Atualização da Documentação do Projeto Bot WhatsApp - Etapa 1
Data de Atualização: 08/10/2025, 17:30 PM -03
Autor: Raphael Fernandes (Engenharia de Software - Bacharelado, Projeto de Extensão I)
Objetivo Geral: Desenvolver um bot SaaS utilizando a WhatsApp Cloud API para difusão cultural, coletando nome, confirmando termos de uso, enviando links fixos (Etapa 1), com escalabilidade para respostas de IA (Etapa 2), alinhado às ODS 4.7 (educação sustentável), 9.c (inclusão digital), 11.4 (preservação patrimonial) e 17.16 (parcerias globais).

Tecnologias Utilizadas

Linguagem e Frameworks: Node.js (v22.16.0), Express (v5.1.0)
Bibliotecas: Axios (v1.12.2), Dotenv (v17.2.2), Mongoose (v8.18.2)
Banco de Dados: MongoDB Atlas (free tier, 512MB)
Hospedagem: Render.com (free tier, 750h/mês)
API: WhatsApp Cloud API (gratuita até 1.000 conv/mês)
Controle de Versão: Git, GitHub (repositório privado https://github.com/raphaelfnds/bot-whatsapp)


Escopo do Projeto
Escopo Abstrato
O bot facilita a difusão cultural, coletando dados de usuários (nome, número), confirmando termos de uso (opt-in), e enviando links fixos sobre editais e agendas culturais. Alinha-se à educação sustentável, inclusão digital, preservação do patrimônio e parcerias globais, promovendo acesso a informações culturais via WhatsApp.
Escopo Técnico

Fluxo: Estados em memória (conversationStates): awaiting_name > confirming_name > confirming_terms > menu_selection > done.
Schema User: { phone: String, name: String, acceptedTerms: { type: Boolean, default: false } }.
Webhook: POST /webhook processa mensagens, salva dados no MongoDB, responde com links fixos.
Etapa 1 Deliverables: Código app.js atualizado, webhook configurado, MongoDB com schema, testes manuais concluídos.
Restrições: Custos zero (tiers gratuitos), compliance WhatsApp (opt-in), portas liberadas com 0.0.0.0/0.


Histórico do Desenvolvimento (Etapa 1)

Ambiente Local (Passo 1):

Instalação: Node.js (v22.14.0), npm (v11.1.0).
Projeto: npm init -y, dependências (express, axios, dotenv, mongoose).
Arquivos: app.js, .env, models/User.js.


MongoDB Atlas (Passo 2):

Conta criada, cluster free tier, database whatsapp-users, coleção users.
URI: mongodb+srv://raphaelfnds_db_user:06g6Rhyc5IqZ40X8@cluster0.y2xouwl.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0.
Liberação de IP: 0.0.0.0/0 por tempo indeterminado para suportar IPs dinâmicos do Render.


WhatsApp Cloud API (Passo 3):

Conta desenvolvedor verificada, empresa "Raphael Softvibe" (ID 535152456358299) aprovada.
App "bot-wtspp" criado, número +55 (42) 98839-3375 reativado após exclusão acidental.
Necessário criar um usuário específico na API Cloud Meta (System User ID: 61581462885723) com função "Admin" e token permanente para acesso às permissões whatsapp_business_messaging e whatsapp_business_management.


Código app.js (Passo 4):

Fluxo implementado: coleta nome, confirmação de termos, menu (links fixos).
Ajustes: Handler GET para validação do webhook, envio de respostas via API Cloud.
Testes locais via Postman OK.


Servidor no Render (Passo 5):

Web Service bot-whatsapp-oy4p criado, URL https://bot-whatsapp-oy4p.onrender.com.
Deploy inicial com node app.js, conexão MongoDB após liberação de IP.
Webhook configurado: https://bot-whatsapp-oy4p.onrender.com/webhook, token meuTokenSecreto2025.
Testes via Meta painel OK, respostas geradas.


GitHub (Versionamento):

Repositório https://github.com/raphaelfnds/bot-whatsapp criado.
.env removido, .gitignore configurado (.env, node_modules).
Política de privacidade em https://github.com/raphaelfnds/bot-whatsapp-privacidade/blob/main/PRIVACY.md.


Testes Manuais Completos (Passo 6):

Testes realizados com sucesso em 08/10/2025:

Fluxo completo: Envio de "Olá" de outro número para +55 (42) 98839-3375, respostas "João" > "SIM" > "SIM" > "1" > "SIM" > "SAIR", com salvamento no MongoDB Atlas.
Cancelamento: Envio de "SAIR" em qualquer estado, confirmando saída com "Agradecemos seu contato."


Verificação: Dados salvos em whatsapp-users.users (ex: { phone: '554288768668', name: 'João', acceptedTerms: true }).




Tarefas Pendentes
Etapa 2 (Pendente)

Integração com IA (Hugging Face) para respostas dinâmicas, a ser iniciada após Etapa 1.


Observações

Portas Render: Dinâmicas (ex: 10000), mas URL pública é fixa. 0.0.0.0/0 suporta IPs dinâmicos; ajuste para ranges específicos (ex: 74.220.48.0/24) em produção.
Segurança: Token permanente gerado; monitorar expiração ou revogação.
Políticas WhatsApp: Links informativos (Google Calendar, GitHub) permitidos com opt-in; política de privacidade alinhada.
Próximos Documentos: Atualizar PDCA e relatório final após Etapa 2.
