// Single shared Mongo client for the whole agent run (mirrors server.js pooling).
import { MongoClient } from "mongodb";
import { config } from "./config.mjs";

let client = null;

export async function getClient() {
  if (client) return client;
  client = new MongoClient(config.mongodbUri, {
    maxPoolSize: 10,
    minPoolSize: 2,
    serverSelectionTimeoutMS: 15000,
  });
  await client.connect();
  return client;
}

export async function closeClient() {
  if (client) {
    await client.close();
    client = null;
  }
}
