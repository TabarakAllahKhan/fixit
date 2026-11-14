
import express from "express";
import { healthRouter } from "./routes/health.routes.js";
import { authRouter } from "./routes/auth.routes.js";
import { notFound } from "./middleware/notFound.js";
import { errorHandler } from "./middleware/errorHandler.js";

export const app = express();

// Parse incoming JSON requests
app.use(express.json());

// Application routes
app.use("/health", healthRouter);
app.use("/auth", authRouter);

// Handle unknown routes
app.use(notFound);

// Centralized error handler (must remain last)
app.use(errorHandler);
