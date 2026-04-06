import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import connectDB from "../config/db";
import User from "../models/User";

dotenv.config();

const seedSuperAdmin = async () => {
  try {
    await connectDB();

    const existingAdmin = await User.findOne({ role: "superadmin" });

    if (existingAdmin) {
      console.log("⚠️ Super Admin already exists");
      process.exit();
    }

    const hashedPassword = await bcrypt.hash("Admin@123", 10);

    await User.create({
      name: "Super Admin",
      email: "superadmin@ems.com",
      username: "superadmin",
      password: hashedPassword,
      role: "superadmin"
    });

    console.log("✅ Super Admin Created Successfully");
    process.exit();
  } catch (error) {
    console.error("❌ Error seeding super admin:", error);
    process.exit(1);
  }
};

seedSuperAdmin();
