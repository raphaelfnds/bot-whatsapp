// test-scrape.js
const axios = require('axios');
const cheerio = require('cheerio');

(async () => {
  const start = Date.now();
  try {
    const { data } = await axios.get('https://cultura.pontagrossa.pr.gov.br/agenda-cultural/', { timeout: 15000 });
    console.log('HTML recebido em', Date.now() - start, 'ms');
    const $ = cheerio.load(data);
    console.log('Tamanho texto:', $('body').text().replace(/\s+/g, ' ').trim().length);
  } catch (e) {
    console.error(e.message);
  }
})();