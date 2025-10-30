// models/Edital.js
const mongoose = require('mongoose');

const editalSchema = new mongoose.Schema({
  nome: { type: String, required: true },
  link_principal: { type: String, required: true },
  link_pdf: { type: String }
});

module.exports = mongoose.model('Edital', editalSchema, 'editais');