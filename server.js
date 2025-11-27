require('dotenv').config();
const express = require('express');
const cors = require('cors');
const sequelize = require('./config/db');

const authRoutes = require('./routes/auth');

// IMPORT MODELS so Sequelize knows them
require('./models/User');
require('./models/UserOTP');      // new
// require('./models/UserSession');  // later when you add it

const app = express();

app.use(cors());
app.use(express.json());

// Default route
app.get('/', (req, res) => {
  res.send({ success: true, message: 'Server Running...' });
});

// Auth routes
app.use('/auth', authRoutes);

const PORT = process.env.PORT || 5000;

// Sync DB & start server
sequelize
  .sync()
  .then(() => {
    console.log(' Database connected & synced');
    app.listen(PORT, () => {
      console.log(` Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to sync DB:', err);
  });
