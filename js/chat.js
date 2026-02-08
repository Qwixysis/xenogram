import { db, auth } from './config.js';
import { collection, addDoc, serverTimestamp, query, orderBy, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const msgForm = document.getElementById('message-form');
const msgInput = document.getElementById('message-input');
const msgDisplay = document.getElementById('messages-display');

// Отправка
msgForm.onsubmit = async (e) => {
    e.preventDefault();
    if (msgInput.value.trim() === "") return;

    await addDoc(collection(db, "messages"), {
        text: msgInput.value,
        uid: auth.currentUser.uid,
        userName: auth.currentUser.displayName || "Аноним",
        createdAt: serverTimestamp()
    });
    msgInput.value = "";
};

// Слушатель сообщений (Real-time)
const q = query(collection(db, "messages"), orderBy("createdAt", "asc"));
onSnapshot(q, (snapshot) => {
    msgDisplay.innerHTML = "";
    snapshot.forEach(doc => {
        const data = doc.data();
        const div = document.createElement('div');
        div.className = 'message-bubble';
        div.innerHTML = `<b>${data.userName}</b>: ${data.text}`;
        msgDisplay.appendChild(div);
    });
});