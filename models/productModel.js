const mongoose = require("mongoose");

// ✅ Review Schema for Google Rich Snippets
const reviewSchema = new mongoose.Schema({
  rating: { type: Number, min: 1, max: 5, required: true },
  title: { type: String, required: true },
  content: { type: String, required: true },
  authorName: { type: String, default: "Anonymous" },
  createdAt: { type: Date, default: Date.now }
}, { _id: true });

const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true }, // Sale price
  mrp: { type: Number, required: true }, // MRP (Maximum Retail Price)
  sale: { type: Boolean, default: false }, // Flag to indicate if the product is on sale
  image: { type: String, required: true },
  categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
  description: { type: String, required: false },
  featured: { type: Boolean, default: false },
  
  // ✅ SEO Enhancement: SKU for structured data
  sku: { type: String, unique: true, required: true },

  // ✅ Reviews & Ratings (for SEO rich snippets)
  reviews: { type: [reviewSchema], default: [] },
  avgRating: { type: Number, default: 0 },
  reviewCount: { type: Number, default: 0 },

  // ✅ Added manual out-of-stock toggle
  outOfStock: { type: Boolean, default: false }
}, { timestamps: true });

// ✅ Helper function to create category/product codes for SKU
function codeFor(str, len) {
  if (!str) return 'XXX';
  return str.replace(/[^a-zA-Z0-9]/g, '').substring(0, len).toUpperCase().padEnd(len, 'X');
}

// ✅ Auto-generate SKU before validation
productSchema.pre('validate', async function(next) {
  if (this.sku) return next();
  
  try {
    // Get category name for SKU generation
    let categoryName = '';
    if (this.populated('categoryId')) {
      categoryName = this.categoryId.name || '';
    } else if (this.categoryId) {
      const Category = mongoose.model('Category');
      const cat = await Category.findById(this.categoryId).select('name').lean();
      categoryName = cat ? cat.name : '';
    }
    
    const catCode = codeFor(categoryName, 3); // First 3 letters of category
    const prodCode = codeFor(this.name, 3);   // First 3 letters of product
    
    // Generate unique numeric part
    for (let i = 0; i < 10; i++) {
      const num = Math.floor(100 + Math.random() * 900); // 100-999
      const candidate = `${catCode}-${prodCode}-${num}`;
      
      // Check if SKU already exists
      const exists = await mongoose.models.Product.findOne({ sku: candidate }).select('_id').lean();
      if (!exists) {
        this.sku = candidate;
        break;
      }
    }
    
    // Fallback if all attempts failed
    if (!this.sku) {
      this.sku = `RNR-${this._id.toString().slice(-6).toUpperCase()}`;
    }
    
    next();
  } catch (error) {
    next(error);
  }
});

// ✅ Utility method to recalculate aggregate rating
productSchema.methods.recalculateRating = function() {
  if (!this.reviews || this.reviews.length === 0) {
    this.avgRating = 0;
    this.reviewCount = 0;
    return;
  }
  const sum = this.reviews.reduce((acc, r) => acc + (r.rating || 0), 0);
  this.reviewCount = this.reviews.length;
  this.avgRating = Math.round((sum / this.reviewCount) * 10) / 10; // one decimal place
};

const Product = mongoose.model("Product", productSchema);
module.exports = Product;
