const { Op } = require("sequelize");
const { getOptionsByIds } = require("../../utils/helper");

async function getSiteSettings(req, res) {
  try {
    const ids = [1, 5, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];

    const options = await getOptionsByIds(ids);

    // Convert array of objects to key-value pair
    const config = Array.isArray(options)
      ? options.reduce((acc, { name, value }) => {
          if (name && value !== undefined) {
            acc[name] = value;
          }
          return acc;
        }, {})
      : {};

    return res.json({
      success: true,
      message: "Setting fetched successfully",
      data: config,
    });
  } catch (error) {
    console.error("Error during getSiteSettings:", error);
    return res
      .status(500)
      .json({ success: false, msg: "Internal server error" });
  }
}

module.exports = { getSiteSettings };
