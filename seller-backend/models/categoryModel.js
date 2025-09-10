const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Category name is required']
},
image: {
    type: String,
    required: [true, 'Category image is required']
},
  description: { type: String },

  slug: { type: String, unique: true },
  featured: { type: Boolean, default: false }
});

module.exports = mongoose.model('Category', categorySchema);
