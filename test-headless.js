const puppeteer = require('puppeteer');

(async () => {
  try {
    console.log('Iniciando navegador...');

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();

    console.log('Acessando site...');
    await page.goto('https://cultura.pontagrossa.pr.gov.br/agenda-cultural/', {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    const title = await page.title();
    console.log('Título:', title);

    const hasCloudflare = await page.evaluate(() => {
      const text = document.body.innerText.toLowerCase();
      return text.includes('checking your browser') || text.includes('cloudflare');
    });
    console.log('Cloudflare?', hasCloudflare ? 'SIM' : 'NÃO');

    const contentLength = await page.evaluate(() => document.body.innerText.length);
    console.log('Conteúdo carregado?', contentLength > 500 ? 'SIM' : 'NÃO');

    await browser.close();
    console.log('Teste concluído!');
  } catch (error) {
    console.error('ERRO:', error.message);
  }
})();