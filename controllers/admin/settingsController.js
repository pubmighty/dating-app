const sequelize = require("../../config/db");
const { isAdminSessionValid } = require("../../utils/helpers/authHelper");

const {
  ensureDefaultOptions,
  getAllOptionsMap,
  buildGroupedResponse,
  prepareUpdatesFromBody,
  upsertOptions,
} = require("../../script/optionInsert"); 

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
    return res.status(500).json({ success: false, msg: "Internal server error" });
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
      return res.status(409).json({ success: false, msg: "Duplicate option name." });
    }

    return res.status(500).json({ success: false, msg: "Internal server error" });
  }
}

module.exports = { getSettings, updateSettings };
