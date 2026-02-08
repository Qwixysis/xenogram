import { auth, db } from './config.js';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const emailInp = document.getElementById('auth-email');
const passInp = document.getElementById('auth-pass');
const nickInp = document.getElementById('auth-nick');
const actionBtn = document.getElementById('auth-action-btn');
const toggleBtn = document.getElementById('auth-toggle');
let isLogin = true;

// Переключение между Входом и Регистрацией
toggleBtn.onclick = () => {
    isLogin = !isLogin;
    document.getElementById('auth-title').innerText = isLogin ? "С возвращением!" : "Создать аккаунт";
    nickInp.style.display = isLogin ? "none" : "block";
    actionBtn.innerText = isLogin ? "Войти" : "Зарегистрироваться";
    document.getElementById('toggle-text').innerHTML = isLogin ? 
        'Нет аккаунта? <span class="link" id="auth-toggle">Зарегистрироваться</span>' : 
        'Уже есть аккаунт? <span class="link" id="auth-toggle">Войти</span>';
};

actionBtn.onclick = async () => {
    const email = emailInp.value;
    const pass = passInp.value;
    const nick = nickInp.value;

    try {
        if (isLogin) {
            await signInWithEmailAndPassword(auth, email, pass);
        } else {
            const res = await createUserWithEmailAndPassword(auth, email, pass);
            // Обновляем профиль в Auth
            await updateProfile(res.user, { displayName: nick });
            // Создаем запись пользователя в Firestore для системы друзей/профилей
            await setDoc(doc(db, "users", res.user.uid), {
                uid: res.user.uid,
                username: nick,
                email: email,
                avatar: "default_avatar.png",
                friends: []
            });
        }
        window.location.href = "index.html";
    } catch (err) {
        alert("Ошибка: " + err.message);
    }
};