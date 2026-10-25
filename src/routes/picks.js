'use strict';

/**
 * My Picks API (owner only; all under /api/v1/picks):
 *   GET  /picks/upcoming   next pickable draw per game, with the saved pick (if any)
 *   POST /picks            body { gameCode, drawDate, numbers: [6], source: "generator"|"manual" }
 *   GET  /picks            ?page=1&limit=20 history with results, newest first
 *   GET  /picks/summary    personal record + results not yet shown
 *   POST /picks/seen       body { ids: [pickId, ...] } - dismisses results from the pop-up
 *
 * The user always comes from the session cookie, never from the request body.
 */

const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { requireOwner } = require('../middleware/session');
const { GameNotFoundError } = require('../services/game-service');
const { PickValidationError, PickClosedError, PickExistsError } = require('../services/pick-service');

const ONE_MINUTE_MS = 60 * 1000;
const READS_PER_MINUTE = 120;
const WRITES_PER_MINUTE = 30;
const HISTORY_DEFAULT_LIMIT = 20;
const HISTORY_MAX_LIMIT = 50;
const HISTORY_MAX_PAGE = 1000;
const WHOLE_NUMBER_PATTERN = /^\d{1,4}$/;

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

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function handlePickError(res, error) {
  if (error instanceof PickValidationError) {
    return sendError(res, 422, 'INVALID_PICK', error.message, error.details);
  }
  if (error instanceof GameNotFoundError) {
    return sendError(res, 404, 'GAME_NOT_FOUND', error.message);
  }
  if (error instanceof PickClosedError) {
    return sendError(res, 409, 'PICK_CLOSED', error.message);
  }
  if (error instanceof PickExistsError) {
    return sendError(res, 409, 'PICK_EXISTS', error.message);
  }
  throw error;
}

function createPicksRouter({ pickService }) {
  const router = express.Router();
  const readLimiter = limiter(READS_PER_MINUTE);
  const writeLimiter = limiter(WRITES_PER_MINUTE);

  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.use(requireOwner);

  router.get('/upcoming', readLimiter, async (req, res) => {
    const draws = await pickService.getUpcoming(req.user.id);
    res.json({ success: true, data: { draws } });
  });

  router.get('/summary', readLimiter, async (req, res) => {
    res.json({ success: true, data: await pickService.getSummary(req.user.id) });
  });

  router.get('/', readLimiter, async (req, res) => {
    const page = readWholeNumber(req.query.page, 1, 1, HISTORY_MAX_PAGE);
    if (page === null) {
      return sendError(res, 422, 'INVALID_PAGE', `page must be a whole number from 1 to ${HISTORY_MAX_PAGE}.`);
    }
    const limit = readWholeNumber(req.query.limit, HISTORY_DEFAULT_LIMIT, 1, HISTORY_MAX_LIMIT);
    if (limit === null) {
      return sendError(res, 422, 'INVALID_LIMIT', `limit must be a whole number from 1 to ${HISTORY_MAX_LIMIT}.`);
    }
    return res.json({ success: true, data: await pickService.listHistory(req.user.id, { page, limit }) });
  });

  router.post('/', writeLimiter, async (req, res) => {
    if (!isPlainObject(req.body)) {
      return sendError(res, 422, 'INVALID_PICK', 'Send a JSON object like {"gameCode": "6/42", "drawDate": "2026-10-27", "numbers": [...], "source": "manual"}.');
    }
    const { gameCode, drawDate, numbers, source } = req.body;
    try {
      const pick = await pickService.createPick(req.user.id, { gameCode, drawDate, numbers, source });
      return res.status(201).json({ success: true, data: { pick } });
    } catch (error) {
      return handlePickError(res, error);
    }
  });

  router.post('/seen', writeLimiter, async (req, res) => {
    const ids = isPlainObject(req.body) ? req.body.ids : undefined;
    try {
      const marked = await pickService.markSeen(req.user.id, ids);
      return res.json({ success: true, data: { marked } });
    } catch (error) {
      return handlePickError(res, error);
    }
  });

  return router;
}

module.exports = { createPicksRouter };
