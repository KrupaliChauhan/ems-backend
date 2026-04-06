import express from "express";
import cors from "cors";
import helmet from "helmet";
import dns from "node:dns";
import path from "node:path";
import connectDB from "./config/db";
import { env } from "./config/env";
import authRoutes from "./routes/authRoutes";
import departmentRoutes from "./routes/departmentRoutes";
import designationRoutes from "./routes/designationRoutes";
import userRoutes from "./routes/userRoutes";
import projectRoutes from "./routes/projectRoutes";
import taskRoutes from "./routes/taskRoutes";
import assetRoutes from "./routes/assetRoutes";
import leaveRoutes from "./routes/leaveRoutes";
import attendanceRoutes from "./routes/attendanceRoutes";
import communicationRoutes from "./routes/communicationRoutes";
import reportRoutes from "./routes/reportRoutes";
import { notFound, errorHandler } from "./middleware/errorMiddleware";

dns.setServers(["1.1.1.1", "1.0.0.1"]);
dns.setDefaultResultOrder("ipv4first");

connectDB();

const app = express();
const allowedOrigins = [env.frontendUrl];

app.use(
  cors({
    origin: [env.frontendUrl],
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true
  })
);

app.use(
  helmet({
    crossOriginResourcePolicy: false
  })
);

app.use(express.json({ limit: "200kb" }));
app.use("/uploads", express.static(path.resolve(process.cwd(), "uploads")));

app.use("/api/auth", authRoutes);
app.use("/api/departments", departmentRoutes);
app.use("/api/designations", designationRoutes);
app.use("/api/users", userRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api/tasks", taskRoutes);
app.use("/api/assets", assetRoutes);
app.use("/api/leaves", leaveRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/communications", communicationRoutes);
app.use("/api/reports", reportRoutes);

app.get("/", (_req, res) => {
  res.json({ success: true, message: "EMS backend running" });
});

app.use(notFound);
app.use(errorHandler);

app.listen(env.port, () => {
  console.log(`Server running on port ${env.port}`);
});
