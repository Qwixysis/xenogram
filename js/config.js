import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

const firebaseConfig = {
    apiKey: "AIzaSyDqH9q3k1Ekl5KxxpBkFEm9OxgCtixshJY",
    authDomain: "xenogram-4a1c0.firebaseapp.com",
    projectId: "xenogram-4a1c0",
    storageBucket: "xenogram-4a1c0.firebasestorage.app",
    messagingSenderId: "219275152669",
    appId: "1:219275152669:web:ee7d63910d3a8e4ff065f4",
    measurementId: "G-2B2ZX9HSF9"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);