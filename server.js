import express from "express";
import bodyParser from "body-parser";
import { MongoClient, ObjectId } from "mongodb";
import { OpenAI } from "openai";
import cors from "cors";
import dotenv from "dotenv";
import {  GoogleGenAI } from "@google/genai";

dotenv.config();

const app = express();
app.use(bodyParser.json());
app.use(cors({ origin: "*" }));

// Initialize Google Generative AI client
const genAI = new GoogleGenAI(process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-001" });

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

let mongodbUri = process.env.MONGODB_URI;

// Middleware to parse JSON bodies.
app.use(express.json());

// Cached MongoDB client
let client;
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
app.post("/queries", async (req, res) => {
  const { dbName } = req.body;
  if (!dbName) {
    return res.status(400).json({ error: "dbName parameter is required in the request body" });
  }
  try {
    const client = await getMongoClient();
    const db = client.db(dbName);
    const queriesCollection = db.collection("queries");
    const queries = await queriesCollection.find({}).toArray();
    return res.status(200).json({ queries });
  } catch (error) {
    console.error("Error fetching queries:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

/* =========================================================== *\
   STORE CONFIG LOOK-UP – one place, reused by all routes
\* =========================================================== */

async function getStoreConfigByApiKey(apiKey) {
  if (!apiKey) return null;
  const client = await connectToMongoDB(mongodbUri);
  const coreDb = client.db("users");
  const userDoc = await coreDb.collection("users").findOne({ apiKey });
  if (!userDoc) return null;
  return {
    dbName: userDoc.dbName,
    products: userDoc.collections?.products || "products",
    queries: userDoc.collections?.queries || "queries",
    categories: userDoc.credentials?.categories || "",
    types: userDoc.credentials?.types || ""
  };
}

async function authenticate(req, res, next) {
  try {
    const apiKey = req.get("X-API-Key");
    const store = await getStoreConfigByApiKey(apiKey);
    if (!apiKey || !store) {
      return res.status(401).json({ error: "Invalid or missing API key" });
    }
    req.store = store;
    next();
  } catch (err) {
    console.error("[auth]", err);
    res.status(500).json({ error: "Auth failure" });
  }
}

app.use(authenticate);

async function connectToMongoDB(mongodbUri) {
  if (!client) {
    client = new MongoClient(mongodbUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    await client.connect();
    console.log("Connected to MongoDB");
  }
  return client;
}

const buildAutocompletePipeline = (query, indexName, path) => {
  const pipeline = [];
  pipeline.push({
    $search: {
      index: indexName,
      autocomplete: {
        query: query,
        path: path,
        fuzzy: {
          maxEdits: 2,
          prefixLength: 2,
        },
      },
    },
  });
  pipeline.push({
    $match: {
      $or: [{ stockStatus: { $exists: false } }, { stockStatus: "instock" }],
    },
  });
  pipeline.push(
    { $limit: 5 },
    {
      $project: {
        _id: 0,
        suggestion: `$${path}`,
        score: { $meta: "searchScore" },
        url: 1,
        image: 1,
        price: 1,
      },
    }
  );
  return pipeline;
};

app.get("/autocomplete", async (req, res) => {
  const { query, dbName: qDb } = req.query;
  const { dbName, products, queries } = req.store;
  try {
    const client = await connectToMongoDB(mongodbUri);
    const db = client.db(dbName);
    const collection1 = db.collection("products");
    const collection2 = db.collection("queries");
    const pipeline1 = buildAutocompletePipeline(query, "default", "name");
    const pipeline2 = buildAutocompletePipeline(query, "default2", "query");
    const [suggestions1, suggestions2] = await Promise.all([
      collection1.aggregate(pipeline1).toArray(),
      collection2.aggregate(pipeline2).toArray(),
    ]);
    const labeledSuggestions1 = suggestions1.map(item => ({
      suggestion: item.suggestion,
      score: item.score,
      source: "products",
      url: item.url,
      price: item.price,
      image: item.image
    }));
    const labeledSuggestions2 = suggestions2.map(item => ({
      suggestion: item.suggestion,
      score: item.score,
      source: "queries",
      url: item.url
    }));
    const combinedSuggestions = [...labeledSuggestions1, ...labeledSuggestions2]
      .sort((a, b) => b.score - a.score)
      .filter((item, index, self) =>
        index === self.findIndex((t) => t.suggestion === item.suggestion)
      );
    res.json(combinedSuggestions);
  } catch (error) {
    console.error("Error fetching autocomplete suggestions:", error);
    res.status(500).json({ error: "Server error" });
  }
});

function extractCategoriesUsingRegex(query, categories) {
  let catArray = [];
  if (Array.isArray(categories)) {
    catArray = categories;
  } else if (typeof categories === "string") {
    catArray = categories.split(",").map(cat => cat.trim()).filter(cat => cat.length > 0);
  }
  catArray.sort((a, b) => b.length - a.length);
  const fullMatches = [];
  for (const cat of catArray) {
    const regexFull = new RegExp(`(^|[^\\p{L}])${cat}($|[^\\p{L}])`, "iu");
    if (regexFull.test(query)) {
      fullMatches.push(cat);
      return [cat];
    }
  }
  if (fullMatches.length > 0) return fullMatches;
  const partialMatches = [];
  const matchedWords = new Set();
  for (const cat of catArray) {
    const words = cat.split(/\s+/);
    let matchedWordsCount = 0;
    let alreadyMatchedWord = false;
    for (const word of words) {
      if (word.length < 2) continue;
      const regexPartial = new RegExp(`(^|[^\\p{L}])${word}($|[^\\p{L}])`, "iu");
      if (regexPartial.test(query)) {
        matchedWordsCount++;
        if (matchedWords.has(word)) {
          alreadyMatchedWord = true;
        } else {
          matchedWords.add(word);
        }
      }
    }
    if (matchedWordsCount > 0 && (matchedWordsCount / words.length > 0.5 || !alreadyMatchedWord)) {
      partialMatches.push({
        category: cat,
        matchRatio: matchedWordsCount / words.length,
        specificity: words.length
      });
    }
  }
  partialMatches.sort((a, b) => {
    if (b.matchRatio !== a.matchRatio) return b.matchRatio - a.matchRatio;
    return b.specificity - a.specificity;
  });
  if (partialMatches.length > 0 &&
      partialMatches[0].matchRatio >= 0.7 &&
      (partialMatches.length === 1 || partialMatches[0].matchRatio > partialMatches[1].matchRatio)) {
    return [partialMatches[0].category];
  }
  return partialMatches.map(match => match.category);
}

const buildFuzzySearchPipeline = (cleanedHebrewText, query, filters) => {
  const pipeline = [];
  if (cleanedHebrewText && cleanedHebrewText.trim() !== "") {
    pipeline.push({
      $search: {
        index: "default",
        compound: {
          should: [
            {
              text: {
                query: cleanedHebrewText,
                path: "name",
                fuzzy: {
                  maxEdits: 2,
                  prefixLength: 3,
                  maxExpansions: 50,
                },
                score: { boost: { value: 5 } }
              }
            },
            {
              text: {
                query: cleanedHebrewText,
                path: "description",
                fuzzy: {
                  maxEdits: 2,
                  prefixLength: 3,
                  maxExpansions: 50,
                },
              }
            }
          ],
          filter: []
        }
      }
    });
  } else {
    pipeline.push({ $match: {} });
  }
  pipeline.push({
    $match: {
      $or: [{ stockStatus: { $exists: false } }, { stockStatus: "instock" }],
    },
  });
  if (filters && Object.keys(filters).length > 0) {
    const matchStage = {};
    if (filters.type) {
      matchStage.type = { $regex: filters.type, $options: "i" };
    }
    if (filters.minPrice && filters.maxPrice) {
      matchStage.price = { $gte: filters.minPrice, $lte: filters.maxPrice };
    } else if (filters.minPrice) {
      matchStage.price = { $gte: filters.minPrice };
    } else if (filters.maxPrice) {
      matchStage.price = { $lte: filters.maxPrice };
    } else if (filters.price) {
      const price = filters.price;
      const priceRange = price * 0.15;
      matchStage.price = { $gte: price - priceRange, $lte: price + priceRange };
    }
    if (Object.keys(matchStage).length > 0) {
      pipeline.push({ $match: matchStage });
    }
  }
  pipeline.push({
    $match: {
      $or: [{ stockStatus: { $exists: false } }, { stockStatus: "instock" }],
    },
  });
  pipeline.push({ $limit: 5 });
  return pipeline;
};

function buildVectorSearchPipeline(queryEmbedding, filters = {}) {
  const filter = {};
  if (filters.category) {
    filter.category = Array.isArray(filters.category) ? { $in: filters.category } : filters.category;
  }
  if (filters.type) {
    filter.type = filters.type;
  }
  if (filters.minPrice && filters.maxPrice) {
    filter.price = { $gte: filters.minPrice, $lte: filters.maxPrice };
  } else if (filters.minPrice) {
    filter.price = { $gte: filters.minPrice };
  } else if (filters.maxPrice) {
    filter.price = { $lte: filters.maxPrice };
  }
  if (filters.price) {
    const price = filters.price;
    const priceRange = price * 0.15;
    filter.price = { $gte: price - priceRange, $lte: price + priceRange };
  }
  const pipeline = [
    {
      $vectorSearch: {
        index: "vector_index",
        path: "embedding",
        queryVector: queryEmbedding,
        exact: true,
        limit: 15,
        ...(Object.keys(filter).length && { filter }),
      },
    },
  ];
  const postMatchClauses = [];
  postMatchClauses.push({
    $or: [{ stockStatus: "instock" }, { stockStatus: { $exists: false } }],
  });
  if (postMatchClauses.length > 0) {
    pipeline.push({ $match: { $and: postMatchClauses } });
  }
  return pipeline;
}

async function isHebrew(query) {
  const hebrewPattern = /[\u0590-\u05FF]/;
  return hebrewPattern.test(query);
}

async function translateQuery(query, context) {
  try {
    const needsTranslation = await isHebrew(query);
    if (!needsTranslation) return query;
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            `Your task is to translate and clean the following Hebrew search query so that it is optimized for embedding extraction. 
Instructions:
1. Translate the text from Hebrew to English.
2. Remove any extraneous or stop words.
3. Output only the essential keywords and phrases that will best represent the query context 
(remember: this is for e-commerce product searches in ${context} where details may be attached to product names and descriptions).
Pay attention to the word שכלי or שאבלי (which mean chablis).`
        },
        { role: "user", content: query },
      ],
    });
    const translatedText = response.choices[0]?.message?.content?.trim();
    console.log("Optimized query for embedding:", translatedText);
    return translatedText;
  } catch (error) {
    console.error("Error translating query:", error);
    throw error;
  }
}

function removeWineFromQuery(translatedQuery, noWord) {
  if (!noWord) return translatedQuery;
  const queryWords = translatedQuery.split(" ");
  const filteredWords = queryWords.filter((word) => !noWord.includes(word.toLowerCase()));
  return filteredWords.join(" ");
}

function removeWordsFromQuery(query, noHebrewWord) {
  if (!noHebrewWord) return query;
  const queryWords = query.split(" ");
  const filteredWords = queryWords.filter((word) => !noHebrewWord.includes(word) && isNaN(word));
  return filteredWords.join(" ");
}

async function classifyCategoryAndType(categories, types, example) {
  const messages = [
    {
      role: "user",
      parts: [
        {
          text: `Extract the following filters from the query if they exist:
                  1. price (exact price, indicated by the words 'ב' or 'באיזור ה-').
                  2. minPrice (minimum price, indicated by 'החל מ' or 'מ').
                  3. maxPrice (maximum price, indicated by the word 'עד').
                  4. category - one of the following Hebrew words: ${categories}. Pay close attention to find these categories in the query, and look if the user mentions a shortened version (e.g., 'רוזה' instead of 'יין רוזה').
                  5. type - one or both of the following Hebrew words: ${types}. Pay close attention to find these types in the query.
                Return the extracted filters in JSON format. If a filter is not present in the query, omit it from the JSON response. For example:
               {category: [" יין אדום" ,"יין"], type: "יין רוזה", minPrice: 20, maxPrice: 50}.`
        }
      ]
    }
  ];
  try {
    const geminiResponse = await model.generateContent({
      contents: messages,
    });
    //const responseText = await geminiResponse.text();
    const responseText = geminiResponse.text();
    return JSON.parse(responseText);
  } catch (error) {
    console.error("Google Gemini category/type extraction failed:", error);
    return { category: null, type: [] };
  }
}

async function getQueryEmbedding(cleanedText) {
  try {
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

async function logQuery(queryCollection, query, filters) {
  const timestamp = new Date();
  const entity = `${filters.category || "unknown"} ${filters.type || "unknown"}`;
  const queryDocument = {
    query: query,
    timestamp: timestamp,
    category: filters.category || "unknown",
    price: filters.price || "unknown",
    minPrice: filters.minPrice || "unknown",
    maxPrice: filters.maxPrice || "unknown",
    type: filters.type || "unknown",
    entity: entity.trim(),
  };
  await queryCollection.insertOne(queryDocument);
}

async function reorderResultsWithGPT(
  combinedResults,
  translatedQuery,
  query,
  alreadyDelivered = []
) {
  try {
    if (!Array.isArray(alreadyDelivered)) alreadyDelivered = [];
    const filteredResults = combinedResults.filter(
      (product) => !alreadyDelivered.includes(product._id.toString())
    );
    const productData = filteredResults.map((product) => ({
      id: product._id.toString(),
      name: product.name || "No name",
      description: product.description1 || "No description",
    }));
    console.log("Product data for reorder:", JSON.stringify(productData.slice(0, 4)));
    const messages = [
      {
        role: "user",
        parts: [{
          text: `You are an advanced AI model specializing in e-commerce queries. Your role is to analyze a given an english-translated query "${query}" from an e-commerce site, along with a provided list of products (each including a name and description), and return the **most relevant product IDs** based solely on how well the product names and descriptions match the query.

### Key Instructions:
1. you will get the original language query as well- ${query}- pay attention to match keyword based searches (other than semantic searches).
2. Ignore pricing details (already filtered).
3. Output must be a plain array of IDs, no extra text.
4. ONLY return the most relevant products related to the query ranked in the right order, but **never more that 10**.

`
        }]
      },
      {
        role: "user",
        parts: [{ text: JSON.stringify(productData, null, 4) }]
      }
    ];
    const geminiResponse = await model.generateContent({
      contents: messages,
    });
    //const responseText = await geminiResponse.text();
   const responseText = geminiResponse.text();
    console.log("Gemini reordered IDs text:", responseText);
    if (!responseText) throw new Error("No content returned from Gemini");
    const cleanedText = responseText.trim().replace(/[^,\[\]"'\w]/g, "").replace(/json/gi, "");
    try {
      const reorderedIds = JSON.parse(cleanedText);
      if (!Array.isArray(reorderedIds)) {
        throw new Error("Invalid response format from Gemini. Expected an array of IDs.");
      }
      return reorderedIds;
    } catch (parseError) {
      console.error("Failed to parse Gemini response:", parseError, "Cleaned Text:", cleanedText);
      throw new Error("Response from Gemini could not be parsed as a valid array.");
    }
  } catch (error) {
    console.error("Error reordering results with Gemini:", error);
    throw error;
  }
}

async function reorderImagesWithGPT(
  combinedResults,
  translatedQuery,
  query,
  alreadyDelivered = []
) {
  try {
    if (!Array.isArray(alreadyDelivered)) alreadyDelivered = [];
    const filteredResults = combinedResults.filter(
      (product) => !alreadyDelivered.includes(product._id.toString())
    );
    const productData = combinedResults.map(product => ({
      id: product._id.toString(),
      name: product.name,
      image: product.image,
      description: product.description1,
    }));
    const imagesToSend = combinedResults.map(product => ({
      imageUrl: product.image || "No image"
    }));
    const messages = [
      {
        role: "user",
        parts: [
          {
            text: `You are an advanced AI model specializing in e-commerce queries. Your role is to analyze the given "${translatedQuery}" along with a list of products (each including only an image), and return the most relevant product IDs based solely on how well the product images match the query.
            
Key Instructions:
1. Ignore pricing details.
2. Output must be a JSON array of IDs with no extra text.
3. Rank strictly by image relevance.
4. Return at least 5 but no more than 8 product IDs.
Example: [ "id1", "id2", "id3", "id4" ]`
          },
          {
            text: JSON.stringify(productData, null, 4),
          },
          {
            text: JSON.stringify({ type: "image_url", images: imagesToSend }, null, 4),
          },
        ],
      },
    ];
    const geminiResponse = await model.generateContent({
      contents: messages,
    });
   // const responseText = await geminiResponse.text();
   const responseText = geminiResponse.text();
    console.log("Gemini image Reordered IDs text:", responseText);
    if (!responseText) throw new Error("No content returned from Gemini");
    const cleanedText = responseText.trim().replace(/[^,\[\]"'\w]/g, "").replace(/json/gi, "");
    try {
      const reorderedIds = JSON.parse(cleanedText);
      if (!Array.isArray(reorderedIds)) {
        throw new Error("Invalid response format from Gemini. Expected an array of IDs.");
      }
      return reorderedIds;
    } catch (parseError) {
      console.error("Failed to parse Gemini response:", parseError, "Cleaned Text:", cleanedText);
      throw new Error("Response from Gemini could not be parsed as a valid array.");
    }
  } catch (error) {
    console.error("Error reordering results with Gemini:", error);
    throw error;
  }
}

async function getProductsByIds(ids, dbName, collectionName) {
  if (!ids || !Array.isArray(ids)) {
    console.error("getProductsByIds: ids is not an array", ids);
    return [];
  }
  try {
    const client = await connectToMongoDB(mongodbUri);
    const db = client.db(dbName);
    const collection = db.collection(collectionName);
    const objectIdArray = ids.map((id) => {
      try {
        return new ObjectId(id);
      } catch (error) {
        console.error(`Invalid ObjectId format: ${id}`);
        return null;
      }
    }).filter((id) => id !== null);
    const products = await collection.find({ _id: { $in: objectIdArray } }).toArray();
    const orderedProducts = ids.map((id) =>
      products.find((p) => p && p._id.toString() === id)
    ).filter((product) => product !== undefined);
    console.log(`Number of products returned: ${orderedProducts.length}/${ids.length}`);
    return orderedProducts;
  } catch (error) {
    console.error("Error fetching products by IDs:", error);
    throw error;
  }
}

async function extractFiltersFromQuery(query, categories, types, example) {
  return {};
}

app.post("/search", async (req, res) => {
  const { query, types, example, noWord, noHebrewWord, context, useImages } = req.body;
  const { dbName, products: collectionName, categories } = req.store;
  console.log("categories", categories);
  if (!query || !dbName || !collectionName) {
    return res.status(400).json({
      error: "Either apiKey **or** (dbName & collectionName) must be provided",
    });
  }
  try {
    const client = await connectToMongoDB(mongodbUri);
    const db = client.db(dbName);
    console.log("Connected to database:", dbName);
    const collection = db.collection("products");
    const querycollection = db.collection("queries");
    const translatedQuery = await translateQuery(query, context);
    if (!translatedQuery)
      return res.status(500).json({ error: "Error translating query" });
    const cleanedText = removeWineFromQuery(translatedQuery, noWord);
    console.log("Cleaned query for embedding:", cleanedText);
    let filters = {};
    if (categories) {
      const regexCategories = extractCategoriesUsingRegex(query, categories);
      if (regexCategories.length > 0) {
        console.log("Categories matched via regex:", regexCategories);
        filters.category = regexCategories;
      }
      const llmFilters = await extractFiltersFromQuery(query, categories, types, example);
      console.log("Filters extracted via LLM:", llmFilters);
      if (llmFilters.category) {
        if (filters.category) {
          filters.category = [...new Set([...filters.category, ...llmFilters.category])];
        } else {
          filters.category = llmFilters.category;
        }
      }
      if (llmFilters.minPrice !== undefined) {
        filters.minPrice = llmFilters.minPrice;
      }
      if (llmFilters.maxPrice !== undefined) {
        filters.maxPrice = llmFilters.maxPrice;
      }
      if (llmFilters.type) {
        filters.type = llmFilters.type;
      }
      if (llmFilters.price) {
        filters.price = llmFilters.price;
      }
    }
    console.log("Final filters:", filters);
    logQuery(querycollection, query, filters);
    const queryEmbedding = await getQueryEmbedding(cleanedText);
    if (!queryEmbedding)
      return res.status(500).json({ error: "Error generating query embedding" });
    const FUZZY_WEIGHT = 1;
    const VECTOR_WEIGHT = 1;
    const RRF_CONSTANT = 60;
    function calculateRRFScore(fuzzyRank, vectorRank, VECTOR_WEIGHT) {
      return (
        FUZZY_WEIGHT * (1 / (RRF_CONSTANT + fuzzyRank)) +
        VECTOR_WEIGHT * (1 / (RRF_CONSTANT + vectorRank))
      );
    }
    const cleanedHebrewText = removeWordsFromQuery(query, noHebrewWord);
    console.log("Cleaned query for fuzzy search:", cleanedHebrewText);
    const fuzzySearchPipeline = buildFuzzySearchPipeline(cleanedHebrewText, query, filters);
    const fuzzyResults = await collection.aggregate(fuzzySearchPipeline).toArray();
    const vectorSearchPipeline = buildVectorSearchPipeline(queryEmbedding, filters);
    const vectorResults = await collection.aggregate(vectorSearchPipeline).toArray();
    const documentRanks = new Map();
    fuzzyResults.forEach((doc, index) => {
      documentRanks.set(doc._id.toString(), { fuzzyRank: index, vectorRank: Infinity });
    });
    vectorResults.forEach((doc, index) => {
      const existingRanks = documentRanks.get(doc._id.toString()) || { fuzzyRank: Infinity, vectorRank: Infinity };
      documentRanks.set(doc._id.toString(), { ...existingRanks, vectorRank: index });
    });
    const combinedResults = Array.from(documentRanks.entries())
      .map(([id, ranks]) => {
        const doc = fuzzyResults.find((d) => d._id.toString() === id) ||
                    vectorResults.find((d) => d._id.toString() === id);
        return { ...doc, rrf_score: calculateRRFScore(ranks.fuzzyRank, ranks.vectorRank, VECTOR_WEIGHT) };
      })
      .sort((a, b) => b.rrf_score - a.rrf_score);
    let reorderedIds;
    try {
      const reorderFn = useImages ? reorderImagesWithGPT : reorderResultsWithGPT;
      reorderedIds = await reorderFn(combinedResults, translatedQuery, query);
    } catch (error) {
      console.error("LLM reordering failed, falling back to default ordering:", error);
      reorderedIds = combinedResults.map((result) => result._id.toString());
    }
    const orderedProducts = await getProductsByIds(reorderedIds, dbName, collectionName);
    const reorderedProductIds = new Set(reorderedIds);
    const remainingResults = combinedResults.filter((r) => !reorderedProductIds.has(r._id.toString()));
    const formattedResults = [];

    for (const product of [...orderedProducts, ...remainingResults]) {
      try {
           const enrichedText = `${product.name}\n${product.description}`;
           const classification = await classifyCategoryAndType(enrichedText, product.name);

           formattedResults.push({
              id: product._id.toString(),
              name: product.name,
              description: product.description,
              price: product.price,
              image: product.image,
              url: product.url,
              onSale: product.onSale,
              type: product.type,
              category: classification?.category || null,
              geminiTypes: classification?.type || [],
           });
      } catch (classificationError) {
           console.error("Classification error:", classificationError);
           formattedResults.push({
              id: product._id.toString(),
              name: product.name,
              description: product.description,
              price: product.price,
              image: product.image,
              url: product.url,
              onSale: product.onSale,
              type: product.type,
              category: null,
              geminiTypes: [],
           });
      }
    }

    res.json(formattedResults);
  } catch (error) {
    console.error("Error handling search request:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Server error." });
    }
  }
});

app.get("/products", async (req, res) => {
  const { dbName, collectionName, limit = 10 } = req.query;
  if (!dbName || !collectionName) {
    return res.status(400).json({ error: "Database name and collection name are required" });
  }
  try {
    const client = await connectToMongoDB(mongodbUri);
    const db = client.db(dbName);
    const collection = db.collection(collectionName);
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
  }
});

app.post("/recommend", async (req, res) => {
  const { productName, dbName, collectionName } = req.body;
  if (!productName) {
    return res.status(400).json({ error: "Product name is required" });
  }
  try {
    const client = await connectToMongoDB(mongodbUri);
    const db = client.db(dbName);
    const collection = db.collection(collectionName);
    const product = await collection.findOne({ name: productName });
    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }
    const { embedding, price } = product;
    const minPrice = price * 0.9;
    const maxPrice = price * 1.1;
    const pipeline = [
      {
        $vectorSearch: {
          index: "vector_index",
          path: "embedding",
          queryVector: embedding,
          numCandidates: 100,
          limit: 10,
        },
      },
      {
        $match: {
          price: { $gte: minPrice, $lte: maxPrice },
        },
      },
    ];
    const similarProducts = await collection.aggregate(pipeline).toArray();
    const results = similarProducts.map((product) => ({
      id: product._id,
      name: product.name,
      description: product.description,
      price: product.price,
      image: product.image,
      url: product.url,
      rrf_score: product.rrf_score,
    }));
    res.json(results);
  } catch (error) {
    console.error("Error fetching recommendations:", error);
    res.status(500).json({ error: "Server error" });
  }
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});