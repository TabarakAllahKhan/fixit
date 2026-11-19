// Added by requireAuth after an access token has been verified.
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
      };
      // Set by validateQuery because Express 5's req.query is read-only.
      validatedQuery?: unknown;
    }
  }
}

export {};
