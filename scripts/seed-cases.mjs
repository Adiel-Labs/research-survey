import "dotenv/config";

import { createClient } from "@supabase/supabase-js";
import { initializeApp } from "firebase/app";
import { addDoc, collection, getDocs } from "firebase/firestore";
import { getFirestore } from "firebase/firestore";

const SUPABASE_BUCKET = "annotate-images";
const NOT_REVIEWED_PREFIX = "NotReviewed";

const requiredVars = [
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_ANON_KEY",
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_APP_ID",
];

for (const key of requiredVars) {
  if (!process.env[key]) {
    throw new Error(`Missing required env var: ${key}`);
  }
}

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY,
);

const firebaseApp = initializeApp({
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
});
const db = getFirestore(firebaseApp);

async function listFolderRecursive(prefix) {
  const { data, error } = await supabase.storage
    .from(SUPABASE_BUCKET)
    .list(prefix, {
      limit: 1000,
      sortBy: { column: "name", order: "asc" },
    });

  if (error) {
    throw new Error(`Failed to list "${prefix}": ${error.message}`);
  }

  const paths = [];
  for (const entry of data) {
    const nextPath = `${prefix}/${entry.name}`;
    if (entry.metadata) {
      paths.push(nextPath);
    } else {
      const nested = await listFolderRecursive(nextPath);
      paths.push(...nested);
    }
  }
  return paths;
}

function getPublicUrl(path) {
  const { data } = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

async function run() {
  const snapshot = await getDocs(collection(db, "cases"));
  const existingPaths = new Set(
    snapshot.docs
      .map((item) => item.data().imagePath)
      .filter((value) => typeof value === "string"),
  );

  const imagePaths = await listFolderRecursive(NOT_REVIEWED_PREFIX);

  let inserted = 0;
  let skipped = 0;
  const now = new Date().toISOString();

  for (const imagePath of imagePaths) {
    if (existingPaths.has(imagePath)) {
      skipped += 1;
      continue;
    }

    const maybeCaseId = imagePath.split("/")[1];
    const caseId =
      maybeCaseId && maybeCaseId.length > 0 ? maybeCaseId : crypto.randomUUID();

    await addDoc(collection(db, "cases"), {
      caseId,
      imageProvider: "supabase",
      imageBucket: SUPABASE_BUCKET,
      imagePath,
      imagePublicUrl: getPublicUrl(imagePath),
      source: "intraoral",
      originalAnnotations: [],
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });

    existingPaths.add(imagePath);
    inserted += 1;
  }

  console.log(
    `Seed completed. Inserted: ${inserted}, skipped existing: ${skipped}.`,
  );
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
