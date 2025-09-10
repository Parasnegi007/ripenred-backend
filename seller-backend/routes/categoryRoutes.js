const express = require("express");
const { validationResult } = require('express-validator');
const { authLimiter, apiLimiter } = require('../../middleware/rateLimiter');
const { asyncHandler, handleValidationErrors } = require('../../middleware/errorHandler');
const {
    validateCategoryCreation,
    validateCategoryUpdate,
    validateCategoryId
} = require('../../middleware/validators');
const Category = require("../models/categoryModel");
const router = express.Router();
const mongoose = require("mongoose");

// Cloudinary Setup
const cloudinary = require("../../utils/cloudinary");
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "fruits-ecommerce/categories",
    allowed_formats: ["jpg", "png", "jpeg", "webp"],
    transformation: [{ width: 800, height: 800, crop: "limit" }],
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

console.log("✅ categoryRoutes.js is running!");

// 🔹 POST - Add New Category
router.post("/", authLimiter, upload.single("image"), validateCategoryCreation, asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json(handleValidationErrors(errors));
    }
  const { name, description, slug, featured } = req.body;
  const image = req.file ? req.file.path : "";

  if (!name || !description || !slug) {
    return res.status(400).json({ message: "Name, description, and slug are required." });
  }

  try {
    const newCategory = new Category({
      name,
      description,
      slug,
      featured,
      image,
    });

    const savedCategory = await newCategory.save();
    res.json({ message: "Category added successfully!", category: savedCategory });
  } catch (error) {
    throw error;
  }
}));

// 🔹 GET - All Categories
router.get("/", apiLimiter, asyncHandler(async (req, res) => {
  try {
    const categories = await Category.find();
    res.json(categories);
  } catch (error) {
    throw error;
  }
}));

// 🔹 GET - Single Category by ID
router.get("/:id", apiLimiter, validateCategoryId, asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json(handleValidationErrors(errors));
    }
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid category ID" });
    }

    const category = await Category.findById(id);
    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }

    res.json(category);
  } catch (error) {
    throw error;
  }
}));

// 🔹 PUT - Update Category
router.put("/:id", authLimiter, validateCategoryId, upload.single("image"), validateCategoryUpdate, asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json(handleValidationErrors(errors));
    }
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid category ID" });
    }

    const { name, description, slug, featured } = req.body;
    const image = req.file ? req.file.path : "";

    const updateData = { name, description, slug, featured };
    if (image) updateData.image = image;

    const updatedCategory = await Category.findByIdAndUpdate(id, updateData, { new: true });

    if (!updatedCategory) {
      return res.status(404).json({ message: "Category not found" });
    }

    res.json({ message: "Category updated successfully!", category: updatedCategory });
  } catch (error) {
    throw error;
  }
}));

// 🔹 DELETE - Remove Category
router.delete("/:id", authLimiter, validateCategoryId, asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json(handleValidationErrors(errors));
    }
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid category ID" });
    }

    const deletedCategory = await Category.findByIdAndDelete(id);
    if (!deletedCategory) {
      return res.status(404).json({ message: "Category not found" });
    }

    res.json({ message: "Category deleted successfully!" });
  } catch (error) {
    throw error;
  }
}));

module.exports = router;
