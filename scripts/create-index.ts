import { Pinecone } from "@pinecone-database/pinecone";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const INDEX_NAME = process.env.PINECONE_INDEX || "legacylens";
const EMBEDDING_DIMENSIONS = 1536;

async function createIndex() {
  const pinecone = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY!,
  });

  const existingIndexes = await pinecone.listIndexes();
  const indexExists = existingIndexes.indexes?.some(
    (idx) => idx.name === INDEX_NAME
  );

  if (indexExists) {
    console.log(`Index "${INDEX_NAME}" already exists.`);
    const index = pinecone.index(INDEX_NAME);
    const stats = await index.describeIndexStats();
    console.log("Stats:", JSON.stringify(stats, null, 2));
    return;
  }

  console.log(
    `Creating index "${INDEX_NAME}" with ${EMBEDDING_DIMENSIONS} dimensions...`
  );
  await pinecone.createIndex({
    name: INDEX_NAME,
    dimension: EMBEDDING_DIMENSIONS,
    metric: "cosine",
    spec: {
      serverless: {
        cloud: "aws",
        region: "us-east-1",
      },
    },
  });

  console.log(`Index "${INDEX_NAME}" created successfully.`);
}

createIndex().catch(console.error);
