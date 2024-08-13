import express from 'express';
import bodyParser from 'body-parser';
import { MongoClient } from 'mongodb';
import { OpenAI } from 'openai';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(bodyParser.json());
app.use(cors({ origin: '*' }));

// Utility function to get the embedding for a query
async function getQueryEmbedding(query, openai) {
    try {
        const response = await openai.embeddings.create({
            model: 'text-embedding-3-large',
            input: query
        });
        return response.data[0]?.embedding || null;
    } catch (error) {
        console.error('Error fetching query embedding:', error);
        throw error;
    }
}

// Function to calculate cosine similarity between two vectors
function cosineSimilarity(vec1, vec2) {
    const dotProduct = vec1.reduce((sum, v, i) => sum + v * vec2[i], 0);
    const magnitude1 = Math.sqrt(vec1.reduce((sum, v) => sum + v * v, 0));
    const magnitude2 = Math.sqrt(vec2.reduce((sum, v) => sum + v * v, 0));
    return dotProduct / (magnitude1 * magnitude2);
}

// Route to handle the search endpoint
app.post('/search', async (req, res) => {
    const { mongodbUri, dbName, collectionName, query } = req.body;

    if (!query || !mongodbUri || !dbName || !collectionName) {
        return res.status(400).json({ error: 'Query, MongoDB URI, database name, and collection name are required' });
    }

    let client;

    try {
        client = new MongoClient(mongodbUri);
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection(collectionName);

        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

        // Get the query embedding
        const queryEmbedding = await getQueryEmbedding(query, openai);

        if (!queryEmbedding) {
            return res.status(500).json({ error: 'Error generating query embedding' });
        }

        // Get all products with embeddings
        const products = await collection.find({ embedding: { $exists: true } }).toArray();

        // Perform similarity check on all products
        const similarities = products.map(product => ({
            product,
            similarity: cosineSimilarity(queryEmbedding, product.embedding)
        }));

        similarities.sort((a, b) => b.similarity - a.similarity);
        const topProducts = similarities.slice(0, 10);

        const results = topProducts.map(({ product }) => ({
            id: product._id,
            title: product.title,
            description: product.description,
            price: product.price,
            image: product.image,
            url: product.url
        }));

        res.json(results);
    } catch (error) {
        console.error('Error handling search request:', error);
        res.status(500).json({ error: 'Server error' });
    } finally {
        if (client) {
            await client.close();
        }
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});