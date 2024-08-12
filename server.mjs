import express from 'express';
import bodyParser from 'body-parser';
import Shopify from 'shopify-api-node';
import { OpenAI } from 'openai';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(bodyParser.json());
app.use(cors({ origin: '*' }));

// Function to extract filters from the query using OpenAI (optional, since we are not filtering by category)
async function extractFiltersFromQuery(query, openai) {
    const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [
            { role: 'system', content: 'Extract filters from the query. Possible filters are minPrice, maxPrice, or category like red or white. Return them as a JSON object.' },
            { role: 'user', content: query }
        ],
        temperature: 0.5,
    });

    const content = response.choices[0].message.content;
    console.log(content);
    return JSON.parse(content);
}

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

// Utility function to get embeddings for products
async function getProductEmbeddings(shopify) {
    try {
        const products = await shopify.product.list({ limit: 250 });
        const embeddings = {};

        for (let product of products) {
            const metafields = await shopify.metafield.list({
                metafield: { owner_resource: 'product', owner_id: product.id }
            });
            const embeddingMetafield = metafields.find(
                metafield => metafield.key === 'embedding' && metafield.namespace === 'custom'
            );
            if (embeddingMetafield) {
                embeddings[product.id] = JSON.parse(embeddingMetafield.value);
            }
        }

        return embeddings;
    } catch (error) {
        console.error('Error fetching product embeddings:', error);
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
    const { shopifyStoreUrl, shopifyAccessToken,  query } = req.body;

    if (!query || !shopifyStoreUrl || !shopifyAccessToken ) {
        return res.status(400).json({ error: 'Query, Shopify credentials, and OpenAI API key are required' });
    }

    try {
        const shopify = new Shopify({ shopName: shopifyStoreUrl, accessToken: shopifyAccessToken });
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

        // Get the query embedding
        const queryEmbedding = await getQueryEmbedding(query, openai);

        if (!queryEmbedding) {
            return res.status(500).json({ error: 'Error generating query embedding' });
        }

        // Get embeddings for all products
        const productEmbeddings = await getProductEmbeddings(shopify);

        // Perform similarity check on all products
        const similarities = Object.entries(productEmbeddings).map(([productId, embedding]) => ({
            productId,
            similarity: cosineSimilarity(queryEmbedding, embedding)
        }));

        similarities.sort((a, b) => b.similarity - a.similarity);
        const topProducts = similarities.slice(0, 10).map(sim => sim.productId);

        const products = await shopify.product.list({ ids: topProducts.join(',') });

        const results = products.map(product => ({
            id: product.id,
            title: product.title,
            description: product.body_html,
            price: product.variants[0].price,
            image: product.image ? product.image.src : null,
            url: `/products/${product.handle}`
        }));

        res.json(results);
    } catch (error) {
        console.error('Error handling search request:', error);
        res.status(500).json({ error: 'Server error' });
    }
}
);
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
