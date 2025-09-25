const mongoose = require('mongoose');
const UserSchema = new mongoose.Schema({
  phone: String,
  name: String,
  acceptedTerms: { type: Boolean, default: false }
});
module.exports = mongoose.model('User', UserSchema);