import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { openApiSpec } from './openapi.js';

export const docsRouter = Router();

// Raw OpenAPI document for tooling/import (Postman, Insomnia, codegen, etc.)
docsRouter.get('/openapi.json', (_req, res) => {
  res.json(openApiSpec);
});

// Swagger UI. Kept on a dedicated router so it can be mounted/removed without
// touching existing API routes or controllers.
docsRouter.use('/', swaggerUi.serve, swaggerUi.setup(openApiSpec, { explorer: true }));
