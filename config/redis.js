const { createClient } = require("redis");

// Configure Redis client
const redisClient = createClient();
// Handle Redis client events
redisClient.on("connect", () => {
  console.log("Connected to Redis");
});

redisClient.on("error", (err) => {
  console.error("Redis error:", err);
});

module.exports = redisClient;
