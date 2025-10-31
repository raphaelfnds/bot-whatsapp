module.exports = {
  async handle(from, message, states, deps) {
    const { axios, groq, PDFParser, safeDecodeURI, resetQuotaIfNeeded, dailyCalls, DAILY_QUOTA, Edital } = deps;
    const state = states[from].state;
    let response = '';
    let newState = state;
    let updatedDailyCalls = dailyCalls;

    if (state === 'edital_selection') {
      const editais = await Edital.find();
      const index = parseInt(message.trim()) - 1;
      if (index >= 0 && index < editais.length) {
        const selectedEdital = editais[index];
        states[from].selectedEdital = selectedEdital;
        newState = 'edital_help';
        response = `Edital selecionado: ${selectedEdital.nome}\nLink PDF: ${selectedEdital.link_pdf || 'Não disponível'}\n\nEm poucas palavras escreva qual sua dúvida sobre este edital?`;
      } else {
        response = 'Opção Inválida! Por favor digite apenas o número relacionado ao edital que deseja saber mais.';
      }
    } else if (state === 'edital_help') {
      newState = 'awaiting_help';
      try {
        const pdfUrl = states[from].selectedEdital.link_pdf || '';
        let pdfText = '', relevantText = '';
        let context = '';

        if (pdfUrl) {
          try {
            let attempts = 0;
            const maxAttempts = 3;
            let pdfBuffer;
            while (attempts < maxAttempts) {
              try {
                const resp = await axios.get(pdfUrl, {
                  responseType: 'arraybuffer',
                  timeout: 30000,
                  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' }
                });
                pdfBuffer = resp.data;
                console.log('[DEPURAÇÃO PDF] Download bem-sucedido na tentativa ' + (attempts + 1));
                break;
              } catch (err) {
                attempts++;
                console.error(`[DEPURAÇÃO PDF] Tentativa ${attempts}/${maxAttempts} falhou para ${pdfUrl}:`, err.code || err.message);
                if (attempts >= maxAttempts) throw err;
                await new Promise(r => setTimeout(r, 2000 * attempts));
              }
            }

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
                        text += decoded.replace(/[^\x00-\x7F]/g, '') + ' ';
                      }
                    });
                  });
                  let normalizedText = text.trim().split(' ').filter(word => word.trim()).join(' ').replace(/(\b\w\s+)+/g, match => match.replace(/\s+/g, '') + ' ');
                  resolve(normalizedText.substring(0, 18000));
                } catch (e) {
                  reject(e);
                }
              });
              pdfParser.parseBuffer(pdfBuffer);
            });
            console.log('[DEPURAÇÃO PDF] Texto extraído do PDF:', pdfText);
          } catch (err) {
            console.error('PDF extração falhou:', err.message);
            pdfText = '';
          }
        }

        const keywords = message.toLowerCase().split(' ').map(word => new RegExp(word, 'i'));
        relevantText = pdfText.split(' ').filter(word => keywords.some(regex => regex.test(word))).join(' ').substring(0, 1000);

        context += pdfText ? `\n\nConteúdo extraído do PDF: ${pdfText}` : '';
        context += relevantText ? `\n\nTrechos relevantes: ${relevantText}` : '';
        console.log('[DEPURAÇÃO] Contexto gerado. Tamanho: ' + context.length);

        resetQuotaIfNeeded();
        console.log('[DEPURAÇÃO] Chamadas diárias atuais: ' + dailyCalls);
        if (dailyCalls >= DAILY_QUOTA) {
          response = 'Limite diário de consultas à IA atingido. Acesse diretamente o edital.\n\n1. Voltar ao menu\n2. Sair';
        } else {
          let aiResult = '';
          try {
            let systemContent = 'Você é um assistente da Secretaria de Cultura de Ponta Grossa. Responda em português, claro e objetivo (máx 500 palavras). Use apenas o contexto. Considere termos aproximados, sinônimos e contextos semelhantes (busca fuzzy ou %LIKE%) para responder. Ex: "vagas" inclui "oportunidades" ou "posições". Se não souber, diga: "Não encontrei informações sobre isso."\n\nContexto: ' + context.substring(0, 14000);
            const approxTokens = Math.ceil(systemContent.length / 4) + systemContent.split(/\s+/).length;
            console.log('[DEPURAÇÃO] Tokens aproximados: ' + approxTokens);
            if (approxTokens > 5000) {
              systemContent = systemContent.substring(0, Math.floor(5000 * 4));
              console.log('[DEPURAÇÃO] Contexto truncado para evitar limite: ' + systemContent.length);
            }
            console.log('[DEPURAÇÃO SYSTEM CONTENT] Conteúdo completo enviado para IA:', systemContent.substring(0, 200) + '...');

            const completion = await groq.chat.completions.create({
              model: 'llama-3.1-8b-instant',
              messages: [{ role: 'system', content: systemContent }, { role: 'user', content: message }],
              max_tokens: 1000,
              temperature: 0.7
            });

            if (completion.choices && completion.choices[0] && completion.choices[0].message.content) {
              aiResult = completion.choices[0].message.content.trim();
              console.log('[DEPURAÇÃO] Resultado da IA gerado. Tamanho: ' + aiResult.length);
            } else {
              console.log('[DEPURAÇÃO] Choices da IA vazio ou inválido.');
              aiResult = 'Não encontrei informações sobre isso.';
            }

            updatedDailyCalls++;
            response = aiResult + '\n\n1. Voltar ao menu\n2. Sair';

          } catch (err) {
            console.error('Groq erro:', err.message);
            response = 'Desculpe, não consegui processar sua dúvida agora. Tente novamente.\n\n1. Voltar ao menu\n2. Sair';
          }
        }
      } catch (err) {
        console.error('Erro PDF/IA:', err.message);
        response = 'Desculpe, não consegui acessar o PDF agora devido a um timeout. Tente novamente mais tarde.\n\n1. Voltar ao menu\n2. Sair';
      }
    }

    return { response, newState, dailyCalls: updatedDailyCalls };
  }
};