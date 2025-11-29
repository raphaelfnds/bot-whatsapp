module.exports = {
  handle() {
    const initialMessage = encodeURIComponent('Olá, fui redirecionado pelo atendimento de IA, preciso tirar uma dúvida');
    return {
      response: `Por favor, clique no link para ser redirecionado: https://wa.me/554299600556?text=${initialMessage}`,
      newState: null
    };
  }
};