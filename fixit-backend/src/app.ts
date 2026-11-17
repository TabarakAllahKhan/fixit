
import express from "express";
import { healthRouter } from "./routes/health.routes.js";
import { authRouter } from "./routes/auth.routes.js";
import { docsRouter } from "./docs/swagger.js";
import { notFound } from "./middleware/notFound.js";
import { errorHandler } from "./middleware/errorHandler.js";

export const app = express();

// Parse incoming JSON requests
app.use(express.json());

// Application routes
app.use("/health", healthRouter);
app.use("/auth", authRouter);

// API documentation (Swagger UI + OpenAPI JSON). Mounted before notFound so /docs
// resolves as a route, and kept additive/removable without touching API handlers.
app.use("/docs", docsRouter);

// Handle unknown routes
app.use(notFound);

// Centralized error handler (must remain last)
app.use(errorHandler);

