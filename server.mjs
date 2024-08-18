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
const buildAggregationPipeline = (queryEmbedding, filters, siteId) => {
    const pipeline = [
        {
            "$vectorSearch": {
                "index": "shared_vector_index",
                "path": "embedding",
                "queryVector": queryEmbedding,
                "numCandidates": 150,
                "limit": 10
            }
        },
        {
            "$match": {
                "siteId": siteId
            }
        }
    ];

    const matchStage = {};

    // Add filters based on the provided filters
    if (filters.category) {
        matchStage.category = filters.category;
    }

    if (filters.minPrice && filters.maxPrice) {
        matchStage.price = { $gte: filters.minPrice, $lte: filters.maxPrice };
    } else if (filters.minPrice) {
        matchStage.price = { $gte: filters.minPrice };
    } else if (filters.maxPrice) {
        matchStage.price = { $lte: filters.maxPrice };
    }

    // Add additional filters to the pipeline if any exist
    if (Object.keys(matchStage).length > 0) {
        pipeline.push({ "$match": matchStage });
    }

    // Set the score based on the search results
    pipeline.push({
        "$set": {
            "score": { "$meta": "searchScore" }
        }
    });

    // Sort by score in descending order
    pipeline.push({
        "$sort": { "score": -1 }
    });

    return pipeline;
};

// Utility function to translate query from Hebrew to English
async function translateQuery(query) {
    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini', 
            messages: [
                { role: 'system', content: 'Translate the following text from Hebrew to English:' },
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
    const { mongodbUri, dbName, collectionName, query, systemPrompt, siteId } = req.body;

    if (!query || !mongodbUri || !dbName || !collectionName || !systemPrompt || !siteId) {
        return res.status(400).json({ error: 'Query, MongoDB URI, database name, collection name, and system prompt are required' });
    }

    let client;

    try {
        client = new MongoClient(mongodbUri);
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection(collectionName);
        console.log(siteId);

        const translatedQuery = await translateQuery(query);
        if (!translatedQuery) return res.status(500).json({ error: 'Error translating query' });

        const filters = await extractFiltersFromQuery(translatedQuery, systemPrompt);
        const queryEmbedding = await getQueryEmbedding(translatedQuery);
        if (!queryEmbedding) return res.status(500).json({ error: 'Error generating query embedding' });

        const pipeline = buildAggregationPipeline(queryEmbedding, filters, siteId);
        const results = await collection.aggregate(pipeline).toArray();

        const formattedResults = results.map(product => ({
            id: product._id,
            title: product.title,
            description: product.description,
            price: product.price,
            image: product.image,
            url: product.url
        }));

        res.json(formattedResults);
        console.log('Search results:', formattedResults);
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

app.get('/products', async (req, res) => {
    const { mongodbUri, dbName, collectionName, limit = 10 } = req.query;

    if (!mongodbUri || !dbName || !collectionName) {
        return res.status(400).json({ error: 'MongoDB URI, database name, and collection name are required' });
    }

    let client;

    try {
        client = new MongoClient(mongodbUri);
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection(collectionName);

        // Fetch a default set of products, e.g., the latest 10 products
        const products = await collection.find().limit(Number(limit)).toArray();
      

        const results = products.map(product => ({
            id: product._id,
            title: product.title,  // Ensure this matches your MongoDB document structure
            description: product.description,
            price: product.price,
            image: product.image,
            url: product.url
        }));

        res.json(results);
    } catch (error) {
        console.error('Error fetching products:', error);
        res.status(500).json({ error: 'Server error' });
    } finally {
        if (client) {
            await client.close();
        }
    }
});