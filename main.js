import { auth, db, storage } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
  doc, getDoc, updateDoc, arrayUnion, arrayRemove, onSnapshot, 
  collection, addDoc, serverTimestamp, query, orderBy, setDoc 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

// ========== Глобальные переменные ==========
let currentUser = null;
let currentChatUid = null;           // uid друга, с которым открыт чат
let unsubscribeChat = null;
let unsubscribeFriends = null;
let unsubscribePending = null;
let unsubscribePresence = {};

// ========== Инициализация ==========
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }
  currentUser = user;
  document.getElementById("userNick").textContent = user.displayName || user.email;
  document.getElementById("userUid").textContent = user.uid;
  document.getElementById("userAvatar").textContent = (user.displayName?.[0] || user.email?.[0] || "?").toUpperCase();

  // Загружаем список друзей и запросов
  loadFriends();
  loadPending();

  // Устанавливаем статус онлайн
  await setUserOnline(true);
  // При закрытии вкладки ставим офлайн
  window.addEventListener("beforeunload", () => setUserOnline(false));
});

async function setUserOnline(online) {
  if (!currentUser) return;
  const userRef = doc(db, "users", currentUser.uid);
  await updateDoc(userRef, {
    online: online,
    lastSeen: serverTimestamp()
  });
}

// ========== Загрузка друзей и запросов ==========
async function loadFriends() {
  if (!currentUser) return;
  const userRef = doc(db, "users", currentUser.uid);
  unsubscribeFriends = onSnapshot(userRef, (snap) => {
    const data = snap.data();
    if (!data) return;
    const friendsUids = data.friends || [];
    const friendsList = document.getElementById("friendsList");
    friendsList.innerHTML = "";

    // Для каждого uid друга получаем его данные (ник, аватар, онлайн)
    friendsUids.forEach(async (friendUid) => {
      const friendSnap = await getDoc(doc(db, "users", friendUid));
      if (!friendSnap.exists()) return;
      const friend = friendSnap.data();
      const li = document.createElement("li");
      li.setAttribute("data-uid", friendUid);
      li.onclick = () => openChat(friendUid, friend.nick, friend.photoURL);

      const avatar = friend.photoURL 
        ? `<img src="${friend.photoURL}" class="avatar">`
        : `<div class="avatar">${(friend.nick?.[0] || "?").toUpperCase()}</div>`;

      const statusClass = friend.online ? "online-indicator" : "offline-indicator";
      
      li.innerHTML = `
        ${avatar}
        <span>${friend.nick || friendUid}</span>
        <span class="${statusClass}"></span>
      `;
      friendsList.appendChild(li);
    });
  });
}

async function loadPending() {
  if (!currentUser) return;
  const userRef = doc(db, "users", currentUser.uid);
  unsubscribePending = onSnapshot(userRef, (snap) => {
    const data = snap.data();
    if (!data) return;
    const pendingUids = data.pending || [];
    const pendingList = document.getElementById("pendingList");
    pendingList.innerHTML = "";

    pendingUids.forEach(async (uid) => {
      const userSnap = await getDoc(doc(db, "users", uid));
      if (!userSnap.exists()) return;
      const userData = userSnap.data();
      const li = document.createElement("li");
      li.style.display = "flex";
      li.style.justifyContent = "space-between";
      li.style.alignItems = "center";

      li.innerHTML = `
        <span>${userData.nick || uid}</span>
        <button onclick="acceptFriendRequest('${uid}')" style="background: var(--accent); padding: 4px 12px;">✓</button>
      `;
      pendingList.appendChild(li);
    });
  });
}

// ========== Принять запрос в друзья ==========
window.acceptFriendRequest = async (friendUid) => {
  if (!currentUser) return;
  const myUid = currentUser.uid;

  // Добавляем друг друга в массивы friends
  await updateDoc(doc(db, "users", myUid), {
    friends: arrayUnion(friendUid),
    pending: arrayRemove(friendUid)
  });
  await updateDoc(doc(db, "users", friendUid), {
    friends: arrayUnion(myUid),
    requestsSent: arrayRemove(myUid)
  });

  // Автоматически открываем чат с этим другом
  const friendSnap = await getDoc(doc(db, "users", friendUid));
  if (friendSnap.exists()) {
    const friend = friendSnap.data();
    openChat(friendUid, friend.nick, friend.photoURL);
  }
};

// ========== Открыть чат с другом ==========
async function openChat(friendUid, friendNick, friendPhoto) {
  if (currentChatUid === friendUid) return;
  currentChatUid = friendUid;

  document.getElementById("chatHeader").innerHTML = `
    <div style="display: flex; align-items: center; gap: 10px;">
      ${friendPhoto ? `<img src="${friendPhoto}" style="width: 32px; height: 32px; border-radius: 50%;">` : `<div class="avatar">${(friendNick?.[0] || "?").toUpperCase()}</div>`}
      <span>${friendNick || friendUid}</span>
    </div>
  `;
  document.getElementById("messageInputArea").style.display = "flex";

  // Отписываемся от предыдущего чата
  if (unsubscribeChat) unsubscribeChat();

  const chatId = [currentUser.uid, friendUid].sort().join("_");
  const messagesRef = collection(db, "privateMessages", chatId, "messages");
  const q = query(messagesRef, orderBy("timestamp"));

  unsubscribeChat = onSnapshot(q, (snapshot) => {
    const chatBox = document.getElementById("chatBox");
    chatBox.innerHTML = "";
    snapshot.forEach((doc) => {
      const msg = doc.data();
      const isOutgoing = msg.senderUid === currentUser.uid;
      const senderNick = msg.senderNick || (isOutgoing ? currentUser.displayName : friendNick);
      const senderPhoto = isOutgoing ? (currentUser.photoURL || "") : (friendPhoto || "");

      const msgDiv = document.createElement("div");
      msgDiv.className = `message ${isOutgoing ? "outgoing" : "incoming"}`;

      let content = "";
      if (msg.text) {
        content = msg.text;
      } else if (msg.mediaUrl) {
        if (msg.mediaType === "image") {
          content = `<img src="${msg.mediaUrl}" alt="image" style="max-width: 200px; max-height: 200px;">`;
        } else if (msg.mediaType === "video") {
          content = `<video src="${msg.mediaUrl}" controls style="max-width: 250px;"></video>`;
        }
      }

      const time = msg.timestamp?.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) || "";

      msgDiv.innerHTML = `
        <div class="sender">
          ${senderPhoto ? `<img src="${senderPhoto}">` : ""}
          ${senderNick}
          <span class="timestamp">${time}</span>
        </div>
        ${content}
      `;
      chatBox.appendChild(msgDiv);
    });
    chatBox.scrollTop = chatBox.scrollHeight;
  });
}

// ========== Отправка текстового сообщения ==========
window.sendMessage = async () => {
  const input = document.getElementById("chatInput");
  const text = input.value.trim();
  if (!text || !currentChatUid || !currentUser) return;

  const chatId = [currentUser.uid, currentChatUid].sort().join("_");
  await addDoc(collection(db, "privateMessages", chatId, "messages"), {
    senderUid: currentUser.uid,
    senderNick: currentUser.displayName || currentUser.email,
    text: text,
    timestamp: serverTimestamp()
  });
  input.value = "";
};

// ========== Отправка медиа ==========
document.getElementById("mediaInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file || !currentChatUid || !currentUser) return;

  // Проверка размера (макс 5 MB)
  if (file.size > 5 * 1024 * 1024) {
    alert("Файл слишком большой! Макс 5 MB.");
    return;
  }

  const isImage = file.type.startsWith("image/");
  const isVideo = file.type.startsWith("video/");
  if (!isImage && !isVideo) {
    alert("Можно отправлять только фото или видео.");
    return;
  }

  // Проверка дневных лимитов
  const today = new Date().toISOString().split("T")[0];
  const limitRef = doc(db, "dailyLimits", currentUser.uid + "_" + today);
  const limitSnap = await getDoc(limitRef);
  let limits = { photos: 0, videos: 0 };
  if (limitSnap.exists()) limits = limitSnap.data();

  if (isImage && limits.photos >= 10) {
    alert("Лимит фото на сегодня исчерпан (10 шт).");
    return;
  }
  if (isVideo && limits.videos >= 3) {
    alert("Лимит видео на сегодня исчерпан (3 шт).");
    return;
  }

  // Загрузка в Storage
  const storageRef = ref(storage, `media/${currentUser.uid}/${Date.now()}_${file.name}`);
  await uploadBytes(storageRef, file);
  const url = await getDownloadURL(storageRef);

  const chatId = [currentUser.uid, currentChatUid].sort().join("_");
  await addDoc(collection(db, "privateMessages", chatId, "messages"), {
    senderUid: currentUser.uid,
    senderNick: currentUser.displayName || currentUser.email,
    mediaUrl: url,
    mediaType: isImage ? "image" : "video",
    timestamp: serverTimestamp()
  });

  // Обновляем лимиты
  await setDoc(limitRef, {
    photos: isImage ? limits.photos + 1 : limits.photos,
    videos: isVideo ? limits.videos + 1 : limits.videos
  }, { merge: true });

  document.getElementById("mediaInput").value = "";
});

// ========== Друзья ==========
window.openFriendModal = () => {
  document.getElementById("friendModal").style.display = "block";
};
window.closeFriendModal = () => {
  document.getElementById("friendModal").style.display = "none";
  document.getElementById("friendError").textContent = "";
};

window.sendFriendRequest = async () => {
  const friendUid = document.getElementById("friendUidInput").value.trim();
  const errorEl = document.getElementById("friendError");
  if (!friendUid) return;

  if (friendUid === currentUser.uid) {
    errorEl.textContent = "Нельзя добавить самого себя";
    return;
  }

  const friendRef = doc(db, "users", friendUid);
  const friendSnap = await getDoc(friendRef);
  if (!friendSnap.exists()) {
    errorEl.textContent = "Пользователь с таким UID не найден";
    return;
  }

  // Добавляем запрос в pending у друга и в requestsSent у себя
  await updateDoc(friendRef, {
    pending: arrayUnion(currentUser.uid)
  });
  await updateDoc(doc(db, "users", currentUser.uid), {
    requestsSent: arrayUnion(friendUid)
  });

  closeFriendModal();
  alert("Запрос отправлен!");
};

// ========== Профиль ==========
window.openProfileModal = async () => {
  if (!currentUser) return;
  const userSnap = await getDoc(doc(db, "users", currentUser.uid));
  if (userSnap.exists()) {
    const data = userSnap.data();
    document.getElementById("profileUid").textContent = data.uid || currentUser.uid;
    document.getElementById("profileEmail").textContent = data.email || currentUser.email;
    document.getElementById("profileNick").textContent = data.nick || currentUser.displayName;
    document.getElementById("profileAvatar").src = data.photoURL || "";
  }
  document.getElementById("profileModal").style.display = "block";
};

window.closeProfileModal = () => {
  document.getElementById("profileModal").style.display = "none";
};

window.updateProfileData = async () => {
  const newNick = document.getElementById("newNick").value.trim();
  const newPhoto = document.getElementById("newPhoto").value.trim();

  const updates = {};
  if (newNick) updates.nick = newNick;
  if (newPhoto) updates.photoURL = newPhoto;

  if (Object.keys(updates).length === 0) {
    closeProfileModal();
    return;
  }

  await updateDoc(doc(db, "users", currentUser.uid), updates);
  // Обновляем displayName в Auth (необязательно, но полезно)
  if (newNick) {
    await updateProfile(currentUser, { displayName: newNick });
  }
  if (newPhoto) {
    await updateProfile(currentUser, { photoURL: newPhoto });
  }

  alert("Профиль обновлён!");
  closeProfileModal();
  // Обновим отображение ника и аватарки в сайдбаре
  document.getElementById("userNick").textContent = newNick || currentUser.displayName;
  if (newPhoto) document.getElementById("userAvatar").src = newPhoto;
};

// ========== Выход ==========
window.logout = async () => {
  await setUserOnline(false);
  signOut(auth).then(() => {
    window.location.href = "index.html";
  });
};