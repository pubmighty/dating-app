const ActivityLog = require("../../models/ActivityLog");

function getIp(req) {  //this is for logging the ip of the user 
  try {
    const xf = req.headers["x-forwarded-for"];
    if (xf) return String(xf).split(",")[0].trim();
    return req.ip || req.connection?.remoteAddress || null;
  } catch {
    return null;
  }
}

async function logActivity(
  req,
  {
    userId = null,
    action,
    entityType,
    entityId = null,
    metadata = null,
    transaction = null,
  }
) {
  try {
    if (!action || !entityType) return;

    await ActivityLog.create(
      {
        user_id: userId,
        action: String(action),
        entity_type: String(entityType),
        entity_id: entityId ?? null,
        ip_address: getIp(req),
        user_agent: getUserAgent(req),
        metadata: metadata ?? null,
        created_at: new Date(),
      },
      transaction ? { transaction } : undefined
    );
  } catch (err) {
     console.error("logActivity error:", err?.message || err);
  }
}

module.exports = { logActivity };