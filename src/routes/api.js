'use strict';

/**
 * JSON API, version 1. Every response has the same shape:
 *   success: { "success": true, "data": { ... } }
 *   failure: { "success": false, "error": { "code": "...", "message": "...", "details": [...]? } }
 *
 *   GET  /api/v1/games                  games, schedules, default coverage, last draw
 *   POST /api/v1/games/:slug/generate   body { "count": 1-10, "filters": { ... }? }
 *   GET  /api/v1/games/:slug/stats      frequency, hot/cold, gaps, distributions
 *   GET  /api/v1/games/:slug/draws      ?page=1&limit=20&to=YYYY-MM-DD (all optional)
 *   POST /api/v1/games/:slug/backtest   body { "filters": { ... }? }
 *   POST /api/v1/games/:slug/check-draw body { "filters": { ... }?, "drawDate": "YYYY-MM-DD"? }
 *        would these filters have allowed that official result? (latest draw if no date)
 */

const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { GameNotFoundError, DrawNotFoundError } = require('../services/game-service');
const { FilterValidationError } = require('../engine/filters');
const { ImpossibleFiltersError, MAX_COUNT } = require('../engine/generator');
const { isValidIsoDate } = require('../utils/ph-time');

const ONE_MINUTE_MS = 60 * 1000;
const READ_REQUESTS_PER_MINUTE = 120;
const GENERATE_REQUESTS_PER_MINUTE = 30;
const BACKTEST_REQUESTS_PER_MINUTE = 20;
const DRAWS_DEFAULT_LIMIT = 20;
const DRAWS_MAX_LIMIT = 50;
const DRAWS_MAX_PAGE = 1000;
const WHOLE_NUMBER_PATTERN = /^\d{1,4}$/;

/** Reads an optional whole-number query value; returns null when invalid. */
function readWholeNumber(value, fallback, min, max) {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'string' || !WHOLE_NUMBER_PATTERN.test(value)) {
    return null;
  }
  const number = Number(value);
  return number >= min && number <= max ? number : null;
}

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
  const backtestLimiter = limiter(BACKTEST_REQUESTS_PER_MINUTE);

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

  router.post('/games/:slug/backtest', backtestLimiter, async (req, res) => {
    const body = req.body === undefined ? {} : req.body;
    if (!isPlainObject(body)) {
      return sendError(res, 422, 'INVALID_REQUEST', 'Send a JSON object like {"filters": {}}.');
    }
    if (body.filters !== undefined && !isPlainObject(body.filters)) {
      return sendError(res, 422, 'INVALID_FILTERS', 'filters must be an object.');
    }
    const result = await gameService.backtest({ slug: req.params.slug, filters: body.filters });
    return res.json({ success: true, data: result });
  });

  router.post('/games/:slug/check-draw', readLimiter, async (req, res) => {
    const body = req.body === undefined ? {} : req.body;
    if (!isPlainObject(body)) {
      return sendError(res, 422, 'INVALID_REQUEST', 'Send a JSON object like {"filters": {}, "drawDate": "2026-10-27"}.');
    }
    if (body.filters !== undefined && !isPlainObject(body.filters)) {
      return sendError(res, 422, 'INVALID_FILTERS', 'filters must be an object.');
    }
    const drawDate = body.drawDate === undefined || body.drawDate === null ? null : body.drawDate;
    if (drawDate !== null && (typeof drawDate !== 'string' || !isValidIsoDate(drawDate))) {
      return sendError(res, 422, 'INVALID_DATE', 'drawDate must be a real date in YYYY-MM-DD format.');
    }
    const result = await gameService.checkDraw({ slug: req.params.slug, filters: body.filters, drawDate });
    res.set('Cache-Control', 'no-store');
    return res.json({ success: true, data: result });
  });

  router.get('/games/:slug/stats', readLimiter, async (req, res) => {
    const stats = await gameService.getStats(req.params.slug);
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, data: stats });
  });

  router.get('/games/:slug/draws', readLimiter, async (req, res) => {
    const page = readWholeNumber(req.query.page, 1, 1, DRAWS_MAX_PAGE);
    const limit = readWholeNumber(req.query.limit, DRAWS_DEFAULT_LIMIT, 1, DRAWS_MAX_LIMIT);
    const toDate = req.query.to === undefined || req.query.to === '' ? null : req.query.to;

    if (page === null) {
      return sendError(res, 422, 'INVALID_PAGE', `page must be a whole number from 1 to ${DRAWS_MAX_PAGE}.`);
    }
    if (limit === null) {
      return sendError(res, 422, 'INVALID_LIMIT', `limit must be a whole number from 1 to ${DRAWS_MAX_LIMIT}.`);
    }
    if (toDate !== null && (typeof toDate !== 'string' || !isValidIsoDate(toDate))) {
      return sendError(res, 422, 'INVALID_DATE', 'to must be a real date in YYYY-MM-DD format.');
    }

    const result = await gameService.listDraws(req.params.slug, { page, limit, toDate });
    res.set('Cache-Control', 'no-store');
    return res.json({ success: true, data: result });
  });

  // Known problems become clear 4xx answers; anything else goes to the app's 500 handler.
  router.use((error, req, res, next) => {
    if (error instanceof GameNotFoundError) {
      return sendError(res, 404, 'GAME_NOT_FOUND', error.message);
    }
    if (error instanceof DrawNotFoundError) {
      return sendError(res, 404, 'DRAW_NOT_FOUND', error.message);
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
