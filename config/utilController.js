const Option = require("../models/Option");
const { Op } = require("sequelize");

async function getAllOptions(req, res) {
  try {
    const ids = [1, 5, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];

    const rows = await Option.findAll({
      where: { id: { [Op.in]: ids } },
      attributes: ["id", "name", "value"],
    });

    const config = {};

    for (const row of rows) {
      config[row.name] = row.value;
    }

    return res.json({
      success: true,
      message: "Setting fetched successfully",
      data: config,
    });
  } catch (err) {
    console.log("error");
    return err;
  }
}

module.exports = { getAllOptions };
