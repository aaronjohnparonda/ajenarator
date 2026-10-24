'use strict';

/**
 * JSON API, version 1. Every response has the same shape:
 *   success: { "success": true, "data": { ... } }
 *   failure: { "success": false, "error": { "code": "...", "message": "...", "details": [...]? } }
 *
 *   GET  /api/v1/games                  games, schedules, default coverage, last draw
 *   POST /api/v1/games/:slug/generate   body { "count": 1-10, "filters": { ... }? }
 */

const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { GameNotFoundError } = require('../services/game-service');
const { FilterValidationError } = require('../engine/filters');
const { ImpossibleFiltersError, MAX_COUNT } = require('../engine/generator');

const ONE_MINUTE_MS = 60 * 1000;
const READ_REQUESTS_PER_MINUTE = 120;
const GENERATE_REQUESTS_PER_MINUTE = 30;

function sendError(res, status, code, message, details) {
  const error = { code, message };
  if (details) {
    error.details = details;
  }
  return res.status(status).json({ success: false, error });
}

function limiter(limit) {
  return rateLimit({
    windowMs: ONE_MINUTE_MS,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, res) => sendError(res, 429, 'TOO_MANY_REQUESTS', 'Too many requests. Wait a minute and try again.'),
  });
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function createApiRouter({ gameService }) {
  const router = express.Router();
  const readLimiter = limiter(READ_REQUESTS_PER_MINUTE);
  const generateLimiter = limiter(GENERATE_REQUESTS_PER_MINUTE);

  router.get('/games', readLimiter, async (req, res) => {
    const games = await gameService.listGames();
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, data: { games } });
  });

  router.post('/games/:slug/generate', generateLimiter, async (req, res) => {
    const body = req.body;
    if (!isPlainObject(body)) {
      return sendError(res, 422, 'INVALID_REQUEST', 'Send a JSON object like {"count": 3}.');
    }
    if (!Number.isInteger(body.count) || body.count < 1 || body.count > MAX_COUNT) {
      return sendError(res, 422, 'INVALID_COUNT', `count must be a whole number from 1 to ${MAX_COUNT}.`);
    }
    if (body.filters !== undefined && !isPlainObject(body.filters)) {
      return sendError(res, 422, 'INVALID_FILTERS', 'filters must be an object.');
    }

    const result = await gameService.generate({ slug: req.params.slug, count: body.count, filters: body.filters });
    return res.json({ success: true, data: result });
  });

  // Known problems become clear 4xx answers; anything else goes to the app's 500 handler.
  router.use((error, req, res, next) => {
    if (error instanceof GameNotFoundError) {
      return sendError(res, 404, 'GAME_NOT_FOUND', error.message);
    }
    if (error instanceof FilterValidationError) {
      return sendError(res, 422, 'INVALID_FILTERS', 'Some filter settings are not valid.', error.problems);
    }
    if (error instanceof ImpossibleFiltersError) {
      return sendError(res, 422, 'FILTERS_TOO_STRICT', error.message);
    }
    return next(error);
  });

  return router;
}

module.exports = { createApiRouter };
