const path = require('path');
const express = require('express');

require('./db'); // ensures schema is created before anything else touches it
const jobQueue = require('./jobQueue');
const { registerWorkers } = require('./workers');

const app = express();
const PORT = process.env.PORT || 4173;

app.use(express.json({ limit: '2mb' }));

app.use('/api/sources', require('./routes/sources'));
app.use('/api/clips', require('./routes/clips'));

// Media, served directly so the <video> preview player can hit source files.
app.use('/media/sources', express.static(path.join(__dirname, '..', 'sources')));

app.use(express.static(path.join(__dirname, '..', 'public')));

registerWorkers();
jobQueue.start();

app.listen(PORT, () => {
  console.log(`Podcast Clipper running at http://localhost:${PORT}`);
});
