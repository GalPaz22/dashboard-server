import express from "express";
import bodyParser from "body-parser";
import { MongoClient, ObjectId } from "mongodb";
import { OpenAI } from "openai";
import cors from "cors";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";

dotenv.config();

const app = express();
app.use(bodyParser.json());
app.use(cors({ origin: "*" }));

// Initialize Google Generative AI client
const genAI = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

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
    types: userDoc.credentials?.type || "",
    syncMode: userDoc.syncMode || "text",
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
  // Safely handle input categories
  let catArray = [];
  if (Array.isArray(categories)) {
    catArray = categories;
  } else if (typeof categories === "string") {
    catArray = categories.split(",").map(cat => cat.trim()).filter(cat => cat.length > 0);
  }
  
  // Sort by length (longest first) to match most specific categories first
  catArray.sort((a, b) => b.length - a.length);

  // First try exact matches
  for (const cat of catArray) {
    // Use word boundaries and escaped category string
    const escapedCat = cat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regexFull = new RegExp(`(^|\\s)${escapedCat}($|\\s)`, "iu");
    if (regexFull.test(query)) {
      return [cat];
    }
  }

  // If no exact matches, try partial matches with whole words only
  const partialMatches = [];
  const matchedPhrases = new Set();

  for (const cat of catArray) {
    const words = cat.split(/\s+/);
    let matchedWordsCount = 0;
    const matchedWords = [];

    // Only process categories with multiple words
    if (words.length > 1) {
      for (const word of words) {
        if (word.length < 2) continue;
        
        // Escape special characters in the word
        const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Use word boundaries to match whole words only
        const regexPartial = new RegExp(`(^|\\s)${escapedWord}($|\\s)`, "iu");
        
        if (regexPartial.test(query)) {
          matchedWordsCount++;
          matchedWords.push(word);
        }
      }

      // Calculate match quality
      const matchRatio = matchedWordsCount / words.length;
      if (matchRatio >= 0.5) {  // At least half of the words must match
        const matchedPhrase = matchedWords.sort().join(" ");
        if (!matchedPhrases.has(matchedPhrase)) {
          matchedPhrases.add(matchedPhrase);
          partialMatches.push({
            category: cat,
            matchRatio,
            specificity: words.length
          });
        }
      }
    }
  }

  // Sort partial matches by match ratio and specificity
  partialMatches.sort((a, b) => {
    if (b.matchRatio !== a.matchRatio) return b.matchRatio - a.matchRatio;
    return b.specificity - a.specificity;
  });

  // Return best partial match if it's significantly better than others
  if (partialMatches.length > 0 &&
      partialMatches[0].matchRatio >= 0.7 &&
      (partialMatches.length === 1 || partialMatches[0].matchRatio > partialMatches[1].matchRatio)) {
    return [partialMatches[0].category];
  }

  // If no good matches found, return empty array
  return [];
}

const buildFuzzySearchPipeline = (cleanedHebrewText, query, filters) => {
  console.log("Building fuzzy search pipeline with filters:", JSON.stringify(filters));
  
  const pipeline = [];
  
  // Only add the $search stage if we have a non-empty search query
  if (cleanedHebrewText && cleanedHebrewText.trim() !== '') {
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
                score: { boost: { value: 5 } } // Boost for the "name" field
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
          filter: [] // We're not using compound.filter - handling filters in separate $match stages
        }
      }
    });
  } else {
    // If no search query is provided, start with a simple $match stage
    pipeline.push({ $match: {} });
  }

  // Handle stock status filter first
  pipeline.push({
    $match: {
      $or: [
        { stockStatus: { $exists: false } },
        { stockStatus: "instock" }
      ],
    },
  });

  // Now handle the other filters - create a separate match stage for price
// ...existing code...
  // Now handle the other filters - create a separate match stage for price
  if (filters && Object.keys(filters).length > 0) {
    // Type filter: support string or array without using regex
    if (filters.type) {
      pipeline.push({
        $match: {
          category: Array.isArray(filters.type) 
            ? { $in: filters.type } 
            : filters.type
        }
      });
    }
    // ...existing code...
    
    // Category filter
    if (filters.category) {
      pipeline.push({
        $match: {
          category: Array.isArray(filters.category) 
            ? { $in: filters.category } 
            : filters.category
        }
      });
    }
    
    // Price filters - ensure all values are converted to numbers
    const priceMatch = {};
    let hasPriceFilter = false;
    
    if (filters.minPrice !== undefined && filters.maxPrice !== undefined) {
      priceMatch.$gte = Number(filters.minPrice);
      priceMatch.$lte = Number(filters.maxPrice);
      hasPriceFilter = true;
    } else if (filters.minPrice !== undefined) {
      priceMatch.$gte = Number(filters.minPrice);
      hasPriceFilter = true;
    } else if (filters.maxPrice !== undefined) {
      priceMatch.$lte = Number(filters.maxPrice);
      hasPriceFilter = true;
    } else if (filters.price !== undefined) {
      const price = Number(filters.price);
      const priceRange = price * 0.15;
      priceMatch.$gte = Math.max(0, price - priceRange); // Ensure price is not negative
      priceMatch.$lte = price + priceRange;
      hasPriceFilter = true;
      
      console.log(`Price filter range: ${priceMatch.$gte} to ${priceMatch.$lte}`);
    }
    
    // Add the price match stage if we have price filters
    if (hasPriceFilter) {
      pipeline.push({
        $match: {
          price: priceMatch
        }
      });
    }
  }
  
  // Add limit at the end
  pipeline.push({ $limit: 1000 });
  
  // Log the pipeline for debugging
  console.log("Fuzzy search pipeline:", JSON.stringify(pipeline));
  
  return pipeline;
};

function buildVectorSearchPipeline(queryEmbedding, filters = {}) {
  const filter = {};

  if (filters.category) {
    filter.category = Array.isArray(filters.category)
      ? { $in: filters.category }
      : filters.category;
  }

  if (filters.type) {
    filter.type = Array.isArray(filters.type)
      ? { $in: filters.type }
      : filters.type;
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
        limit: 30,
        ...(Object.keys(filter).length && { filter }),
      },
    },
  ];
  
  const postMatchClauses = [];
  postMatchClauses.push({
    $or: [
      { stockStatus: "instock" },
      { stockStatus: { $exists: false } },
    ],
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
      model: "gpt-4.1",
      temperature: 0.1,
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
Pay attention to the word שכלי or שאבלי (which mean chablis) and מוסקדה for muscadet.`
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
async function extractFiltersFromQuery(query, categories, types, example) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4.1",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `Extract the following filters from the query if they exist:
                  1. price (exact price, indicated by the words 'ב' or 'באיזור ה-').
                  2. minPrice (minimum price, indicated by 'החל מ' or 'מ').
                  3. maxPrice (maximum price, indicated by the word 'עד').
                  4. category - one of the following Hebrew words: ${categories}. Pay close attention to find these categories in the query, and look if the user mentions a shortened version (e.g., 'רוזה' instead of 'יין רוזה')- in case you can't find the relevant category, do not bring up by yourself.
                  **if you find more than one category, return them as an array**.
                  5. type - one or both of the following Hebrew words: ${types}. Pay close attention to find these types in the query.
                Return the extracted filters in JSON format. If a filter is not present in the query, omit it from the JSON response. For example:
               ${example}.` },
        { role: "user", content: query },
      ],
      temperature: 0.1,
    });

    const content = response.choices[0]?.message?.content;
    const filters = JSON.parse(content);
    console.log("Extracted filters:", filters);
    return filters;
  } catch (error) {
    console.error("Error extracting filters:", error);
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

// --- 2) reorderResultsWithGPT ---
async function reorderResultsWithGPT(
  combinedResults,
  translatedQuery,
  query,
  alreadyDelivered = []
) {
  try {
    const filtered = combinedResults.filter(
      (p) => !alreadyDelivered.includes(p._id.toString())
    );
    
    // Only consider the first 50 results for LLM reordering
    const limitedResults = filtered.slice(0, 25);
    
    const productData = limitedResults.map((p) => ({
      id: p._id.toString(),
      name: p.name || "No name",
      description: p.description1 || "No description",
    }));

    const systemInstruction = `
You are an advanced AI model specializing in e-commerce queries.
Your task: given the user query "${query}" and this list of products (with name & description),
return a JSON array of objects. Each object must contain a product ID ('id') and a brief, one-sentence explanation ('explanation') of why this product is relevant.
The explanation MUST be in the same language as the user's original query.
Order the products by relevance. Only return the most relevant products.`;

    const userContent = JSON.stringify(productData, null, 4);

    const response = await genAI.models.generateContent({
      model: "gemini-2.5-flash",
      contents: userContent,
      config: { 
        systemInstruction, 
        temperature: 0.1,
        thinkingConfig: {
          thinkingBudget: 0, // Disables thinking
        },
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: {
                type: Type.STRING,
                description: "Product ID",
              },
              explanation: {
                type: Type.STRING,
                description:
                  "Brief explanation of product relevance for the query, in the query's language.",
              },
            },
          },
        },
      },
    });

    const text = response.text.trim();
    console.log("Gemini Reordered data with explanations:", text);
    const reorderedData = JSON.parse(text);
    if (!Array.isArray(reorderedData)) throw new Error("Unexpected format");
    return reorderedData;
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
   if (!Array.isArray(alreadyDelivered)) {
     alreadyDelivered = [];
   }

   const filteredResults = combinedResults.filter(
     (product) => !alreadyDelivered.includes(product._id.toString())
   );

   // Only consider the first 50 results for LLM reordering
   const limitedResults = filteredResults.slice(0, 25);

   // Filter products that have images
   const productsWithImages = limitedResults.filter(product => product.image && product.image.trim() !== '');

   if (productsWithImages.length === 0) {
     console.log("No products with images found, falling back to text-based reordering");
     return await reorderResultsWithGPT(combinedResults, translatedQuery, query, alreadyDelivered);
   }

   // Prepare content array for Gemini API
   const contents = [];
   
   // Add the query text first
   contents.push({ text: `You are analyzing products for the query: "${translatedQuery}" (original: "${query}")` });
   
   // Add products with images
   for (let i = 0; i < Math.min(productsWithImages.length, 20); i++) { // Limit to 20 products to avoid token limits
     const product = productsWithImages[i];
     
     try {
       // Fetch image and convert to base64
       const response = await fetch(product.image);
       if (response.ok) {
         const imageArrayBuffer = await response.arrayBuffer();
         const base64ImageData = Buffer.from(imageArrayBuffer).toString('base64');
         
         // Add image to contents
         contents.push({
           inlineData: {
             mimeType: 'image/jpeg',
             data: base64ImageData,
           },
         });
         
         // Add product details
         contents.push({ 
           text: `Product ID: ${product._id.toString()}
Name: ${product.name || "No name"}
Description: ${product.description1 || "No description"}
---` 
         });
       }
     } catch (imageError) {
       console.error(`Failed to fetch image for product ${product._id}:`, imageError);
       // Skip this product if image fails
     }
   }

   // Add final instruction
   contents.push({ 
     text: `Based on the query "${translatedQuery}" (original: "${query}") and the product images and descriptions shown above, return a JSON array of objects. Each object must contain a product ID ('id') and a brief, one-sentence explanation ('explanation') of why this product is relevant to the query, focusing primarily on how well the product images match the query context. The explanation MUST be in the same language as the original user query. Return 5-8 of the most relevant product IDs only.` 
   });

   const response = await genAI.models.generateContent({
     model: "gemini-2.5-flash",
     contents: contents,
     config: { 
       temperature: 0.1,
       thinkingConfig: {
         thinkingBudget: 0, // Disables thinking
       },
       responseMimeType: "application/json",
       responseSchema: {
         type: Type.ARRAY,
         items: {
           type: Type.OBJECT,
           properties: {
             id: {
               type: Type.STRING,
               description: "Product ID",
             },
             explanation: {
               type: Type.STRING,
               description:
                 "Brief explanation of product relevance for the query, in the query's language.",
             },
           },
         },
       },
     },
   });

   const responseText = response.text.trim();
   console.log("Gemini Image-based Reordered data:", responseText);

   if (!responseText) {
     throw new Error("No content returned from Gemini");
   }

   const reorderedData = JSON.parse(responseText);
   if (!Array.isArray(reorderedData)) {
     throw new Error("Invalid response format from Gemini. Expected an array of objects.");
   }
   return reorderedData;
 } catch (error) {
   console.error("Error reordering results with Gemini image analysis:", error);
   console.log("Falling back to text-based reordering");
   return await reorderResultsWithGPT(combinedResults, translatedQuery, query, alreadyDelivered);
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

// Function to detect if query is complex enough for LLM reordering
function isComplexQuery(query, filters) {
  // Only skip LLM for exact category matches (no additional descriptors)
  if (filters.category && !filters.price && !filters.minPrice && !filters.maxPrice && !filters.type) {
    // Check if query is EXACTLY just the category (no additional descriptors)
    const queryWords = query.toLowerCase().trim().split(/\s+/);
    const categories = Array.isArray(filters.category) ? filters.category : [filters.category];
    
    // Check if the query is exactly matching one of the categories
    for (const category of categories) {
      const categoryWords = category.toLowerCase().split(/\s+/);
      // Only skip LLM if query is exactly the category (same words, same count)
      if (queryWords.length === categoryWords.length && 
          queryWords.every(word => categoryWords.includes(word))) {
        return false; // Simple exact category match - use RRF only
      }
    }
  }
  
  // For everything else, use LLM reordering
  return true;
}


app.post("/search", async (req, res) => {
  const { query, example, noWord, noHebrewWord, context, useImages } = req.body;
  const { dbName, products: collectionName, categories, types, syncMode } = req.store;
  console.log("categories", categories);
  console.log("types", types);
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
    let reorderedData;
    
    // Only apply LLM reordering for complex queries
    if (isComplexQuery(query, filters)) {
      console.log("Complex query detected - applying LLM reordering");
      try {
        const reorderFn = syncMode=='image' ? reorderImagesWithGPT : reorderResultsWithGPT;
        reorderedData = await reorderFn(combinedResults, translatedQuery, query);
      } catch (error) {
        console.error("LLM reordering failed, falling back to default ordering:", error);
        reorderedData = combinedResults.map((result) => ({ id: result._id.toString(), explanation: null }));
      }
    } else {
      console.log("Simple query detected - using RRF ordering without LLM");
      reorderedData = combinedResults.map((result) => ({ id: result._id.toString(), explanation: null }));
    }
    const reorderedIds = reorderedData.map(item => item.id);
    const explanationsMap = new Map(reorderedData.map(item => [item.id, item.explanation]));
    const orderedProducts = await getProductsByIds(reorderedIds, dbName, collectionName);
    const reorderedProductIds = new Set(reorderedIds);
    const remainingResults = combinedResults.filter((r) => !reorderedProductIds.has(r._id.toString()));
     
    const formattedResults = [
      ...orderedProducts.map((product) => ({
        id: product.id,
        name: product.name,
        description: product.description,
        price: product.price,
        image: product.image,
        url: product.url,
        highlight: true,
        type: product.type,
        specialSales: product.specialSales,
        ItemID: product.ItemID,
        explanation: explanationsMap.get(product._id.toString()) || null
       

      })),
      ...remainingResults.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        price: r.price,
        image: r.image,
        url: r.url,
        type: r.type,
        specialSales: r.specialSales,
        ItemID: r.ItemID,
        highlight: false,
        explanation: null
   
      })),
    ];

    console.log(`Returning ${formattedResults.length} results for query: ${query}`);

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

app.post("/search-to-cart", async (req, res) => {
  try {
    // Get API key from header
    const apiKey = req.get("x-api-key");
    
    // Validate API key using existing authentication function
    const store = await getStoreConfigByApiKey(apiKey);
    
    if (!apiKey || !store) {
      return res.status(401).json({ error: "Invalid or missing API key" });
    }
    
    // Get DB name from store config
    const { dbName } = store;
    
    // Get data from request body
    const { document } = req.body;
    
    // Validate required fields
    if (!document || !document.search_query || !document.product_id) {
      return res.status(400).json({ error: "Missing required fields in document" });
    }
    
    // Connect to MongoDB
    const client = await connectToMongoDB(mongodbUri);
    const db = client.db(dbName);
    const cartCollection = db.collection('cart');
    
    // Add timestamp if not provided
    if (!document.timestamp) {
      document.timestamp = Math.floor(Date.now() / 1000);
    }
    
    // Insert the document into the cart collection
    const result = await cartCollection.insertOne(document);
    
    // Return success response
    res.status(201).json({
      success: true,
      message: "Search-to-cart event saved successfully",
      id: result.insertedId
    });
    
  } catch (error) {
    console.error("Error saving search-to-cart event:", error);
    res.status(500).json({ error: "Server error" });
  }
});



const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});