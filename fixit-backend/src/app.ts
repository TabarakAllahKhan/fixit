
import express from "express";
import { env } from "./config/env.js";
import { healthRouter } from "./routes/health.routes.js";
import { authRouter } from "./routes/auth.routes.js";
import { diagnosisRouter } from "./routes/diagnosis.routes.js";
import { docsRouter } from "./docs/swagger.js";
import { corsMiddleware } from "./middleware/cors.js";
import { notFound } from "./middleware/notFound.js";
import { errorHandler } from "./middleware/errorHandler.js";

export const app = express();

// Minimal CORS for the Expo client; must precede the routers and preflight handling.
app.use(corsMiddleware);

// Parse incoming JSON requests
app.use(express.json());

// Application routes
app.use("/health", healthRouter);
app.use("/auth", authRouter);
app.use("/diagnosis", diagnosisRouter);

// API documentation is opt-in so Swagger UI and the raw spec are not public by
// accident. Set ENABLE_API_DOCS=true for local/staging documentation.
if (env.ENABLE_API_DOCS) {
  app.use("/docs", docsRouter);
}

// Handle unknown routes
app.use(notFound);

// Centralized error handler (must remain last)
app.use(errorHandler);

