'use strict';

/**
 * GET /api/v1/draw-night - tonight's games with status and official results (public);
 * includes the owner's locked-in picks when signed in. Polled every ~20 s while waiting.
 */

const express = require('express');
const { rateLimit } = require('express-rate-limit');

const ONE_MINUTE_MS = 60 * 1000;
const REQUESTS_PER_MINUTE = 60;

function createDrawNightRouter({ drawNightService }) {
  const router = express.Router();
  const limiter = rateLimit({
    windowMs: ONE_MINUTE_MS,
    limit: REQUESTS_PER_MINUTE,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, res) => res.status(429).json({
      success: false,
      error: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests. Wait a minute and try again.' },
    }),
  });

  router.get('/', limiter, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, data: await drawNightService.getNight(req.user || null) });
  });

  return router;
}

module.exports = { createDrawNightRouter };
