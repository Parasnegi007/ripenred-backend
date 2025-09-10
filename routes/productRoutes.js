const express = require("express");
const { validationResult } = require('express-validator');
const { authLimiter, apiLimiter } = require('../middleware/rateLimiter');
const { asyncHandler, handleValidationErrors } = require('../middleware/errorHandler');
const {
    validateProductId,
     validateId,
    validateProductCreation,
    validateProductUpdate,
    validateCategoryId,
    validateSearchQuery,
    validateCategoryParamId
} = require('../middleware/validators');
const Product = require("../models/productModel");
const authMiddleware = require("../middleware/authMiddleware");
const router = express.Router();
const mongoose = require("mongoose");

// Cloudinary Setup
const cloudinary = require("../utils/cloudinary");
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "fruits-ecommerce/products",
    allowed_formats: ["jpg", "png", "jpeg", "webp"],
    transformation: [{ width: 800, height: 800, crop: "limit" }],
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
});


console.log("✅ productRoutes.js is running!");

// 🔹 POST - Add New Product
router.post("/", authLimiter, upload.single("image"), validateProductCreation, asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json(handleValidationErrors(errors));
    }
  let { name, price, description, categoryId, featured, sale, mrp, outOfStock } = req.body;
  const image = req.file ? req.file.path : "";

  if (!name || !price || !categoryId || !mrp) {
    return res.status(400).json({ success: false, message: "Please fill in all required fields." });
  }

  // 🔧 Convert string "true"/"false" to actual booleans
  featured = featured === "true" || featured === true;
  sale = sale === "true" || sale === true;
  outOfStock = outOfStock === "true" || outOfStock === true;

  try {
    const newProduct = new Product({
      name,
      price,
      description,
      image,
      categoryId,
      featured,
      sale,
      outOfStock,
      mrp
    });

    const savedProduct = await newProduct.save();
    res.json({ success: true, message: "Product added successfully!", product: savedProduct });
  } catch (error) {
    throw error;
  }
}));


// 🔹 GET - All Products
router.get("/", apiLimiter, asyncHandler(async (req, res) => {
  try {
    const products = await Product.find();
    res.json(products);
  } catch (error) {
    throw error;
  }
}));

// 🔹 GET - Featured Products
router.get("/featured", apiLimiter, asyncHandler(async (req, res) => {
  console.log("✅ /api/products/featured was called!");
  try {
    const products = await Product.find({ featured: true });
    res.json(products);
  } catch (error) {
    throw error;
  }
}));
// Route to fetch sale products
router.get("/sale-products", apiLimiter, asyncHandler(async (req, res) => {
  try {
    const saleProducts = await Product.find({ sale: true }); // Fetch products where the 'sale' flag is true
    res.status(200).json(saleProducts);
  } catch (error) {
    throw error;
  }
}));
// 🔹 PUT - Update Product
router.put("/:id", authLimiter,  validateId, upload.single("image"), validateProductUpdate, asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json(handleValidationErrors(errors));
    }
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid product ID" });
    }

    const { name, price, description, categoryId, featured, sale, mrp, outOfStock } = req.body;
    const image = req.file ? req.file.path : "";

    const updateData = {
      name,
      price,
      description,
      categoryId,
      featured,
      sale,
      outOfStock: outOfStock === "true" || outOfStock === true,
      mrp
    };

    if (image) updateData.image = image;

    const updatedProduct = await Product.findByIdAndUpdate(id, updateData, { new: true });

    if (!updatedProduct) {
      return res.status(404).json({ message: "Product not found" });
    }

    res.json({ message: "Product updated successfully!", product: updatedProduct });
  } catch (error) {
    throw error;
  }
}));


// 🔹 DELETE - Remove Product
router.delete("/:id", authLimiter, validateId, asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json(handleValidationErrors(errors));
    }
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid product ID" });
    }

    const deletedProduct = await Product.findByIdAndDelete(id);
    if (!deletedProduct) {
      return res.status(404).json({ message: "Product not found" });
    }

    res.json({ message: "Product deleted successfully!" });
  } catch (error) {
    throw error;
  }
}));

// 🔹 GET - Products by Category ID
router.get("/category/:categoryId", apiLimiter, validateCategoryParamId, asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json(handleValidationErrors(errors));
    }
  try {
    const { categoryId } = req.params;
    console.log("🟢 Received categoryId:", categoryId); // Debugging

    // Convert categoryId to MongoDB ObjectId format
    const products = await Product.find({ categoryId: new mongoose.Types.ObjectId(categoryId) });

    if (!products.length) {
      console.warn("⚠️ No products found for categoryId:", categoryId);
      return res.status(404).json({ message: "No products found in this category" });
    }

    res.json(products);
  } catch (error) {
    throw error;
  }
}));

//search feature
router.get('/search', apiLimiter, validateSearchQuery, asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json(handleValidationErrors(errors));
    }
  try {
      const { query } = req.query;
      if (!query) return res.status(400).json({ error: 'Search query missing' });

      const products = await Product.find({ name: { $regex: query, $options: 'i' } })
          .populate('categoryId'); // Ensure 'categoryId' correctly references Category

      res.json(products);
  } catch (error) {
    throw error;
  }
}));

// ✅ Get product by ID (includes reviews, avgRating, reviewCount)
router.get("/:id", apiLimiter, validateId, asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json(handleValidationErrors(errors));
  }

  const { id } = req.params;
  const product = await Product.findById(id);
  if (!product) {
    return res.status(404).json({ message: "Product not found" });
  }

  res.json(product);
}));

// ✅ Get reviews for a product
router.get('/:id/reviews', apiLimiter, validateId, asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json(handleValidationErrors(errors));
  }

  const { id } = req.params;
  const product = await Product.findById(id).select('reviews avgRating reviewCount');
  if (!product) {
    return res.status(404).json({ message: 'Product not found' });
  }

  res.json({ 
    reviews: product.reviews || [], 
    avgRating: product.avgRating || 0, 
    reviewCount: product.reviewCount || 0 
  });
}));

// ✅ Add a review to a product
router.post('/:id/reviews', authLimiter, validateId, asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json(handleValidationErrors(errors));
  }

  const { id } = req.params;
  const { rating, title, content, authorName } = req.body || {};

  // Basic validation
  if (typeof rating !== 'number' || rating < 1 || rating > 5) {
    return res.status(400).json({ message: 'Rating must be a number between 1 and 5' });
  }
  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    return res.status(400).json({ message: 'Title is required' });
  }
  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    return res.status(400).json({ message: 'Content is required' });
  }

  const product = await Product.findById(id);
  if (!product) {
    return res.status(404).json({ message: 'Product not found' });
  }

  // Add review
  product.reviews.push({ 
    rating, 
    title: title.trim(), 
    content: content.trim(), 
    authorName: authorName ? authorName.trim() : 'Anonymous' 
  });
  
  // Recalculate aggregate rating
  product.recalculateRating();
  await product.save();

  res.status(201).json({ 
    message: 'Review added successfully', 
    avgRating: product.avgRating, 
    reviewCount: product.reviewCount 
  });
}));



module.exports = router;
