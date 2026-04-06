import mongoose from "mongoose";
import { env } from "./env";

const connectDB = async () => {
  try {
    await mongoose.connect(env.mongoUri, {
      tls: true,
      family: 4
    });
    console.log("MongoDB connected");
  } catch (error) {
    console.error("MongoDB connection failed:", error);
    process.exit(1);
  }
};

export default connectDB;
