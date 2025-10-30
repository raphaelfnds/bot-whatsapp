// models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  acceptedTerms: { type: Boolean, default: false }
});

module.exports = mongoose.model('User', userSchema);