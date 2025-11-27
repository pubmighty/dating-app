// helpers/userAuthHelper.js
const { Op } = require('sequelize');
const crypto = require('crypto');

const UserSession = require('../../models/UserSession');
const { getOption, getRealIp, getUserAgentData, getLocation } = require('../helper');

// 1) Create user session
async function handleUserSessionCreate(user, req, transaction = null) {
  const ip = getRealIp(req);
  const locationData = await getLocation(ip);
  const userAgentData = await getUserAgentData(req);

  const maxSessionDays = parseInt(
    await getOption('max_user_session_duration_days', 7),
    10
  );
  const maxSessionSeconds = maxSessionDays * 24 * 3600;

  const token = crypto.randomBytes(32).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + maxSessionSeconds * 1000);

  // expire old sessions for this user
  await UserSession.update(
    { status: 2 },
    {
      where: {
        userId: user.id,
        status: 1,
        expiresAt: { [Op.lt]: now },
      },
      transaction,
    }
  );

  // count active sessions
  const activeCount = await UserSession.count({
    where: { userId: user.id, status: 1 },
    transaction,
  });

  const maxUserSessions = parseInt(
    await getOption('max_user_sessions', 4),
    10
  );

  const sessionPayload = {
    userId: user.id,
    sessionToken: token,
    ip,
    userAgent: userAgentData.userAgent,
    country: locationData.countryCode,
    os: userAgentData.os,
    browser: userAgentData.browser,
    status: 1,
    expiresAt,
  };

  if (activeCount < maxUserSessions) {
    await UserSession.create(sessionPayload, { transaction });
    return { token, expiresAt };
  }

  // reuse oldest session if above limit
  const oldestActive = await UserSession.findOne({
    where: { userId: user.id },
    order: [['expiresAt', 'ASC']],
    transaction,
  });

  if (!oldestActive) {
    await UserSession.create(sessionPayload, { transaction });
    return { token, expiresAt };
  }

  await oldestActive.update(sessionPayload, { transaction });
  return { token, expiresAt };
}

// 2) Validate user session
async function isUserSessionValid(req) {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      return {
        success: false,
        message: 'Missing or invalid Authorization header',
        data: null,
      };
    }

    const token = authHeader.split(' ')[1];

    const session = await UserSession.findOne({
      where: { sessionToken: token, status: 1 },
    });

    if (!session) {
      return { success: false, message: 'Invalid session', data: null };
    }

    const now = new Date();
    if (session.expiresAt && session.expiresAt < now) {
      await session.update({ status: 2 });
      return { success: false, message: 'Session expired', data: null };
    }

    const SLIDING_IDLE_MS =
      parseInt(await getOption('user_min_update_interval', 30), 10) *
      60 *
      1000;

    if (SLIDING_IDLE_MS > 0) {
      const lastActivityAt = session.lastActivityAt;

      if (lastActivityAt) {
        const diff = now - new Date(lastActivityAt);
        if (diff >= SLIDING_IDLE_MS) {
          await session.update({ lastActivityAt: now });
        }
      } else {
        await session.update({ lastActivityAt: now });
      }
    }

    return {
      success: true,
      message: 'Session is valid',
      data: session.userId,
    };
  } catch (err) {
    console.error('Auth error (user):', err);
    return {
      success: false,
      message: 'Server error during auth',
      data: null,
    };
  }
}

module.exports = {
  handleUserSessionCreate,
  isUserSessionValid,
};
