const sequelize = require("../../config/db");
const { isAdminSessionValid } = require("../../utils/helpers/authHelper");

const {
  ensureDefaultOptions,
  getAllOptionsMap,
  buildGroupedResponse,
  prepareUpdatesFromBody,
  upsertOptions,
} = require("../../utils/helpers/optionHelper");
const User = require("../../models/User");
const Admin = require("../../models/Admin/Admin");
const UserReport = require("../../models/UserReport");

async function getSettings(req, res) {
  try {
    // same as MasterPrompt
    const session = await isAdminSessionValid(req);
    if (!session?.success || !session?.data) {
      return res.status(401).json({ success: false, msg: "Unauthorized" });
    }

    await ensureDefaultOptions();

    const rawMap = await getAllOptionsMap();
    const data = buildGroupedResponse(rawMap, { maskSecrets: true });

    return res.status(200).json({ success: true, data });
  } catch (err) {
    console.error("getSettings error:", err);
    return res
      .status(500)
      .json({ success: false, msg: "Internal server error" });
  }
}

async function updateSettings(req, res) {
  const t = await sequelize.transaction();
  try {
    // same as MasterPrompt
    const session = await isAdminSessionValid(req);
    if (!session?.success || !session?.data) {
      await t.rollback();
      return res.status(401).json({ success: false, msg: "Unauthorized" });
    }

    await ensureDefaultOptions(t);

    const prep = prepareUpdatesFromBody(req.body || {});
    if (!prep.ok) {
      await t.rollback();
      return res.status(400).json({ success: false, msg: prep.msg });
    }

    await upsertOptions(prep.prepared, t);

    await t.commit();

    const rawMap = await getAllOptionsMap();
    const data = buildGroupedResponse(rawMap, { maskSecrets: true });

    return res.status(200).json({
      success: true,
      msg: "Settings updated successfully.",
      data,
    });
  } catch (err) {
    await t.rollback();
    console.error("updateSettings error:", err);

    if (err?.name === "SequelizeUniqueConstraintError") {
      return res
        .status(409)
        .json({ success: false, msg: "Duplicate option name." });
    }

    return res
      .status(500)
      .json({ success: false, msg: "Internal server error" });
  }
}

async function getDashboardStats(req, res) {
  try {
    // 1) Validate admin session
    const session = await isAdminSessionValid(req, res);
    if (!session?.success || !session?.data) {
      return res.status(401).json({
        success: false,
        message: session?.message || "Admin session invalid",
        data: null,
      });
    }

    const adminId = Number(session.data);
    const admin = await Admin.findByPk(adminId, { attributes: ["id", "role"] });
    if (!admin) {
      return res.status(401).json({
        success: false,
        message: "Admin not found",
        data: null,
      });
    }

    // 2) Counts (run in parallel for speed)
    // Exclude deleted users (is_deleted=1)
    const userBaseWhere = { is_deleted: 0 };

    const [
      totalBots,
      totalRealUsers,
      totalReports,
      totalPendingReports,
      totalResolvedReports,
    ] = await Promise.all([
      User.count({
        where: { ...userBaseWhere, type: "bot" },
      }),
      User.count({
        where: { ...userBaseWhere, type: "real" },
      }),
      UserReport.count(),
      UserReport.count({
        where: { status: "pending" },
      }),

      UserReport.count({
        where: { status: "completed" },
      }),
    ]);

    console.warn(totalBots);

    return res.json({
      success: true,
      message: "Dashboard stats fetched successfully",
      data: {
        users: {
          total_bots: Number(totalBots || 0),
          total_real_users: Number(totalRealUsers || 0),
          total_users: Number((totalBots || 0) + (totalRealUsers || 0)),
        },
        reports: {
          total_reports: Number(totalReports || 0),
          pending_reports: Number(totalPendingReports || 0),
          resolved_reports: Number(totalResolvedReports || 0),
        },
      },
    });
  } catch (err) {
    console.error("Error during getDashboardStats:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      data: null,
    });
  }
}
module.exports = { getSettings, updateSettings, getDashboardStats };
