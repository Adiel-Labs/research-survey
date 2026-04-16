import "dotenv/config";

import { initializeApp } from "firebase/app";
import { collection, deleteDoc, getDocs } from "firebase/firestore";
import { getFirestore } from "firebase/firestore";

const requiredVars = [
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

const firebaseApp = initializeApp({
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
});
const db = getFirestore(firebaseApp);

async function run() {
  const snapshot = await getDocs(collection(db, "cases"));

  if (snapshot.empty) {
    console.log('No documents found in "cases". Nothing to clean.');
    return;
  }

  await Promise.all(snapshot.docs.map((docRef) => deleteDoc(docRef.ref)));

  console.log(`Clean completed. Deleted ${snapshot.size} documents from "cases".`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
