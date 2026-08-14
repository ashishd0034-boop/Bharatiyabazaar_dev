const express = require("express");
const router = express.Router();
const memberService = require("../services/memberService");
const prisma = require("../lib/prisma");

// POST /api/members/register
router.post("/register", async (req, res) => {
  try {
    const { name, mobile, email, address, pinCode } = req.body;

    // Validation
    if (!name || !mobile) {
      return res.status(400).json({
        success: false,
        message: "Name and mobile are required"
      });
    }

    // Check if member already exists
    const existing = await memberService.getMemberByMobile(mobile);
    if (existing) {
      return res.status(400).json({
        success: false,
        message: "Member with this mobile already exists"
      });
    }

    // Create member
    const member = await memberService.createMember({
      name,
      mobile,
      email,
      address,
      pinCode
    });

    res.status(201).json({
      success: true,
      message: "Member created successfully",
      data: member
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// GET /api/members/:id
router.get("/:id", async (req, res) => {
  try {
    const member = await memberService.getMemberById(req.params.id);

    if (!member) {
      return res.status(404).json({
        success: false,
        message: "Member not found"
      });
    }

    res.json({
      success: true,
      data: member
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// GET /api/members  (THIS IS THE NEW ROUTE WE ADDED IN STEP 10)
router.get("/", async (req, res) => {
  try {
    const members = await prisma.member.findMany();
    res.json({
      success: true,
      data: members
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;