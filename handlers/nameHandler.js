module.exports = {
  async handle(from, message, states, User) {
    const state = states[from].state;
    let response = '';
    let newState = state;
    console.log(`[DEPURAÇÃO NAME] Entrando em handle para from: ${from}, state: ${state}, welcomed: ${states[from].welcomed}`);

    if (state === 'awaiting_name') {
      try {
        console.log('[DEPURAÇÃO NAME] Buscando user no MongoDB...');
        const user = await User.findOne({ phone: from });
        console.log('[DEPURAÇÃO NAME] User encontrado:', !!user, ' - Detalhes:', user ? { name: user.name, acceptedTerms: user.acceptedTerms } : 'Nenhum');

        if (user && user.acceptedTerms) {
          states[from].proposedName = user.name;
          newState = 'menu_selection';
          response = 'Sobre o que deseja falar?\n1. Agenda.\n2. Edital.\n3. Falar com atendente.\n4. Sair e encerrar o atendimento.';
        } else {
          if (!states[from].welcomed) {
            console.log('[DEPURAÇÃO NAME] Enviando boas-vindas (primeira interação)');
            states[from].welcomed = true;
            response = 'Bem vindo ao atendimento de IA!\nPor favor, *escreva qual seu nome*.';
          } else {
            console.log('[DEPURAÇÃO NAME] Processando nome fornecido:', message);
            states[from].proposedName = message.trim() || 'Usuario';
            newState = 'confirming_name';
            response = `O nome que você escreveu é ${states[from].proposedName}, correto?\n\nDigite:\n1. Para SIM.\n2. Para NAO.\n3. Para SAIR.\nObservação: Ao digitar "1. Para SIM" também estará aceitando a politica de privacidade: https://github.com/raphaelfnds/bot-whatsapp-privacidade/tree/main?tab=readme-ov-file#pol%C3%ADtica-de-privacidade---bot-whatsapp.`;
          }
        }
      } catch (err) {
        console.error('[DEPURAÇÃO NAME] Erro no findOne:', err.message);
        response = 'Erro ao verificar usuário. Tente novamente.';
      }
    } else if (state === 'confirming_name') {
      console.log('[DEPURAÇÃO NAME] Confirmando nome, opção:', message);
      const option = message.trim();
      if (option === '1') {
        try {
          console.log('[DEPURAÇÃO NAME] Criando user no MongoDB...');
          await User.create({ phone: from, name: states[from].proposedName, acceptedTerms: true });
          console.log('[DEPURAÇÃO NAME] User criado com sucesso.');
          newState = 'menu_selection';
          response = 'Sobre o que deseja falar?\n1. Agenda.\n2. Edital.\n3. Falar com atendente.\n4. Sair e encerrar o atendimento.';
        } catch (err) {
          console.error('[DEPURAÇÃO NAME] Erro ao criar user:', err.message);
          response = 'Erro ao salvar usuário. Tente novamente.';
        }
      } else if (option === '2') {
        newState = 'awaiting_name';
        delete states[from].proposedName;
        response = 'Por favor, escreva qual seu nome.';
      } else if (option === '3') {
        response = 'Agradecemos seu contato.';
        newState = null; // Limpa
      } else {
        response = `Não entendi sua resposta.\nO nome que você escreveu é ${states[from].proposedName}, correto?\n\nDigite:\n1. Para SIM.\n2. Para NAO.\n3. Para SAIR.\nObservação: Ao digitar "1. Para SIM" também estará aceitando a politica de privacidade: https://github.com/raphaelfnds/bot-whatsapp-privacidade/tree/main?tab=readme-ov-file#pol%C3%ADtica-de-privacidade---bot-whatsapp.`;
      }
    }

    console.log(`[DEPURAÇÃO NAME] Saindo com response: ${response.substring(0, 50)}..., newState: ${newState}`);
    return { response, newState };
  }
};