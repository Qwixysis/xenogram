import { auth, db } from "./firebase.js";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, updateProfile } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

export function showToast(message, type = "info") {
    let container = document.getElementById("toastContainer");
    if (!container) {
        container = document.createElement("div");
        container.id = "toastContainer";
        container.className = "toast-container";
        document.body.appendChild(container);
    }
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.innerHTML = message;
    container.appendChild(toast);
    setTimeout(() => toast.classList.add("show"), 10);
    setTimeout(() => {
        toast.classList.remove("show");
        toast.classList.add("hide");
        setTimeout(() => toast.remove(), 400);
    }, 3000);
}

document.addEventListener("DOMContentLoaded", () => {
    const loginBtn = document.getElementById("loginBtn");
    const regBtn = document.getElementById("regBtn");

    if (loginBtn) {
        loginBtn.onclick = async () => {
            const email = document.getElementById("email").value.trim();
            const pass = document.getElementById("password").value;
            if (!email || !pass) {
                showToast("Заполните все поля", "error");
                return;
            }
            const originalText = loginBtn.textContent;
            loginBtn.textContent = "Подключение...";
            loginBtn.disabled = true;
            try {
                await signInWithEmailAndPassword(auth, email, pass);
                showToast("Успешный вход!", "success");
                window.location.href = "app.html";
            } catch (err) {
                showToast("Ошибка: " + err.message, "error");
            } finally {
                loginBtn.textContent = originalText;
                loginBtn.disabled = false;
            }
        };
    }

    if (regBtn) {
        regBtn.onclick = async () => {
            const email = document.getElementById("email").value.trim();
            const pass = document.getElementById("password").value;
            if (!email || !pass) {
                showToast("Заполните все поля", "error");
                return;
            }
            const originalText = regBtn.textContent;
            regBtn.textContent = "Создание...";
            regBtn.disabled = true;
            try {
                const res = await createUserWithEmailAndPassword(auth, email, pass);
                const defaultNick = email.split('@')[0];
                await updateProfile(res.user, { displayName: defaultNick });
                // Создаём документ пользователя
                await setDoc(doc(db, "users", res.user.uid), {
                    uid: res.user.uid,
                    email: email,
                    nick: defaultNick,
                    photoURL: "",
                    friends: [],
                    pending: [],
                    requestsSent: [],
                    online: true,
                    lastSeen: serverTimestamp(),
                    customStatus: "",
                    settings: { hideOnline: false, friendsOnly: false, sound: true }
                });
                showToast("Аккаунт создан!", "success");
                window.location.href = "app.html";
            } catch (err) { 
                showToast(err.message, "error");
            } finally {
                regBtn.textContent = originalText;
                regBtn.disabled = false;
            }
        };
    }
});

// Если пользователь уже залогинен, но документа нет – перенаправляем на создание? Нет, создадим в app.html.
// Но для чистоты: при попытке открыть index.html с залогиненным пользователем – редирект.
onAuthStateChanged(auth, user => {
    const path = window.location.pathname;
    if (user && (path.endsWith("index.html") || path === "/" || path === "")) {
        window.location.href = "app.html";
    }
});
