
// server.js
const express = require('express');
const { MongoClient } = require('mongodb');
const app = express();
const port = process.env.PORT || 3030;
const cors = require('cors');
app.use(cors());

// Ensure you have the MongoDB URI defined in your environment variables.
let mongodbUri =  process.env.MONGODB_URI;

// Middleware to parse JSON bodies.
app.use(express.json());

// Use a cached MongoDB client to avoid reconnecting on every request.
let cachedClient;
let cachedPromise;

function getMongoClient() {
  if (!cachedClient) {
    cachedClient = new MongoClient(mongodbUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    cachedPromise = cachedClient.connect();
  }
  return cachedPromise;
}

// POST /queries endpoint
app.post('/queries', async (req, res) => {
  const { dbName } = req.body;

  // Validate that dbName is provided.
  if (!dbName) {
    return res.status(400).json({ error: 'dbName parameter is required in the request body' });
  }

  try {
    // Get the cached MongoDB client (or connect if it's not already connected).
    const client = await getMongoClient();
    const db = client.db(dbName);
    const queriesCollection = db.collection('queries');

    // Fetch all documents from the queries collection.
    const queries = await queriesCollection.find({}).toArray();

    return res.status(200).json({ queries });
  } catch (error) {
    console.error('Error fetching queries:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});