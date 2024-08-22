import express, { query } from 'express';
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
const buildAggregationPipeline = (queryEmbedding, filters, siteId, query) => {
    const pipeline = [];

    // If no filters, start with fuzzy search
    if (!filters || Object.keys(filters).length === 0) {
        pipeline.push({
            "$search": {
                "text": {
                    "query": query, // assuming queryEmbedding contains the text query
                    "path": "name", // or the field you want to perform fuzzy search on
                    "fuzzy": {
                        "maxEdits": 2 // Adjust the fuzziness level as needed
                    }
                }
            }
        });
    } else {
        // Otherwise, start with vector search
        pipeline.push({
            "$vectorSearch": {
                "index": "vector_index",
                "path": "embedding",
                "queryVector": queryEmbedding,
                "numCandidates": 150,
                "limit": 10
            }
        });

        pipeline.push({
            "$match": {
                "siteId": siteId
            }
        });

        const matchStage = {};

        // Build matchStage based on extracted filters
        if (filters.category) {
            matchStage.category = { $regex: filters.category, $options: "i" };
        }
        if (filters.type) {
            matchStage.type = { $regex: filters.type, $options: "i" };
        }
        if (filters.minPrice && filters.maxPrice) {
            matchStage.price = { $gte: filters.minPrice, $lte: filters.maxPrice };
        } else if (filters.minPrice) {
            matchStage.price = { $gte: filters.minPrice };
        } else if (filters.maxPrice) {
            matchStage.price = { $lte: filters.maxPrice };
        }

        // Add $match stage if there are filter conditions
        if (Object.keys(matchStage).length > 0) {
            pipeline.push({ "$match": matchStage });
        }
    }

    // Finalize with score sorting
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
                { role: 'system', content: 'Translate the following text from Hebrew to English. if its already in English, leave it as it is. if you find mispelling in the hebrew words, try to fix it and than translate it. the context is search query in e-commerce sites, so you probably get words attached to products or their descriptions. if you find a word you cant understand or think its out of context, do not translate it but do write it in english literally. for e.g, if you find the words "עגור לבן" write it as "agur lavan". respond with the the answer only, w/o explanations' },
                { role: 'user', content: query }
            ]
        });
        const translatedText = response.choices[0]?.message?.content?.trim();
        console.log('Translated query:', translatedText);
        return translatedText 
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
        console.log('Extracted filters:', filters);
        console.log(Object.keys(filters).length);
 
        return filters;
    } catch (error) {
        console.error('Error extracting filters:', error);
        throw error;
    }
}

// Utility function to get the embedding for a query
async function getQueryEmbedding(translatedText) {
    try {
        const response = await openai.embeddings.create({
            model: 'text-embedding-3-large',
            input: translatedText
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
        

        const translatedQuery = await translateQuery(query);
        if (!translatedQuery) return res.status(500).json({ error: 'Error translating query' });

        const filters = await extractFiltersFromQuery(translatedQuery, systemPrompt);
        const queryEmbedding = await getQueryEmbedding(translatedQuery);
        if (!queryEmbedding) return res.status(500).json({ error: 'Error generating query embedding' });

        const pipeline = buildAggregationPipeline(queryEmbedding, filters, siteId, query);
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