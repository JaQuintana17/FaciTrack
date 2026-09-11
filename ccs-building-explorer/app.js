/**
 * FaciTrack CCS Building Explorer
 * Express server — serves static files from /public
 */

const express = require('express');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3500;

// Serve everything inside /public as static assets
app.use(express.static(path.join(__dirname, 'public')));

// Catch-all: always serve index.html for SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n  ✅  CCS Building Explorer running at http://localhost:${PORT}\n`);
});
