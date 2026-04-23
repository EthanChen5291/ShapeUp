import { initializeApp, getApps } from "firebase/app";
import {
  getFirestore,
  collection,
  doc,
  addDoc,
  updateDoc,
  getDocs,
  query,
  orderBy,
  serverTimestamp,
  arrayUnion,
} from "firebase/firestore";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyBpPBNWykdZZ6ukjelAA3xjMUMNMowwZb4",
  authDomain: "hackprinceton-shapeup.firebaseapp.com",
  projectId: "hackprinceton-shapeup",
  storageBucket: "hackprinceton-shapeup.firebasestorage.app",
  messagingSenderId: "379851512921",
  appId: "1:379851512921:web:9cbda9756068b53c4e6548",
  measurementId: "G-6GYG8QNW3H",
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);

export { db, collection, doc, addDoc, updateDoc, getDocs, query, orderBy, serverTimestamp, arrayUnion };

export async function uploadAndGetUrl(
  storagePath: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  const storageRef = ref(storage, storagePath);
  await uploadBytes(storageRef, buffer, { contentType });
  return getDownloadURL(storageRef);
}
