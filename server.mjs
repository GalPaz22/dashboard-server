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

// Initialize OpenAI client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Utility function to translate query from Hebrew to English
async function translateQuery(query) {
    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: 'translate the query from hebrew to english' },
                { role: 'user', content: query }
            ]
        });
        const translatedText = response.choices[0]?.message?.content?.trim();
        return translatedText || null;
    } catch (error) {
        console.error('Error translating query:', error);
        throw error;
    }
}

// Utility function to extract filters from query using LLM
async function extractFiltersFromQuery(query, systemPrompt) {
    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: query }
            ],
            temperature: 0.5,
        });

        const content = response.choices[0]?.message?.content;
        const filters = JSON.parse(content);
        console.log('Extracted Filters:', filters);
        return filters;
    } catch (error) {
        console.error('Error extracting filters:', error);
        throw error;
    }
}

// Utility function to get the embedding for a query
async function getQueryEmbedding(query) {
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
    const { mongodbUri, dbName, collectionName, query, systemPrompt } = req.body;

    if (!query || !mongodbUri || !dbName || !collectionName || !systemPrompt) {
        return res.status(400).json({ error: 'Query, MongoDB URI, database name, collection name, and system prompt are required' });
    }

    let client;

    try {
        client = new MongoClient(mongodbUri);
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection(collectionName);

        // Translate the query from Hebrew to English
        const translatedQuery = await translateQuery(query, systemPrompt);

        if (!translatedQuery) {
            return res.status(500).json({ error: 'Error translating query' });
        }

        // Extract filters from the translated query
        const filters = await extractFiltersFromQuery(translatedQuery, systemPrompt);
        const { category, minPrice, maxPrice } = filters;

        // Build the MongoDB filter
        const mongoFilter = {};
        if (category !== undefined) {
            mongoFilter.category = category;
        }
        if (minPrice !== undefined && maxPrice !== undefined) {
            mongoFilter.price = { $gte: minPrice, $lte: maxPrice };
        } else if (minPrice !== undefined) {
            mongoFilter.price = { $gte: minPrice };
        } else if (maxPrice !== undefined) {
            mongoFilter.price = { $lte: maxPrice };
        }

        // Get the query embedding
        const queryEmbedding = await getQueryEmbedding(translatedQuery);

        if (!queryEmbedding) {
            return res.status(500).json({ error: 'Error generating query embedding' });
        }

        // Get all products with embeddings that match the filter
        const products = await collection.find({ ...mongoFilter, embedding: { $exists: true } }).toArray();

        // Perform similarity check on all products
        const similarities = products.map(product => ({
            product,
            similarity: cosineSimilarity(queryEmbedding, product.embedding)
        }));

        similarities.sort((a, b) => b.similarity - a.similarity);
        const topProducts = similarities.slice(0, 10);

        const results = topProducts.map(({ product }) => ({
            id: product._id,
            title: product.Title,
            description: product.description,
            price: product.price,
            image: product.image,
            url: product.url
        }));

        res.json(results);
        console.log('Search results:', results);
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
