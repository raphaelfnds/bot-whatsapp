module.exports = {
  async handle(from, message, states, deps) {
    const { axios, cheerio, groq, PDFParser, safeDecodeURI, scrapeCache, SCRAPE_CACHE_TTL, resetQuotaIfNeeded, dailyCalls, DAILY_QUOTA } = deps;
    let response = '';
    let newState = 'awaiting_help';
    let updatedDailyCalls = dailyCalls;

    try {
      const url = 'https://cultura.pontagrossa.pr.gov.br/agenda-cultural/';
      let data;
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
              headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'pt-BR,pt;q=0.9', 'Connection': 'keep-alive' }
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
      $('script, style').remove();
      let context = $('body').text().replace(/\s+/g, ' ').trim().substring(0, 50000); // Contexto maior para agenda

      console.log('[DEPURAÇÃO] Contexto gerado. Tamanho: ' + context.length);

      resetQuotaIfNeeded();
      console.log('[DEPURAÇÃO] Chamadas diárias atuais: ' + dailyCalls);
      if (dailyCalls >= DAILY_QUOTA) {
        response = 'Limite diário de consultas à IA atingido. Acesse diretamente o site.\n\n1. Voltar ao menu\n2. Sair';
      } else {
        let aiResult = '';
        try {
          const systemContent = 'Você é um assistente da Secretaria de Cultura de Ponta Grossa. Responda em português, de forma clara e objetiva (máx 500 palavras). Use apenas o contexto abaixo e se houver menção ao ano da agenda apenas informe baseado ao que você ve no contexto pois certamente os dados serão do ano atual sempre. Se não souber, diga: "Não encontrei informações sobre isso."\n\nContexto: ' + context.substring(0, 30000);

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
      console.error('Erro scraping/IA:', err.message);
      response = 'Desculpe, não consegui acessar o site agora. Tente novamente.\n\n1. Voltar ao menu\n2. Sair';
    }

    return { response, newState, dailyCalls: updatedDailyCalls };
  }
};