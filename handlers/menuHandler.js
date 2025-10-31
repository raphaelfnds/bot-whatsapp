const attendantHandler = require('./attendantHandler');

module.exports = {
  async handle(from, message, states, Edital) {
    const option = message.trim();
    let response = '';
    let newState = 'menu_selection';

    if (option === '1') {
      newState = 'agenda_help';
      response = 'Qual sua dúvida sobre a agenda?\n\nVocê também pode acessar mais detalhes através do link: https://cultura.pontagrossa.pr.gov.br/agenda-cultural/';
    } else if (option === '2') {
      const editais = await Edital.find();
      let editaisList = 'Editais disponíveis:\n';
      editais.forEach((edital, index) => {
        editaisList += `${index + 1}. ${edital.nome}\nLink: ${edital.link_principal}\n\n`;
      });
      newState = 'edital_selection';
      response = editaisList + 'Digite o número do edital para mais detalhes.';
    } else if (option === '3') {
      const { response: attResponse, newState: attNewState } = attendantHandler.handle();
      response = attResponse;
      newState = attNewState;
    } else if (option === '4') {
      response = 'Agradecemos seu contato.';
      newState = null;
    } else {
      response = 'Para poder lhe atender melhor.\nSobre o que deseja falar?\n1. Agenda.\n2. Edital.\n3. Falar com atendente.\n4. Sair e encerrar o atendimento.';
    }

    return { response, newState };
  }
};