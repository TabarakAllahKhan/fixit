import express from "express";
import { healthRouter } from "./routes/health.routes.js";
import { notFound } from "./middleware/notFound.js";
import { errorHandler } from "./middleware/errorHandler.js";
export const app = express();

// Temporary version of the app that just returns a simple message for testing purposes

app.use("/health", healthRouter);


app.use(notFound);

app.use(errorHandler);
