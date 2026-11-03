import mongoose from "mongoose";

export async function connectDatabase(): Promise<void> {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error("MONGO_URI is not defined in .env");
  }

  await mongoose.connect(uri, {
    // Atlas-friendly options
  } as any);
  console.log(`[Database] Connected to MongoDB Atlas`);
}
