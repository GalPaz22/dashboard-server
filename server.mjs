import express from "express";
import bodyParser from "body-parser";
import { MongoClient } from "mongodb";
import { OpenAI } from "openai";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(bodyParser.json());
app.use(cors({ origin: "*" }));

// Initialize OpenAI client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
let client;

async function connectToMongoDB(mongodbUri) {
  if (!client) {
    client = new MongoClient(mongodbUri, { useNewUrlParser: true, useUnifiedTopology: true });
    await client.connect();
  }
  return client;
}

const buildFuzzySearchPipeline = (query, filters) => {
  const pipeline = [
    {
      $search: {
        index: "default",
        text: {
          query: query,
          path: "name",
          fuzzy: {
            maxEdits: 2,
            prefixLength: 0,
            maxExpansions: 50,
          },
        },
      },
    },
  ];

  if (filters && Object.keys(filters).length > 0) {
    const matchStage = {};

    if (filters.category ?? null) {
      matchStage.category = { $regex: filters.category, $options: "i" };
    }
    if (filters.type ?? null) {
      matchStage.type = { $regex: filters.type, $options: "i" };
    }
    if (filters.minPrice && filters.maxPrice) {
      matchStage.price = { $gte: filters.minPrice, $lte: filters.maxPrice };
    } else if (filters.minPrice) {
      matchStage.price = { $gte: filters.minPrice };
    } else if (filters.maxPrice) {
      matchStage.price = { $lte: filters.maxPrice };
    }

    if (Object.keys(matchStage).length > 0) {
      pipeline.push({ $match: matchStage });
    }
  }

  pipeline.push({ $limit: 20 }); // Increase limit for better RRF results

  return pipeline;
};

const buildVectorSearchPipeline = (queryEmbedding, filters) => {
  const pipeline = [
    {
      $vectorSearch: {
        index: "vector_index",
        path: "embedding",
        queryVector: queryEmbedding,
        numCandidates: 150,
        limit: 50, // Increase limit for better RRF results
      },
    },
  ];

  if (filters && Object.keys(filters).length > 0) {
    const matchStage = {};

    if (filters.category ?? null) {
      matchStage.category = { $regex: filters.category, $options: "i" };
    }
    if (filters.type ?? null) {
      matchStage.type = { $regex: filters.type, $options: "i" };
    }
    if (filters.minPrice && filters.maxPrice) {
      matchStage.price = { $gte: filters.minPrice, $lte: filters.maxPrice };
    } else if (filters.minPrice) {
      matchStage.price = { $gte: filters.minPrice };
    } else if (filters.maxPrice) {
      matchStage.price = { $lte: filters.maxPrice };
    }

    if (Object.keys(matchStage).length > 0) {
      pipeline.push({ $match: matchStage });
    }
  }

  return pipeline;
};

// Utility function to translate query from Hebrew to English
async function translateQuery(query) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            'Translate the following text from Hebrew to English. If it\'s already in English, leave it as it is. If you find misspelling in the Hebrew words, try to fix it and then translate it. The context is a search query in e-commerce sites, so you probably get words attached to products or their descriptions. If you find a word you can\'t understand or think it\'s out of context, do not translate it but do write it in English literally. For example, if you find the words "עגור לבן" write it as "agur lavan". Respond with the answer only, without explanations. pay attention to the word שכלי or שאבלי- those ment to be chablis',
        },
        { role: "user", content: query },
      ],
    });
    const translatedText = response.choices[0]?.message?.content?.trim();
    console.log("Translated query:", translatedText);
    return translatedText;
  } catch (error) {
    console.error("Error translating query:", error);
    throw error;
  }
}

// New function to remove 'wine' from the query
// New function to remove 'wine' from the query
function removeWineFromQuery(translatedQuery) {
    const noWord = ["wine", "white","red", "rose"];
    const queryWords = translatedQuery.split(" ");
    const filteredWords = queryWords.filter(word => !noWord.includes(word.toLowerCase()));
    return filteredWords.join(" ");
}

// Utility function to extract filters from query using LLM
async function extractFiltersFromQuery(query, systemPrompt) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: query },
      ],
      temperature: 0.5,
    });

    const content = response.choices[0]?.message?.content;
    const filters = JSON.parse(content);
    console.log("Extracted filters:", filters);
    console.log(Object.keys(filters).length);

    return filters;
  } catch (error) {
    console.error("Error extracting filters:", error);
    throw error;
  }
}

// Utility function to get the embedding for a query
async function getQueryEmbedding(cleanedText) {
  try {
    // Remove 'wine' from the translated text
  

    const response = await openai.embeddings.create({
      model: "text-embedding-3-large",
      input: cleanedText,
    });
    return response.data[0]?.embedding || null;
  } catch (error) {
    console.error("Error fetching query embedding:", error);
    throw error;
  }
}

// Route to handle the search endpoint
app.post("/search", async (req, res) => {
  const { mongodbUri, dbName, collectionName, query, systemPrompt } = req.body;

  if (!query || !mongodbUri || !dbName || !collectionName || !systemPrompt) {
    return res.status(400).json({
      error: "Query, MongoDB URI, database name, collection name, and system prompt are required",
    });
  }

  let client;

  try {
    const client = await connectToMongoDB(mongodbUri);
    const db = client.db(dbName);
    const collection = db.collection(collectionName);

    // Translate query
    const translatedQuery = await translateQuery(query);
    if (!translatedQuery) return res.status(500).json({ error: "Error translating query" });

    const cleanedText = removeWineFromQuery(translatedQuery);
    console.log("Cleaned query for embedding:", cleanedText);
    // Extract filters from the translated query
    const filters = await extractFiltersFromQuery(query, systemPrompt);

    // Get query embedding
    const queryEmbedding = await getQueryEmbedding(cleanedText);
    if (!queryEmbedding) return res.status(500).json({ error: "Error generating query embedding" });

    const RRF_CONSTANT = 60;
    const VECTOR_WEIGHT = query.length > 7 ? 2 : 1;

    function calculateRRFScore(fuzzyRank, vectorRank, VECTOR_WEIGHT) {
      return 1 / (RRF_CONSTANT + fuzzyRank) +  VECTOR_WEIGHT* (1 / (RRF_CONSTANT + vectorRank));
    }

    // Perform fuzzy search
    const fuzzySearchPipeline = buildFuzzySearchPipeline(query, filters);
    const fuzzyResults = await collection.aggregate(fuzzySearchPipeline).toArray();

    // Perform vector search
    const vectorSearchPipeline = buildVectorSearchPipeline(queryEmbedding, filters);
    const vectorResults = await collection.aggregate(vectorSearchPipeline).toArray();

    // Create a map to store the best rank for each document
    const documentRanks = new Map();

    // Process fuzzy search results
    fuzzyResults.forEach((doc, index) => {
      documentRanks.set(doc._id.toString(), { fuzzyRank: index, vectorRank: Infinity });
    });

    // Process vector search results
    vectorResults.forEach((doc, index) => {
      const existingRanks = documentRanks.get(doc._id.toString()) || { fuzzyRank: Infinity, vectorRank: Infinity };
      documentRanks.set(doc._id.toString(), { ...existingRanks, vectorRank: index });
    });

    // Calculate RRF scores and create the final result set
    const combinedResults = Array.from(documentRanks.entries())
      .map(([id, ranks]) => {
        const doc = fuzzyResults.find((d) => d._id.toString() === id) || vectorResults.find((d) => d._id.toString() === id);
        return {
          ...doc,
          rrf_score: calculateRRFScore(ranks.fuzzyRank, ranks.vectorRank, VECTOR_WEIGHT),
        };
      })
      .sort((a, b) => b.rrf_score - a.rrf_score)
      .slice(0, 12);

    // Format results
    const formattedResults = combinedResults.map((product) => ({
      id: product._id,
      name: product.name,
      description: product.description,
      price: product.price,
      image: product.image,
      url: product.url,
      rrf_score: product.rrf_score,
    }));

    res.json(formattedResults);
  } catch (error) {
    console.error("Error handling search request:", error);
    res.status(500).json({ error: "Server error" });
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

app.get("/products", async (req, res) => {
  const { mongodbUri, dbName, collectionName, limit = 10 } = req.query;

  if (!mongodbUri || !dbName || !collectionName) {
    return res.status(400).json({
      error: "MongoDB URI, database name, and collection name are required"
    });
  }

  let client;

  try {
    const client = await connectToMongoDB(mongodbUri);
    const db = client.db(dbName);
    const collection = db.collection(collectionName);

    // Fetch a default set of products, e.g., the latest 10 products
    const products = await collection.find().limit(Number(limit)).toArray();

    const results = products.map((product) => ({
      id: product._id,
      name: product.name,
      description: product.description,
      price: product.price,
      image: product.image,
      url: product.url,
    }));

    res.json(results);
  } catch (error) {
    console.error("Error fetching products:", error);
    res.status(500).json({ error: "Server error" });
  } finally {
    if (client) {
      await client.close();
    }
  }
});