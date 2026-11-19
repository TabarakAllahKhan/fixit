
import express from "express";
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

// API documentation (Swagger UI + OpenAPI JSON). Mounted before notFound so /docs
// resolves as a route, and kept additive/removable without touching API handlers.
app.use("/docs", docsRouter);

// Handle unknown routes
app.use(notFound);

// Centralized error handler (must remain last)
app.use(errorHandler);

