module.exports = {
  handle(from, message, states) {
    const option = message.trim();
    let response = '';
    let newState = 'awaiting_help';

    if (option === '1') {
      newState = 'menu_selection';
      response = 'Sobre o que deseja falar?\n1. Agenda.\n2. Edital.\n3. Falar com atendente.\n4. Sair e encerrar o atendimento.';
    } else if (option === '2') {
      response = 'Agradecemos seu contato.';
      newState = null;
    } else {
      newState = 'menu_selection';
      response = 'Para poder lhe atender melhor.\nSobre o que deseja falar?\n1. Agenda.\n2. Edital.\n3. Falar com atendente.\n4. Sair e encerrar o atendimento.';
    }

    return { response, newState };
  }
};